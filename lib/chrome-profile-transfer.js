const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const https = require("https");
const http = require("http");

const DEFAULT_ARCHIVE = "chrome-profile-export.tar.gz";

function profileDir() {
  require("./bootstrap");
  return process.env.CHROME_BOT_DATA_DIR;
}

function isChromeRunning(dataDir) {
  const lock = path.join(dataDir, "SingletonLock");
  try {
    fs.lstatSync(lock);
    return true;
  } catch {
    return false;
  }
}

function profileLooksLoggedIn(dataDir) {
  const prefs = path.join(dataDir, "Default", "Preferences");
  const cookies = path.join(dataDir, "Default", "Cookies");
  return fs.existsSync(prefs) || fs.existsSync(cookies);
}

function exportProfile(archivePath = DEFAULT_ARCHIVE) {
  const dir = profileDir();
  const absArchive = path.resolve(archivePath);

  if (!fs.existsSync(dir)) {
    throw new Error(`Bot Chrome profile not found: ${dir}`);
  }
  if (isChromeRunning(dir)) {
    throw new Error(
      "Bot Chrome is still running. Run: bash scripts/quit-bot-chrome.sh"
    );
  }
  if (!profileLooksLoggedIn(dir)) {
    throw new Error(
      "Profile looks empty — log in locally first (CHROME_HEADLESS=false), then export."
    );
  }

  if (fs.existsSync(absArchive)) fs.unlinkSync(absArchive);

  const args = [
    "-czf",
    absArchive,
    "--exclude=SingletonLock",
    "--exclude=SingletonSocket",
    "--exclude=SingletonCookie",
    "--exclude=DevToolsActivePort",
    "--exclude=Default/Cache",
    "--exclude=Default/Code Cache",
    "--exclude=Default/GPUCache",
    "--exclude=Default/Service Worker/CacheStorage",
    "--exclude=GrShaderCache",
    "--exclude=ShaderCache",
    "--exclude=GraphiteDawnCache",
    "-C",
    path.dirname(dir),
    path.basename(dir),
  ];

  const result = spawnSync("tar", args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error("tar export failed");
  }

  const sizeMb = (fs.statSync(absArchive).size / (1024 * 1024)).toFixed(1);
  return { archive: absArchive, sourceDir: dir, sizeMb };
}

function downloadUrl(url, destPath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(destPath);
    client
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlinkSync(destPath);
          return downloadUrl(res.headers.location, destPath).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(destPath);
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve(destPath)));
      })
      .on("error", (err) => {
        file.close();
        try {
          fs.unlinkSync(destPath);
        } catch {
          /* ignore */
        }
        reject(err);
      });
  });
}

function importProfile(options = {}) {
  const dir = profileDir();
  const archivePath = path.resolve(options.archive || DEFAULT_ARCHIVE);

  if (isChromeRunning(dir)) {
    throw new Error("Bot Chrome is running — stop the Railway service first.");
  }

  if (options.url) {
    console.log(`  → Downloading profile from URL…`);
    return downloadUrl(options.url, archivePath).then(() =>
      extractArchive(archivePath, dir)
    );
  }

  if (!fs.existsSync(archivePath)) {
    throw new Error(`Archive not found: ${archivePath}`);
  }
  return Promise.resolve(extractArchive(archivePath, dir));
}

function extractArchive(archivePath, destParent) {
  const dir = destParent;
  const folderName = path.basename(dir);

  if (fs.existsSync(dir)) {
    const backup = `${dir}.bak-${Date.now()}`;
    fs.renameSync(dir, backup);
    console.log(`  → Backed up existing profile → ${backup}`);
  }

  fs.mkdirSync(path.dirname(dir), { recursive: true });

  const result = spawnSync(
    "tar",
    ["-xzf", archivePath, "-C", path.dirname(dir)],
    { stdio: "inherit" }
  );
  if (result.status !== 0) {
    throw new Error("tar import failed");
  }

  const imported = path.join(path.dirname(dir), folderName);
  if (imported !== dir && fs.existsSync(imported)) {
    fs.renameSync(imported, dir);
  }

  if (!profileLooksLoggedIn(dir)) {
    throw new Error("Import finished but profile still looks empty.");
  }

  return { profileDir: dir, archive: archivePath };
}

module.exports = {
  DEFAULT_ARCHIVE,
  profileDir,
  exportProfile,
  importProfile,
  profileLooksLoggedIn,
  isChromeRunning,
};
