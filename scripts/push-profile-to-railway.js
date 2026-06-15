#!/usr/bin/env node
/**
 * Export local Chrome session and import to Railway (Ubuntu, Windows, macOS).
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.join(__dirname, "..");
const ARCHIVE = process.argv[2] || "chrome-profile-export.tar.gz";

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: ROOT, ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function railwayInstalled() {
  const r = spawnSync("railway", ["--version"], { stdio: "pipe" });
  return r.status === 0;
}

function uploadFile(filePath) {
  const boundary = "----LinkedInBot" + Date.now();
  const fileName = path.basename(filePath);
  const fileData = fs.readFileSync(filePath);
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
        `Content-Type: application/gzip\r\n\r\n`
    ),
    fileData,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "0x0.st",
        path: "/",
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          const url = data.trim();
          if (res.statusCode === 200 && url.startsWith("http")) resolve(url);
          else reject(new Error(`Upload failed: ${data || res.statusCode}`));
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  if (!railwayInstalled()) {
    console.error("Railway CLI not found. Install: npm i -g @railway/cli");
    console.error("Then: railway login && railway link");
    process.exit(1);
  }

  console.log("=== Step 1: Close local bot Chrome ===");
  run("node", ["scripts/quit-bot-chrome.js"]);

  console.log("\n=== Step 2: Export local profile ===");
  run("node", ["scripts/export-chrome-profile.js", ARCHIVE]);

  console.log("\n=== Step 3: Upload archive ===");
  let uploadUrl;
  try {
    uploadUrl = await uploadFile(path.join(ROOT, ARCHIVE));
    console.log(`  Uploaded: ${uploadUrl}`);
    console.log("  (Link expires — import within a few hours.)");
  } catch (err) {
    console.error("Upload failed:", err.message);
    console.log(`Upload ${ARCHIVE} manually, then run:`);
    console.log("  railway run node scripts/import-chrome-profile.js --url=YOUR_URL");
    process.exit(1);
  }

  console.log("\n=== Step 4: Import on Railway (volume at /app/data) ===");
  console.log("  Pause or restart Railway service if the bot is running.");
  run("railway", [
    "run",
    "node",
    "scripts/import-chrome-profile.js",
    `--url=${uploadUrl}`,
  ]);

  console.log("\n✓ Done. Restart Railway service — production should skip login.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
