const fs = require("fs");
const path = require("path");

const DEFAULT_SESSION_FILE = path.join(
  process.env.DATA_DIR || path.join(__dirname, ".."),
  "linkedin-cookies.json"
);

function sessionFilePaths() {
  const paths = [];
  if (process.env.LINKEDIN_SESSION_FILE) {
    paths.push(process.env.LINKEDIN_SESSION_FILE);
  }
  paths.push(DEFAULT_SESSION_FILE);
  return [...new Set(paths)];
}

function normalizeCookie(raw) {
  if (!raw?.name || raw.value == null) return null;
  const domain = raw.domain || ".linkedin.com";
  return {
    name: String(raw.name),
    value: String(raw.value),
    domain: domain.startsWith(".") ? domain : `.${domain.replace(/^\./, "")}`,
    path: raw.path || "/",
    expires: raw.expires || raw.expirationDate || undefined,
    httpOnly: raw.httpOnly !== false,
    secure: raw.secure !== false,
    sameSite: raw.sameSite || "None",
  };
}

function cookiesFromLiAt(liAt) {
  const value = String(liAt || "").trim();
  if (!value) return [];
  return [
    normalizeCookie({
      name: "li_at",
      value,
      domain: ".linkedin.com",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "None",
    }),
  ].filter(Boolean);
}

function loadSessionCookies() {
  const fromEnv = cookiesFromLiAt(process.env.LINKEDIN_LI_AT);
  if (fromEnv.length) return fromEnv;

  for (const filePath of sessionFilePaths()) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const list = Array.isArray(raw) ? raw : raw.cookies;
      if (!Array.isArray(list) || !list.length) continue;
      const cookies = list.map(normalizeCookie).filter(Boolean);
      if (cookies.some((c) => c.name === "li_at")) {
        return cookies;
      }
    } catch {
      /* try next path */
    }
  }
  return [];
}

function hasSessionSource() {
  if (process.env.LINKEDIN_LI_AT?.trim()) return true;
  return sessionFilePaths().some((p) => {
    try {
      return fs.existsSync(p) && fs.statSync(p).size > 10;
    } catch {
      return false;
    }
  });
}

async function restoreLinkedInSession(page, cookies) {
  const active = page.__linkedInActivePage || page;
  const list = (cookies || loadSessionCookies()).map(normalizeCookie).filter(Boolean);
  if (!list.length) return false;

  try {
    await active.goto("https://www.linkedin.com", {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
  } catch {
    /* continue */
  }

  try {
    await active.setCookie(...list);
  } catch (err) {
    console.warn(`  → Could not set cookies: ${err.message}`);
    return false;
  }

  try {
    await active.goto("https://www.linkedin.com/feed/", {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
  } catch {
    /* continue */
  }

  return true;
}

module.exports = {
  loadSessionCookies,
  hasSessionSource,
  restoreLinkedInSession,
  sessionFilePaths,
  DEFAULT_SESSION_FILE,
};
