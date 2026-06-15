/**
 * OS-specific paths — Ubuntu/Linux, Windows, macOS, Railway.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { resolveChromePath } = require("./resolve-chrome-path");

const IS_SERVER = fs.existsSync("/app/data");
const IS_WIN = process.platform === "win32";
const IS_LINUX = process.platform === "linux";
const IS_MAC = process.platform === "darwin";
const HOME = os.homedir();
const ROOT = path.join(__dirname, "..");

function platformLabel() {
  if (IS_SERVER) return "Railway (Linux server)";
  if (IS_WIN) return "Windows";
  if (IS_MAC) return "macOS";
  if (IS_LINUX) return "Ubuntu/Linux";
  return process.platform;
}

function localChromePath() {
  if (IS_SERVER) return "/usr/bin/chromium";
  try {
    return resolveChromePath();
  } catch {
    if (IS_WIN) return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    if (IS_MAC) return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    return "/opt/google/chrome/google-chrome";
  }
}

function localBotDataDir() {
  if (IS_SERVER) return "/app/data/linkedin-bot-chrome";
  if (IS_WIN) {
    return path.join(
      process.env.LOCALAPPDATA || path.join(HOME, "AppData", "Local"),
      "linkedin-bot-chrome"
    );
  }
  return path.join(HOME, ".config", "linkedin-bot-chrome");
}

function localDataDir() {
  return IS_SERVER ? "/app/data" : ROOT;
}

module.exports = {
  IS_SERVER,
  IS_WIN,
  IS_LINUX,
  IS_MAC,
  HOME,
  ROOT,
  platformLabel,
  localChromePath,
  localBotDataDir,
  localDataDir,
};
