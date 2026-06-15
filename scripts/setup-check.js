#!/usr/bin/env node
/**
 * Verify bot setup on Ubuntu or Windows (run after npm install).
 */
require("../lib/bootstrap");
const fs = require("fs");
const {
  platformLabel,
  localChromePath,
  localBotDataDir,
  localDataDir,
} = require("../lib/platform-paths");
const { resolveChromePath } = require("../lib/resolve-chrome-path");
const { botProfileReady } = require("../lib/chrome");

let ok = true;

function pass(msg) {
  console.log(`  ✓ ${msg}`);
}

function fail(msg) {
  console.log(`  ✗ ${msg}`);
  ok = false;
}

function warn(msg) {
  console.log(`  ⚠ ${msg}`);
}

console.log("LinkedIn Bot — setup check\n");
console.log(`Platform: ${platformLabel()}`);
console.log(`Node: ${process.version}\n`);

// Node version
const major = Number(process.version.slice(1).split(".")[0]);
if (major >= 18) pass(`Node ${process.version} (18+ required)`);
else fail(`Node ${process.version} — upgrade to Node 18+`);

// Chrome
console.log("\nChrome:");
try {
  const chrome = resolveChromePath(process.env.CHROME_PATH);
  if (fs.existsSync(chrome)) pass(`Found: ${chrome}`);
  else fail(`Configured but missing: ${chrome}`);
} catch (err) {
  fail(err.message);
  if (process.platform === "win32") {
    warn("Install from https://www.google.com/chrome/");
  } else {
    warn("Ubuntu: sudo apt install google-chrome-stable");
    warn("Or: https://www.google.com/chrome/");
  }
}

// Paths
console.log("\nPaths:");
pass(`Bot profile: ${localBotDataDir()}`);
pass(`State/data: ${localDataDir()}`);
pass(`Headless: ${process.env.CHROME_HEADLESS} (false = visible window for login)`);

if (botProfileReady()) {
  pass("Saved LinkedIn session in profile (login may be skipped)");
} else {
  warn("No saved session — first run will need full login");
}

// Credentials
console.log("\nCredentials:");
try {
  const { LINKEDIN_EMAIL, LINKEDIN_PASSWORD } = require("../lib/auth-credentials");
  if (LINKEDIN_EMAIL && !LINKEDIN_EMAIL.includes("example.com")) {
    pass(`LinkedIn email: ${LINKEDIN_EMAIL}`);
  } else {
    fail("Set LINKEDIN_EMAIL in lib/auth-credentials.js");
  }
  if (LINKEDIN_PASSWORD && LINKEDIN_PASSWORD.length > 3) {
    pass("LinkedIn password: set");
  } else {
    fail("Set LINKEDIN_PASSWORD in lib/auth-credentials.js");
  }
} catch {
  fail("Missing lib/auth-credentials.js — copy from lib/auth-credentials.example.js");
}

// Sheet
console.log("\nGoogle Sheet:");
if (process.env.GOOGLE_SHEET_ID) {
  pass(`Sheet ID: ${process.env.GOOGLE_SHEET_ID}`);
} else {
  fail("GOOGLE_SHEET_ID missing in lib/hardcoded-config.js");
}

console.log("\nConfig files:");
pass("lib/hardcoded-config.js — schedule, limits, Chrome");
pass("lib/auth-credentials.js — LinkedIn login");
pass("posts.json — post copy rotation");

console.log("");
if (ok) {
  console.log("Ready. Start the bot:\n  npm start\n");
  process.exit(0);
} else {
  console.log("Fix the items above, then run:\n  npm run setup\n");
  process.exit(1);
}
