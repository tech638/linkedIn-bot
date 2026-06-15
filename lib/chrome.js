const puppeteer = require("puppeteer-core");
const { wireStealthBrowser, stealthChromeArgs } = require("./browser-stealth");
const { resolveChromePath } = require("./resolve-chrome-path");
const { closeBotChrome, sleep } = require("./quit-bot-chrome");
const fs = require("fs");
const path = require("path");
const os = require("os");

const BOT_PROFILE = process.env.CHROME_BOT_PROFILE || "Default";
const CHROME_BOT_DATA_DIR =
  process.env.CHROME_BOT_DATA_DIR ||
  path.join(os.homedir(), ".config", "linkedin-bot-chrome");

function getChromeExecutable() {
  return resolveChromePath(process.env.CHROME_PATH);
}

function assertBotProfileOnly() {
  if (process.env.USE_MAIN_PROFILE === "true") {
    throw new Error(
      "USE_MAIN_PROFILE is not supported. Bot uses linkedin-bot-chrome only (see CHROME_BOT_DATA_DIR)."
    );
  }
  if (process.env.CHROME_SYNC_PROFILE === "true") {
    throw new Error(
      "CHROME_SYNC_PROFILE is disabled — bot profile only."
    );
  }
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

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isBotChromeRunning() {
  const lock = path.join(CHROME_BOT_DATA_DIR, "SingletonLock");
  try {
    fs.lstatSync(lock);
    const pid = pidFromChromeLock(lock);
    if (pid) return isProcessRunning(pid);
    return true;
  } catch {
    return false;
  }
}

function botProfilePath() {
  return path.join(CHROME_BOT_DATA_DIR, BOT_PROFILE);
}

function botProfileReady() {
  return fs.existsSync(path.join(botProfilePath(), "Preferences"));
}

async function closeBrowser(browser) {
  if (!browser) return;
  await browser.close();
}

async function prepareBotBrowser() {
  assertBotProfileOnly();

  const executablePath = getChromeExecutable();

  if (isBotChromeRunning()) {
    console.log("Closing previous bot Chrome (dummy profile)...");
    closeBotChrome(CHROME_BOT_DATA_DIR);
    await sleep(2000);
  }

  const headless = process.env.CHROME_HEADLESS === "true";
  const humanClicks = process.env.CHROME_HUMAN_CLICKS !== "false";
  console.log(
    `Launching bot Chrome${headless ? " (headless)" : " (visible window)"} — LinkedIn only\n  ${CHROME_BOT_DATA_DIR} / ${BOT_PROFILE}`
  );
  console.log(`  Chrome: ${executablePath}`);
  if (!headless) {
    console.log("  → Visible Chrome — best for login; set CHROME_HEADLESS=true for server.");
  }
  if (humanClicks) {
    console.log("  → Human mouse clicks enabled (real pointer moves, not DOM .click()).");
  }

  const chromeArgs = [
    `--profile-directory=${BOT_PROFILE}`,
    "--no-first-run",
    "--no-default-browser-check",
    ...stealthChromeArgs(),
  ];

  if (process.platform !== "win32") {
    chromeArgs.push("--no-sandbox", "--disable-dev-shm-usage");
  }

  if (headless) {
    chromeArgs.push("--disable-gpu");
  } else {
    chromeArgs.push("--start-maximized");
  }

  const launchOptions = {
    executablePath,
    headless: headless ? "new" : false,
    defaultViewport: null,
    timeout: 60_000,
    protocolTimeout: 60_000,
    userDataDir: CHROME_BOT_DATA_DIR,
    args: chromeArgs,
  };

  try {
    const browser = await puppeteer.launch(launchOptions);
    wireStealthBrowser(browser);
    if (process.env.CHROME_STEALTH !== "false") {
      console.log("  → Stealth UA enabled (reduces HeadlessChrome fingerprint).");
    }
    return browser;
  } catch (err) {
    const msg = String(err?.message || err);
    if (!/browser is already running/i.test(msg)) {
      throw err;
    }
    console.warn("Bot Chrome locked; closing and retrying once...");
    closeBotChrome(CHROME_BOT_DATA_DIR);
    await sleep(2000);
    const browser = await puppeteer.launch(launchOptions);
    wireStealthBrowser(browser);
    return browser;
  }
}

async function prepareBrowser() {
  return prepareBotBrowser();
}

module.exports = {
  prepareBrowser,
  closeBrowser,
  botProfileReady,
  BOT_PROFILE,
  CHROME_BOT_DATA_DIR,
  getChromeExecutable,
};
