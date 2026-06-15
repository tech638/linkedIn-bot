/**
 * Find installed Chrome/Chromium for puppeteer-core (local OS paths).
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

function exists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (candidate && exists(candidate)) return candidate;
  }
  return null;
}

function windowsChromeCandidates() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

  return [
    path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
  ];
}

function linuxChromeCandidates() {
  return [
    "/opt/google/chrome/google-chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ];
}

function macChromeCandidates() {
  return [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    path.join(os.homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
  ];
}

function platformCandidates() {
  if (process.platform === "win32") return windowsChromeCandidates();
  if (process.platform === "darwin") return macChromeCandidates();
  return linuxChromeCandidates();
}

function resolveChromePath(configuredPath) {
  const configured = (configuredPath || "").trim();
  if (configured && configured !== "auto" && exists(configured)) {
    return configured;
  }

  const detected = firstExisting(platformCandidates());
  if (detected) return detected;

  if (configured && configured !== "auto") {
    return configured;
  }

  throw new Error(
    `Chrome not found. Install Google Chrome or set CHROME_PATH in lib/hardcoded-config.js` +
      (process.platform === "win32"
        ? " (e.g. C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe)"
        : "")
  );
}

module.exports = {
  resolveChromePath,
  platformCandidates,
};
