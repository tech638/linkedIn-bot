/**
 * Close bot Chrome profile (cross-platform — no bash required).
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const os = require("os");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pidFromChromeLock(lockPath) {
  try {
    const target = fs.readlinkSync(lockPath);
    const pid = Number(target.split("-").pop());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function killPid(pid) {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* ignore */
  }
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* ignore */
    }
  }
}

function removeLockFiles(dataDir) {
  for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    try {
      fs.unlinkSync(path.join(dataDir, name));
    } catch {
      /* ignore */
    }
  }
}

function killWindowsChromeForProfile(dataDir) {
  const normalized = dataDir.replace(/\\/g, "\\\\");
  spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process -Filter "name='chrome.exe'" | ` +
        `Where-Object { $_.CommandLine -like '*${normalized.replace(/'/g, "''")}*' } | ` +
        `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
    ],
    { stdio: "ignore" }
  );
}

function closeBotChrome(dataDir) {
  if (!dataDir) return;

  console.log(`Closing bot Chrome (${dataDir})...`);

  const lock = path.join(dataDir, "SingletonLock");
  const pid = pidFromChromeLock(lock);
  if (pid) killPid(pid);

  if (process.platform === "win32") {
    killWindowsChromeForProfile(dataDir);
  }

  removeLockFiles(dataDir);
  console.log("Bot Chrome closed.");
}

module.exports = { closeBotChrome, sleep };
