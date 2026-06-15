#!/usr/bin/env node
require("../lib/bootstrap");
const args = process.argv.slice(2);
if (args.includes("--engage-only")) process.env.ENGAGE_ONLY = "true";
if (args.includes("--post-only")) process.env.POST_ONLY = "true";
const { runOneCycle } = require("../src/index");

runOneCycle()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal:", err.message);
    process.exit(1);
  });
