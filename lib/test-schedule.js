/** Fast schedule for local/Railway testing — applied when TEST_MODE or RAILWAY_TEST_SCHEDULE is on. */
const TEST_CYCLE_DELAY_MS = 3 * 60 * 1000;

function applyTestSchedule(env = process.env) {
  env.TEST_MODE = "true";
  env.INTER_CYCLE_DELAY_MIN_MS = String(TEST_CYCLE_DELAY_MS);
  env.INTER_CYCLE_DELAY_MAX_MS = String(TEST_CYCLE_DELAY_MS);
  env.ACTIVE_HOURS_START = "0";
  env.ACTIVE_HOURS_END = "24";
  env.SKIP_COOLDOWN = "true";
  env.COOLDOWN_MS = "60000";
}

module.exports = { applyTestSchedule, TEST_CYCLE_DELAY_MS };
