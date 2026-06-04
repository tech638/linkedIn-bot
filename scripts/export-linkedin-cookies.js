#!/usr/bin/env node
/**
 * Export LinkedIn cookies from the local bot Chrome profile.
 * Run after you are logged in locally (non-headless): npm run export-cookies
 * Upload linkedin-cookies.json to Railway volume /app/data/ or set LINKEDIN_LI_AT.
 */
require("../lib/bootstrap");
const fs = require("fs");
const path = require("path");
const { prepareBrowser, closeBrowser } = require("../lib/chrome");
const { DEFAULT_SESSION_FILE } = require("../lib/linkedin-session");

async function main() {
  const out =
    process.env.LINKEDIN_SESSION_FILE ||
    process.argv[2] ||
    DEFAULT_SESSION_FILE;

  console.log("Opening bot Chrome to read LinkedIn cookies...");
  const browser = await prepareBrowser();
  const pages = await browser.pages();
  const page = pages[0] || (await browser.newPage());

  await page.goto("https://www.linkedin.com/feed/", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  const cookies = await page.cookies();
  const linkedin = cookies.filter(
    (c) =>
      (c.domain || "").includes("linkedin.com") &&
      ["li_at", "JSESSIONID", "bcookie", "bscookie", "li_rm", "liap"].includes(c.name)
  );

  if (!linkedin.some((c) => c.name === "li_at")) {
    console.error(
      "No li_at cookie — log in to LinkedIn in bot Chrome first (npm run cycle with CHROME_HEADLESS=false)."
    );
    await closeBrowser(browser);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(linkedin, null, 2));
  console.log(`Wrote ${linkedin.length} cookie(s) to:\n  ${out}`);
  console.log(
    "\nRailway: upload this file to your volume as /app/data/linkedin-cookies.json"
  );
  console.log("Or set LINKEDIN_LI_AT in Railway variables (li_at value only).\n");

  await closeBrowser(browser);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
