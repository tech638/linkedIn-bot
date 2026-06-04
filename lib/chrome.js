const puppeteer = require("puppeteer-core");
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const CHROME_PATH =
  process.env.CHROME_PATH || "/opt/google/chrome/google-chrome";
const CHROME_USER_DATA_DIR =
  process.env.CHROME_USER_DATA_DIR ||
  path.join(os.homedir(), ".config", "google-chrome");
const CHROME_PROFILE =
  process.env.CHROME_BOT_PROFILE ||
  process.env.CHROME_PROFILE ||
  "Default";
const CHROME_BOT_DATA_DIR =
  process.env.CHROME_BOT_DATA_DIR ||
  path.join(os.homedir(), ".config", "linkedin-bot-chrome");
const USE_MAIN_PROFILE = process.env.USE_MAIN_PROFILE === "true";
const DEBUG_PORT = Number(process.env.CHROME_DEBUG_PORT || 9222);
const QUIT_BOT_SCRIPT = path.join(__dirname, "..", "scripts", "quit-bot-chrome.sh");
const QUIT_SCRIPT = path.join(__dirname, "..", "scripts", "quit-chrome.sh");
const SYNC_SCRIPT = path.join(__dirname, "..", "scripts", "sync-profile.sh");

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
  return path.join(CHROME_BOT_DATA_DIR, CHROME_PROFILE);
}

function botProfileReady() {
  return fs.existsSync(path.join(botProfilePath(), "Preferences"));
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

function openInProfile1(url) {
  spawn(
    CHROME_PATH,
    [
      `--user-data-dir=${CHROME_USER_DATA_DIR}`,
      `--profile-directory=${CHROME_PROFILE}`,
      "--new-tab",
      url,
    ],
    { detached: true, stdio: "ignore" }
  ).unref();
}

function waitForCdp(port, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(
        `http://127.0.0.1:${port}/json/version`,
        (res) => {
          let body = "";
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => {
            if (res.statusCode === 200) {
              try {
                resolve(JSON.parse(body));
              } catch {
                reject(new Error("Invalid CDP response"));
              }
            } else if (Date.now() < deadline) {
              setTimeout(attempt, 500);
            } else {
              reject(new Error("Chrome remote debugging did not start"));
            }
          });
        }
      );
      req.on("error", () => {
        if (Date.now() < deadline) {
          setTimeout(attempt, 500);
        } else {
          reject(new Error("Chrome remote debugging did not start"));
        }
      });
      req.setTimeout(2000, () => {
        req.destroy();
        if (Date.now() < deadline) {
          setTimeout(attempt, 500);
        } else {
          reject(new Error("Chrome remote debugging did not start"));
        }
      });
    };
    attempt();
  });
}

