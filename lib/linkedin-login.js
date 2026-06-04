const { LINKEDIN_EMAIL, LINKEDIN_PASSWORD } = require("./auth-credentials");

const LOGIN_URL = "https://www.linkedin.com/login";
const LOGIN_WAIT_MS = Number(process.env.LOGIN_WAIT_MS || 15_000);

/** LinkedIn login field IDs (update if the login page changes). */
const EMAIL_FIELD_SELECTORS = [
  '[id="«Refvl3ksop9d5j6»"]',
  "#\\«Refvl3ksop9d5j6\\»",
  'input[id*="Refvl3ksop9d5j6"]',
  "#username",
  'input[name="session_key"]',
  'input[autocomplete="username"]',
  'input[type="email"]',
];

const PASSWORD_FIELD_SELECTORS = [
  '[id="«R2nvl3ksop9d5j6»"]',
  "#\\«R2nvl3ksop9d5j6\\»",
  'input[id*="R2nvl3ksop9d5j6"]',
  "#password",
  'input[name="session_password"]',
  'input[type="password"]',
];

const SUBMIT_SELECTORS = [
  "#workspace > div > div.c89ed875.d114bd69._0bae84b7.c243a2f1.b70f8654 > div > div.bc5bd56d._278f7db9._89c2f049._4610c6cc._5c200780.c0ab5576 > div > div > div.d114bd69._0bae84b7._5c200780._65307a80._1e83b406.b70f8654 > div > div > div > div._3818a528 > div > div.bc5bd56d._278f7db9._89c2f049._3398c663._840e95fe.ce60fa81._4610c6cc > button",
  "#workspace button[type='submit']",
  "#workspace .ce60fa81._4610c6cc > button",
  "div._3818a528 button",
  'button[type="submit"]',
  'button[data-litms-control-urn="login-submit"]',
  ".btn__primary--large",
  'button[aria-label*="Sign in" i]',
  'button[aria-label*="Log in" i]',
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getActivePage(page) {
  return page.__linkedInActivePage || page;
}

function isLoginUrl(url) {
  return /linkedin\.com\/(login|uas\/login|checkpoint|authwall)/i.test(url || "");
}

async function pageShowsLoginForm(page) {
  return page.evaluate(
    (emailSels, passSels) => {
      const q = (sels) => sels.some((s) => !!document.querySelector(s));
      const hasUser =
        q(emailSels) ||
        !!document.querySelector(
          '#username, input[name="session_key"], input[autocomplete="username"]'
        );
      const hasPass =
        q(passSels) ||
        !!document.querySelector(
          '#password, input[name="session_password"], input[type="password"]'
        );
      return hasUser && hasPass;
    },
    EMAIL_FIELD_SELECTORS,
    PASSWORD_FIELD_SELECTORS
  );
}

async function needsLinkedInLogin(page) {
  const active = getActivePage(page);
  if (active.__realProfileCli) return false;

  let url = "";
  try {
    url = await active.url();
  } catch {
    return true;
  }

  if (isLoginUrl(url)) return true;
  if (/checkpoint|challenge/i.test(url)) return true;
  return pageShowsLoginForm(active);
}

async function fillField(page, selectors, value) {
  for (const sel of selectors) {
    try {
      const el = await page.waitForSelector(sel, { visible: true, timeout: 6000 });
      if (!el) continue;
      await el.click({ clickCount: 3 });
      await page.keyboard.down("Control");
      await page.keyboard.press("KeyA");
      await page.keyboard.up("Control");
      await page.keyboard.press("Backspace");
      await el.type(value, { delay: 20 });
      return { ok: true, selector: sel };
    } catch {
      /* next */
    }
  }

  const filled = await page.evaluate(
    (sels, val) => {
      for (const sel of sels) {
        const el = document.querySelector(sel);
        if (!el) continue;
        el.focus();
        el.value = val;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return sel;
      }
      return null;
    },
    selectors,
    value
  );

  if (filled) return { ok: true, selector: filled };
  return { ok: false };
}

async function clickFirst(page, selectors) {
  for (const sel of selectors) {
    try {
      const el = await page.waitForSelector(sel, { visible: true, timeout: 4000 });
      if (!el) continue;
      await el.click();
      return true;
    } catch {
      /* next */
    }
  }
  return false;
}

async function dismissCookieBanner(page) {
  await page.evaluate(() => {
    for (const btn of document.querySelectorAll("button")) {
      const t = (btn.textContent || "").toLowerCase();
      if (/accept|agree|dismiss|got it/.test(t) && t.length < 40) {
        btn.click();
        return;
      }
    }
  });
}

async function ensureLinkedInLoggedIn(page) {
  const active = getActivePage(page);
  if (active.__realProfileCli) {
    return { ok: false, reason: "cli_mode" };
  }

  if (!(await needsLinkedInLogin(active))) {
    return { ok: true, alreadyLoggedIn: true };
  }

  console.log("  → LinkedIn login (email + password)...");

  try {
    await active.goto(LOGIN_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
  } catch {
    /* may already be on login */
  }

  await sleep(2500);
  await dismissCookieBanner(active);

  const filledUser = await fillField(active, EMAIL_FIELD_SELECTORS, LINKEDIN_EMAIL);
  if (!filledUser.ok) {
    console.warn("  → Email field not found.");
    return { ok: false, reason: "email_field_not_found" };
  }
  console.log(`  → Email entered (${filledUser.selector})`);

  await sleep(400);
  const filledPass = await fillField(
    active,
    PASSWORD_FIELD_SELECTORS,
    LINKEDIN_PASSWORD
  );
  if (!filledPass.ok) {
    console.warn("  → Password field not found.");
    return { ok: false, reason: "password_field_not_found" };
  }
  console.log(`  → Password entered (${filledPass.selector})`);

  await sleep(500);
  const clicked = await clickFirst(active, SUBMIT_SELECTORS);
  if (!clicked) {
    const clickedWorkspace = await active.evaluate(() => {
      const btn = document.querySelector("#workspace button");
      if (!btn) return false;
      const r = btn.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      btn.click();
      return true;
    });
    if (!clickedWorkspace) {
      await active.keyboard.press("Enter");
      console.log("  → Sign in: pressed Enter (button selector fallback)");
    } else {
      console.log("  → Sign in: clicked #workspace button");
    }
  } else {
    console.log("  → Sign in button clicked");
  }

  console.log("  → Waiting for LinkedIn session...");
  await sleep(LOGIN_WAIT_MS);

  let url = "";
  try {
    url = await active.url();
  } catch {
    url = "";
  }

  if (/checkpoint|challenge|pin/i.test(url)) {
    console.warn(
      "  → LinkedIn security checkpoint (2FA/captcha). Complete once in bot Chrome."
    );
    return { ok: false, reason: "checkpoint" };
  }

  if ((await needsLinkedInLogin(active)) && isLoginUrl(url)) {
    console.warn("  → Still on login page after submit.");
    return { ok: false, reason: "login_failed" };
  }

  console.log("  → LinkedIn login OK.");
  return { ok: true };
}

module.exports = {
  ensureLinkedInLoggedIn,
  needsLinkedInLogin,
  isLoginUrl,
  EMAIL_FIELD_SELECTORS,
  PASSWORD_FIELD_SELECTORS,
};
