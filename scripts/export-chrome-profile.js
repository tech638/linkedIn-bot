#!/usr/bin/env node
/**
 * Pack local bot Chrome profile after a successful login.
 * Use import-chrome-profile.js on Railway to reuse the same LinkedIn session.
 */
const path = require("path");
const { exportProfile, DEFAULT_ARCHIVE } = require("../lib/chrome-profile-transfer");

const archive = process.argv[2] || DEFAULT_ARCHIVE;

try {
  const result = exportProfile(archive);
  console.log("\n✓ Chrome profile exported");
  console.log(`  Source: ${result.sourceDir}`);
  console.log(`  Archive: ${result.archive} (${result.sizeMb} MB)`);
  console.log("\nNext — push to Railway:");
  console.log("  npm run push-profile");
  console.log("  — or upload the .tar.gz and run on Railway:");
  console.log(
    `  railway run node scripts/import-chrome-profile.js --url=YOUR_DOWNLOAD_URL`
  );
} catch (err) {
  console.error("Export failed:", err.message);
  process.exit(1);
}