async function tryConnectBrowser() {
  try {
    const browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${DEBUG_PORT}`,
      defaultViewport: null,
    });
    browser.__realProfile = true;
    return browser;
  } catch {
    return null;
  }
}

async function startProfile1WithDebugging(startUrl) {
  const url = startUrl || "about:blank";
  spawn(
    CHROME_PATH,
    [
      `--user-data-dir=${CHROME_USER_DATA_DIR}`,
      `--profile-directory=${CHROME_PROFILE}`,
      `--remote-debugging-port=${DEBUG_PORT}`,
      "--remote-allow-origins=*",
      "--no-first-run",
      "--no-default-browser-check",
      url,
    ],
    { detached: true, stdio: "ignore" }
  ).unref();

  await waitForCdp(DEBUG_PORT, 90_000);
  const browser = await tryConnectBrowser();
  if (!browser) {
    throw new Error("Could not attach to Chrome after launch.");
  }
  return browser;
}

function createCliBrowser() {
  return {
    __realProfileCli: true,
    async newPage() {
      return {
        __realProfileCli: true,
        url: () => "",
        async goto(url) {
          openInProfile1(url);
          await sleep(2500);
        },
      };
    },
    async close() {},
    async disconnect() {},
  };
}

async function closeBrowser(browser) {
  if (browser.__realProfileCli) return;
  if (browser.__realProfile) {
    await browser.disconnect();
    return;
  }
  await browser.close();
}

async function prepareBotBrowser() {
  if (isBotChromeRunning()) {
    console.log("Closing previous bot Chrome (dummy profile)...");
    await runScript(QUIT_BOT_SCRIPT);
    await sleep(2000);
  }

  if (process.env.CHROME_SYNC_PROFILE === "true" && !botProfileReady()) {
    console.log(
      "  → Optional one-time sync from main Chrome (CHROME_SYNC_PROFILE=true)..."
    );
    try {
      await runScript(SYNC_SCRIPT);
    } catch (err) {
      console.warn(`  → Sync skipped: ${err.message}`);
    }
  }

  console.log(
    `Launching dummy bot Chrome — direct LinkedIn (no Gmail)\n  ${CHROME_BOT_DATA_DIR} / ${CHROME_PROFILE}`
  );
  const headless = process.env.CHROME_HEADLESS === "true";
  const launchOptions = {
    executablePath: CHROME_PATH,
    headless: headless ? "new" : false,
    defaultViewport: null,
    timeout: 60_000,
    protocolTimeout: 60_000,
    userDataDir: CHROME_BOT_DATA_DIR,
    args: [
      `--profile-directory=${CHROME_PROFILE}`,
      "--no-sandbox",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  };
  if (headless) {
    console.log("  → Chrome headless mode.");
  }

  try {
    return await puppeteer.launch(launchOptions);
  } catch (err) {
    const msg = String(err?.message || err);
    if (!/browser is already running/i.test(msg)) {
      throw err;
    }
    console.warn("Bot Chrome locked; closing and retrying once...");
    await runScript(QUIT_BOT_SCRIPT);
    await sleep(2000);
    return puppeteer.launch(launchOptions);
  }
}

async function prepareRealProfileBrowser(startUrl) {
  console.log(`Chrome profile: ${CHROME_PROFILE}`);
  console.log(`Profile path: ${path.join(CHROME_USER_DATA_DIR, CHROME_PROFILE)}`);

  const attached = await tryConnectBrowser();
  if (attached) {
    console.log(`Attached for automation (port ${DEBUG_PORT}).`);
    attached.__realProfile = true;
    attached.__automationReady = true;
    return attached;
  }

  const autoDebugEnv = (process.env.CHROME_AUTO_DEBUG ?? "true")
    .toString()
    .toLowerCase();
  const autoDebug = autoDebugEnv !== "false" && autoDebugEnv !== "0" && Boolean(startUrl);
  if (autoDebug) {
    console.log(
      `Starting Profile 1 with remote debugging (port ${DEBUG_PORT}) so clicks can run...`
    );
    if (isMainChromeRunning()) {
      console.log("  → Closing existing Chrome first (required for debug port)...");
      await runScript(QUIT_SCRIPT);
      await sleep(2500);
    }
    try {
      const browser = await startProfile1WithDebugging(startUrl);
      browser.__realProfile = true;
      browser.__automationReady = true;
      return browser;
    } catch (err) {
      console.warn(
        `Could not start Chrome debugging on Profile 1 (${err.message}). Falling back to open-only mode.`
      );
      console.warn(
        "  → Auto-click needs a controllable Chrome session; group URL will still open in your Profile 1."
      );
    }
  }

  console.log("Opening LinkedIn in Profile 1 (your normal Chrome, not the bot copy).");
  return createCliBrowser();
}

async function prepareBrowser(options = {}) {
  const startUrl = options.startUrl || "";
  if (USE_MAIN_PROFILE) {
    return prepareRealProfileBrowser(startUrl);
  }
  return prepareBotBrowser();
}

module.exports = {
  prepareBrowser,
  closeBrowser,
  openInProfile1,
  startProfile1WithDebugging,
  tryConnectBrowser,
  CHROME_PROFILE,
  isMainChromeRunning,
  botProfileReady,
};
