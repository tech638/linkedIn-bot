const puppeteer = require("puppeteer-core");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const CHROME_PATH =
  process.env.CHROME_PATH || "/opt/google/chrome/google-chrome";
const CHROME_BOT_DATA_DIR =
  process.env.CHROME_BOT_DATA_DIR ||
  path.join(os.homedir(), ".config", "linkedin-bot-chrome");
const USE_MAIN_PROFILE = process.env.USE_MAIN_PROFILE === "true";
const CHROME_USER_DATA_DIR =
  process.env.CHROME_USER_DATA_DIR ||
  path.join(os.homedir(), ".config", "google-chrome");
const QUIT_SCRIPT = path.join(__dirname, "..", "scripts", "quit-chrome.sh");
const SYNC_SCRIPT = path.join(__dirname, "..", "scripts", "sync-profile.sh");

function pidFromChromeLock(lockPath) {
  try {
    const target = fs.readlinkSync(lockPath);
    const pid = Number(target.split("-").pop());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isMainChromeRunning() {
  const lock = path.join(CHROME_USER_DATA_DIR, "SingletonLock");
  try {
    fs.lstatSync(lock);
    const pid = pidFromChromeLock(lock);
    if (pid) return isProcessRunning(pid);
    return true;
  } catch {
    return false;
  }
}

function botProfileReady() {
  return fs.existsSync(path.join(CHROME_BOT_DATA_DIR, "Default", "Preferences"));
}

function runScript(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [scriptPath], {
      stdio: "inherit",
      cwd: path.join(__dirname, ".."),
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(scriptPath)} exited with code ${code}`));
    });
  });
}

async function prepareBrowser() {
  if (isMainChromeRunning()) {
    if (process.env.CHROME_AUTO_QUIT === "true") {
      await runScript(QUIT_SCRIPT);
      await new Promise((r) => setTimeout(r, 1500));
    } else if (isMainChromeRunning()) {
      throw new Error("Close main Chrome (Exit), then run the bot again.");
    }
  }

  if (!USE_MAIN_PROFILE) {
    if (!botProfileReady() || process.env.CHROME_SYNC_PROFILE === "true") {
      console.log("Syncing Profile 1 session into bot Chrome profile...");
      await runScript(SYNC_SCRIPT);
    }
  }
}

async function launchBrowser() {
  await prepareBrowser();
  console.log("Launching Chrome for automation...");
  return puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,
    userDataDir: USE_MAIN_PROFILE ? CHROME_USER_DATA_DIR : CHROME_BOT_DATA_DIR,
    defaultViewport: null,
    timeout: 120_000,
    protocolTimeout: 120_000,
    args: [
      "--no-sandbox",
      "--no-first-run",
      "--no-default-browser-check",
      ...(USE_MAIN_PROFILE ? [`--profile-directory=${process.env.CHROME_PROFILE || 'Profile 1'}`] : []),
    ],
  });
}

module.exports = {
  launchBrowser,
  prepareBrowser,
  botProfileReady,
  isMainChromeRunning,
};
