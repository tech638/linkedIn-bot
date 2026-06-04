/**
 * Load optional .env, then apply hardcoded production config (always wins).
 * Railway deploy works without any env variables in the dashboard.
 */
require("dotenv").config();

const HARDCODED = require("./hardcoded-config");

for (const [key, value] of Object.entries(HARDCODED)) {
  if (value !== undefined && value !== null) {
    process.env[key] = String(value);
  }
}

module.exports = { HARDCODED };
