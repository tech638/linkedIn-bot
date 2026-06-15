const { loadConfig } = require("../lib/config");

function jitterMs(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function jitterPct(base, pct) {
  const delta = base * (pct / 100);
  return base + (Math.random() * 2 - 1) * delta;
}

function getConfigTimeZone() {
  return process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function formatTimeInConfigTz(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: getConfigTimeZone(),
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function formatNowInConfigTz(now = new Date()) {
  return formatTimeInConfigTz(now);
}

function isWithinActiveHours(config, now = new Date()) {
  const hour = now.getHours();
  const { activeHoursStart, activeHoursEnd } = config.scheduling;
  return hour >= activeHoursStart && hour < activeHoursEnd;
}

function msUntilActiveStart(config, now = new Date()) {
  const next = new Date(now);
  next.setHours(config.scheduling.activeHoursStart, 0, 0, 0);
  if (now.getHours() >= config.scheduling.activeHoursStart) {
    next.setDate(next.getDate() + 1);
  }
  return next - now;
}

/** ~29 min per v1.1.0 cycle (engage + cooldown + post). */
const ESTIMATED_CYCLE_DURATION_MS = 29 * 60 * 1000;

function activeHoursEndMs(config, now = new Date()) {
  const end = new Date(now);
  end.setHours(config.scheduling.activeHoursEnd, 0, 0, 0);
  return end.getTime();
}

function cycleWouldExtendPastActiveHours(config, now = new Date()) {
  return now.getTime() + ESTIMATED_CYCLE_DURATION_MS > activeHoursEndMs(config, now);
}

function canStartCycleNow(config, state, now = new Date()) {
  if (!config.scheduling.enabled) return false;
  if (!isWithinActiveHours(config, now)) return false;
  if (cycleWouldExtendPastActiveHours(config, now)) return false;
  if (state.daily.cycles >= config.scheduling.cyclesPerDay) return false;
  return true;
}

function pickGroupForCycle(groups, state, excludeIds = null) {
  const floor =
    loadConfig().verification?.qualityScoreFloor ?? 0;
  const skip = excludeIds instanceof Set ? excludeIds : new Set();
  const active = groups.filter(
    (g) => (g.qualityScore ?? 3) > floor && !skip.has(g.id)
  );
  if (!active.length) return null;

  active.sort((a, b) => {
    const lvA = state.engagedItems[a.id]?.lastVisited || "1970-01-01";
    const lvB = state.engagedItems[b.id]?.lastVisited || "1970-01-01";
    if (lvA !== lvB) return Date.parse(lvA) - Date.parse(lvB);
    return (b.qualityScore ?? 0) - (a.qualityScore ?? 0);
  });

  return active[0];
}

function getCycleDelayMs(config) {
  const { interCycleDelayMinMs, interCycleDelayMaxMs } = config.scheduling;
  return jitterMs(interCycleDelayMinMs, interCycleDelayMaxMs);
}

function getCooldownMs(config) {
  const { cooldownMs, cooldownJitterPct } = config.engagement;
  return Math.round(jitterPct(cooldownMs, cooldownJitterPct));
}

function plannedCycleHours(config) {
  const { cyclesPerDay, activeHoursStart, activeHoursEnd } = config.scheduling;
  if (cyclesPerDay <= 1) return [activeHoursStart];

  const span = activeHoursEnd - activeHoursStart;
  const step = span / (cyclesPerDay - 1);
  const hours = Array.from({ length: cyclesPerDay }, (_, i) =>
    Math.round(activeHoursStart + step * i)
  );
  // Last cycle must finish before activeHoursEnd (~29 min cycle).
  hours[hours.length - 1] = Math.min(
    hours[hours.length - 1],
    activeHoursEnd - Math.ceil(ESTIMATED_CYCLE_DURATION_MS / 3_600_000) - 1
  );
  return hours;
}

/** ±20 min jitter on each planned slot (v1.1.0 spec). */
const CYCLE_SLOT_JITTER_MS = 20 * 60 * 1000;

/** After slot time, still allow starting within this grace window. */
const CYCLE_SLOT_GRACE_MS = 45 * 60 * 1000;

function buildCycleSlot(hour, now = new Date()) {
  const slot = new Date(now);
  slot.setHours(hour, 0, 0, 0);
  // Run at or after the planned hour (0–20 min after, never before).
  slot.setTime(slot.getTime() + jitterMs(0, CYCLE_SLOT_JITTER_MS));
  return slot;
}

function isSlotWithinActiveWindow(config, slot, now = new Date()) {
  if (slot.getHours() < config.scheduling.activeHoursStart) return false;
  if (slot.getTime() + ESTIMATED_CYCLE_DURATION_MS > activeHoursEndMs(config, now)) {
    return false;
  }
  return true;
}

/** Planned slots today that still have time to run (skips missed early slots). */
function getRemainingCycleSlots(config, state, now = new Date()) {
  const cyclesLeft = config.scheduling.cyclesPerDay - state.daily.cycles;
  if (cyclesLeft <= 0) return [];

  const hours = plannedCycleHours(config);
  const available = [];

  for (const hour of hours) {
    const slot = buildCycleSlot(hour, now);
    const lastStart = slot.getTime() + CYCLE_SLOT_GRACE_MS;
    if (now.getTime() <= lastStart && isSlotWithinActiveWindow(config, slot, now)) {
      available.push(slot);
    }
  }

  return available.slice(0, cyclesLeft);
}

function getNextCycleRunTime(config, state, now = new Date()) {
  const slots = getRemainingCycleSlots(config, state, now);
  if (!slots.length) return null;

  const slot = slots[0];
  if (now.getTime() >= slot.getTime()) return now;
  return slot;
}

function msUntilNextCycleSlot(config, state, now = new Date()) {
  const runAt = getNextCycleRunTime(config, state, now);
  if (!runAt) return msUntilActiveStart(config, now);
  return Math.max(0, runAt.getTime() - now.getTime());
}

function describeNextCycleSlot(config, state, now = new Date()) {
  const slots = getRemainingCycleSlots(config, state, now);
  if (!slots.length) {
    return { dueNow: false, runAt: null, ms: msUntilActiveStart(config, now) };
  }
  const runAt = getNextCycleRunTime(config, state, now);
  return {
    dueNow: runAt.getTime() <= now.getTime() + 1000,
    runAt,
    ms: Math.max(0, runAt.getTime() - now.getTime()),
    slotHour: plannedCycleHours(config)[state.daily.cycles] ?? null,
  };
}

module.exports = {
  jitterMs,
  getConfigTimeZone,
  formatTimeInConfigTz,
  formatNowInConfigTz,
  isWithinActiveHours,
  msUntilActiveStart,
  activeHoursEndMs,
  cycleWouldExtendPastActiveHours,
  ESTIMATED_CYCLE_DURATION_MS,
  CYCLE_SLOT_JITTER_MS,
  CYCLE_SLOT_GRACE_MS,
  canStartCycleNow,
  pickGroupForCycle,
  getCycleDelayMs,
  getCooldownMs,
  plannedCycleHours,
  buildCycleSlot,
  isSlotWithinActiveWindow,
  getRemainingCycleSlots,
  getNextCycleRunTime,
  msUntilNextCycleSlot,
  describeNextCycleSlot,
};
