#!/usr/bin/env node
/**
 * Restore bot Chrome profile on Railway (or local) from export archive or URL.
 */
require("../lib/bootstrap");

const {
  importProfile,
  DEFAULT_ARCHIVE,
  profileDir,
} = require("../lib/chrome-profile-transfer");

function argValue(flag) {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : null;
}

const url = argValue("--url");
const archive = argValue("--file") || process.argv[2] || DEFAULT_ARCHIVE;

console.log(`Target profile dir: ${profileDir()}`);

importProfile({ archive, url })
  .then((result) => {
    console.log("\n✓ Chrome profile imported");
    console.log(`  Profile: ${result.profileDir}`);
    console.log("  Restart the bot — expect: Session restored from bot profile");
  })
  .catch((err) => {
    console.error("Import failed:", err.message);
    process.exit(1);
  });
