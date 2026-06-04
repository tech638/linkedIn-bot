/**
 * Load optional .env, then apply hardcoded production config.
 * TEST_MODE / RAILWAY_TEST_SCHEDULE re-applies a 5-minute fast schedule after hardcoded.
 */
require("dotenv").config();

const wantFastSchedule =
  process.env.TEST_MODE === "true" ||
  process.env.RAILWAY_TEST_SCHEDULE === "true";

const HARDCODED = require("./hardcoded-config");

for (const [key, value] of Object.entries(HARDCODED)) {
  if (value !== undefined && value !== null) {
    process.env[key] = String(value);
  }
}

const fastFromHardcoded = HARDCODED.RAILWAY_TEST_SCHEDULE === "true";
if (wantFastSchedule || fastFromHardcoded) {
  const { applyTestSchedule } = require("./test-schedule");
  applyTestSchedule(process.env);
}

module.exports = { HARDCODED };
