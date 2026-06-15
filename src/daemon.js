require("../lib/bootstrap");
const fs = require("fs");
const { botProfileReady, CHROME_BOT_DATA_DIR } = require("../lib/chrome");
const { spawn } = require("child_process");
const path = require("path");
const { loadConfig } = require("../lib/config");
const { loadState } = require("../lib/state");
const { runOneCycle } = require("./index");
const {
  isWithinActiveHours,
  msUntilActiveStart,
  getCycleDelayMs,
  plannedCycleHours,
  canStartCycleNow,
  cycleWouldExtendPastActiveHours,
  formatNowInConfigTz,
  formatTimeInConfigTz,
  msUntilNextCycleSlot,
  describeNextCycleSlot,
  getRemainingCycleSlots,
} = require("./scheduler");

const ROOT = path.join(__dirname, "..");

function isTestMode() {
  return process.env.TEST_MODE === "true";
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function runNode(script) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [script], {
      cwd: ROOT,
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code));
  });
}

async function daemonLoop() {
  const config = loadConfig();
  const tz = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
  console.log("LinkedIn Bot v1.1.0 — scheduler running (no API, fully automatic)");
  const profileDir = CHROME_BOT_DATA_DIR;
  const hasProfile = botProfileReady();
  const onRailwayVolume = profileDir.startsWith("/app/data");
  console.log(`Bot Chrome profile: ${profileDir}`);
  console.log(
    hasProfile
      ? "  → Profile has saved data — restarts should reuse session (no new OTP) if volume persists."
      : "  → Profile empty — first login will need OTP; mount /app/data volume on Railway."
  );
  if (fs.existsSync("/app/data") && !onRailwayVolume) {
    console.warn(
      "  ⚠ CHROME_BOT_DATA_DIR is not on /app/data — each redeploy may wipe login and trigger new OTP emails."
    );
  }
  console.log("");
  if (isTestMode()) {
    console.log("  ⚠ TEST_MODE=true — fast schedule (short delays, 24h active window)");
  }
  console.log(
    `Cycles/day: ${config.scheduling.cyclesPerDay} | Active hours: ${config.scheduling.activeHoursStart}:00–${config.scheduling.activeHoursEnd}:00 (${tz})`
  );
  const inWindow = isWithinActiveHours(config);
  console.log(
    `Now in ${tz}: ${formatNowInConfigTz()} — ${inWindow ? "inside active window" : "outside active window (will sleep until 8:00)"}`
  );
  console.log(`Planned cycle hours: ${plannedCycleHours(config).join(", ")} (±20 min jitter)`);
  if (!isTestMode()) {
    const state = loadState();
    const next = describeNextCycleSlot(config, state);
    if (next.runAt && !next.dueNow) {
      console.log(
        `Next cycle scheduled: ${formatTimeInConfigTz(next.runAt)} (in ~${Math.round(next.ms / 60000)} min)`
      );
    } else if (next.dueNow) {
      console.log("Next cycle: due now at current slot");
    } else if (state.daily.cycles >= config.scheduling.cyclesPerDay) {
      console.log("Today's cycles complete — waiting for tomorrow.");
    } else {
      console.log("No more cycle slots today — waiting for tomorrow.");
    }
  } else {
    const delayMin = config.scheduling.interCycleDelayMinMs;
    const delayMax = config.scheduling.interCycleDelayMaxMs;
    console.log(
      `Test mode delay between cycles: ~${Math.round(delayMin / 60000)}–${Math.round(delayMax / 60000)} min`
    );
  }
  console.log("");

  let lastVerify = 0;
  const VERIFY_INTERVAL_MS = isTestMode() ? 5 * 60 * 1000 : 30 * 60 * 1000;

  while (true) {
    const state = loadState();

    if (!isWithinActiveHours(config)) {
      const wait = msUntilActiveStart(config);
      console.log(
        `Outside active hours. Sleeping until ${config.scheduling.activeHoursStart}:00 (${Math.round(wait / 3600000)}h)...`
      );
      await sleep(Math.min(wait, 60 * 60 * 1000));
      continue;
    }

    if (Date.now() - lastVerify >= VERIFY_INTERVAL_MS) {
      console.log("\n--- Verification pass ---");
      await runNode("src/verify.js");
      lastVerify = Date.now();
    }

    if (state.daily.cycles >= config.scheduling.cyclesPerDay) {
      const wait = msUntilActiveStart(config);
      console.log(
        `Daily cycles complete (${state.daily.cycles}/${config.scheduling.cyclesPerDay}). Sleeping until ${config.scheduling.activeHoursStart}:00 (${Math.round(wait / 3600000)}h)...`
      );
      await sleep(Math.min(wait, 60 * 60 * 1000));
      continue;
    }

    if (!isTestMode()) {
      const remaining = getRemainingCycleSlots(config, state);
      if (!remaining.length) {
        const wait = msUntilActiveStart(config);
        console.log(
          `No cycle slots left today. Sleeping until ${config.scheduling.activeHoursStart}:00 (${Math.round(wait / 3600000)}h)...`
        );
        await sleep(Math.min(wait, 60 * 60 * 1000));
        continue;
      }

      const slotWait = msUntilNextCycleSlot(config, state);
      if (slotWait > 60 * 1000) {
        const next = describeNextCycleSlot(config, state);
        console.log(
          `Waiting for cycle ${state.daily.cycles + 1} slot — ${formatTimeInConfigTz(next.runAt)} (in ~${Math.round(slotWait / 60000)} min)`
        );
        await sleep(Math.min(slotWait, 60 * 60 * 1000));
        continue;
      }
    }

    if (!canStartCycleNow(config, state)) {
      if (cycleWouldExtendPastActiveHours(config)) {
        const wait = msUntilActiveStart(config);
        console.log(
          `Too late to start cycle — would run past ${config.scheduling.activeHoursEnd}:00. Sleeping until ${config.scheduling.activeHoursStart}:00...`
        );
        await sleep(Math.min(wait, 60 * 60 * 1000));
      } else {
        await sleep(15 * 60 * 1000);
      }
      continue;
    }

    console.log(`\n--- Starting cycle ${state.daily.cycles + 1} ---`);
    try {
      await runOneCycle();
    } catch (err) {
      console.warn(`Cycle error: ${err.message}`);
    }

    const after = loadState();

    if (isTestMode()) {
      if (config.scheduling.cyclesPerDay > 1) {
        const delay = getCycleDelayMs(config);
        console.log(
          `Next cycle in ~${Math.round(delay / 60000)} min (${after.daily.cycles}/${config.scheduling.cyclesPerDay} done today)`
        );
        await sleep(delay);
      } else {
        await sleep(60 * 60 * 1000);
      }
    } else if (after.daily.cycles < config.scheduling.cyclesPerDay) {
      const next = describeNextCycleSlot(config, after);
      if (next.runAt && next.ms > 60 * 1000) {
        console.log(
          `Next cycle at ${formatTimeInConfigTz(next.runAt)} (in ~${Math.round(next.ms / 60000)} min) — ${after.daily.cycles}/${config.scheduling.cyclesPerDay} done today`
        );
      }
    }
  }
}

daemonLoop().catch((err) => {
  console.error("Daemon fatal:", err);
  process.exit(1);
});
