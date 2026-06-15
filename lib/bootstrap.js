/**
 * Apply lib/hardcoded-config.js → process.env (no .env file).
 */
const HARDCODED = require("./hardcoded-config");

for (const [key, value] of Object.entries(HARDCODED)) {
  if (value === undefined || value === null) continue;
  process.env[key] = String(value);
}

if (HARDCODED.TEST_MODE === "true" || HARDCODED.RAILWAY_TEST_SCHEDULE === "true") {
  const { applyTestSchedule } = require("./test-schedule");
  applyTestSchedule(process.env);
}

module.exports = { HARDCODED };
