const { LINKEDIN_EMAIL, LINKEDIN_PASSWORD } = require("./auth-credentials");

const LOGIN_URL = "https://www.linkedin.com/login";
const LOGIN_WAIT_MS = Number(process.env.LOGIN_WAIT_MS || 25_000);
const LOGIN_NAV_TIMEOUT_MS = Number(process.env.LOGIN_NAV_TIMEOUT_MS || 60_000);

const EMAIL_FIELD_SELECTORS = [
  '[id="«Refvl3ksop9d5j6»"]',
  'input[id*="Refvl3ksop9d5j6"]',
  "#username",
  'input[name="session_key"]',
  'input[autocomplete="username"]',
  'input[type="email"]',
];

const PASSWORD_FIELD_SELECTORS = [
  '[id="«R2nvl3ksop9d5j6»"]',
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
  'button[data-litms-control-urn="login-submit"]',
  'button[type="submit"]',
  ".btn__primary--large",
  'button[aria-label*="Sign in" i]',
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getActivePage(page) {
  return page.__linkedInActivePage || page;
}

function markLoggedIn(page) {
  const active = getActivePage(page);
  active.__linkedinLoggedIn = true;
  if (page !== active) page.__linkedinLoggedIn = true;
}

function isLoginUrl(url) {
  return /linkedin\.com\/(login|uas\/login|checkpoint|authwall)/i.test(url || "");
}

async function hasSessionCookie(page) {
  try {
    const cookies = await page.cookies();
    return cookies.some((c) => c.name === "li_at" && c.value && c.value.length > 10);
  } catch {
    return false;
  }
}

async function isLoggedIn(page) {
  const active = getActivePage(page);
  if (active.__linkedinLoggedIn) return true;
  if (await hasSessionCookie(active)) {
    markLoggedIn(page);
    return true;
  }

  let url = "";
  try {
    url = active.url();
  } catch {
    return false;
  }

  if (/checkpoint|challenge|pin|verification/i.test(url)) return false;
  if (isLoginUrl(url)) return false;

  const onLinkedInApp = await active.evaluate(() => {
    if (!location.hostname.includes("linkedin.com")) return false;
    const hasLoginForm = !!document.querySelector(
      '#username, input[name="session_key"], form.login__form'
    );
    const hasAppNav = !!document.querySelector(
      ".global-nav, nav.global-nav, header.global-nav, [data-global-nav]"
    );
    return hasAppNav || (!hasLoginForm && !location.pathname.includes("/login"));
  });

  return onLinkedInApp;
}

async function needsLinkedInLogin(page) {
  const active = getActivePage(page);
  if (active.__realProfileCli) return false;
  return !(await isLoggedIn(page));
}

async function fillFieldReact(page, selectors, value) {
  const filled = await page.evaluate(
    (sels, val) => {
      for (const sel of sels) {
        const el = document.querySelector(sel);
        if (!el) continue;
        el.focus();
        el.value = val;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, selector: sel, method: "evaluate" };
      }
      return { ok: false };
    },
    selectors,
    value
  );
  if (filled.ok) return filled;

  for (const sel of selectors) {
    try {
      const el = await page.waitForSelector(sel, { visible: true, timeout: 5000 });
      await el.click({ clickCount: 3 });
      await page.keyboard.press("Backspace");
      await el.type(value, { delay: 25 });
      return { ok: true, selector: sel, method: "type" };
    } catch {
      /* next */
    }
  }
  return { ok: false };
}

async function clickSignIn(page) {
  for (const sel of SUBMIT_SELECTORS) {
    try {
      const el = await page.waitForSelector(sel, { visible: true, timeout: 3000 });
      if (el) {
        await el.click();
        return { ok: true, selector: sel };
      }
    } catch {
      /* next */
    }
  }

  const workspace = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("#workspace button")];
    const signIn = buttons.find((b) =>
      /sign in|log in|continue/i.test(b.textContent || "")
    );
    if (signIn) {
      signIn.click();
      return "workspace-sign-in";
    }
    const submit = document.querySelector('#workspace button[type="submit"]');
    if (submit) {
      submit.click();
      return "workspace-submit";
    }
    return null;
  });

  if (workspace) return { ok: true, selector: workspace };

  await page.keyboard.press("Enter");
  return { ok: true, selector: "enter-key" };
}

async function waitForLoginSuccess(page) {
  const active = getActivePage(page);
  const deadline = Date.now() + LOGIN_NAV_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (await hasSessionCookie(active)) {
      return { ok: true, reason: "li_at cookie" };
    }
    if (await isLoggedIn(page)) {
      return { ok: true, reason: "app shell" };
    }
    await sleep(1000);
  }

  let url = "";
  try {
    url = active.url();
  } catch {
    url = "";
  }
  return { ok: false, url };
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

  if (await isLoggedIn(page)) {
    return { ok: true, alreadyLoggedIn: true };
  }

  console.log("  → LinkedIn login (email + password)...");

  try {
    await active.goto(LOGIN_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
  } catch {
    /* continue */
  }

  await sleep(3000);
  await dismissCookieBanner(active);

  const filledUser = await fillFieldReact(active, EMAIL_FIELD_SELECTORS, LINKEDIN_EMAIL);
  if (!filledUser.ok) {
    console.warn("  → Email field not found.");
    return { ok: false, reason: "email_field_not_found" };
  }
  console.log(`  → Email entered (${filledUser.selector})`);

  await sleep(500);
  const filledPass = await fillFieldReact(
    active,
    PASSWORD_FIELD_SELECTORS,
    LINKEDIN_PASSWORD
  );
  if (!filledPass.ok) {
    console.warn("  → Password field not found.");
    return { ok: false, reason: "password_field_not_found" };
  }
  console.log(`  → Password entered (${filledPass.selector})`);

  await sleep(600);
  const signIn = await clickSignIn(active);
  console.log(`  → Sign in clicked (${signIn.selector})`);

  try {
    await active.waitForNavigation({
      waitUntil: "domcontentloaded",
      timeout: LOGIN_NAV_TIMEOUT_MS,
    });
  } catch {
    /* may not navigate */
  }

  await sleep(LOGIN_WAIT_MS);

  const result = await waitForLoginSuccess(page);
  let url = "";
  try {
    url = active.url();
  } catch {
    url = "";
  }

  if (result.ok) {
    markLoggedIn(page);
    console.log(`  → LinkedIn login OK (${result.reason}).`);
    return { ok: true };
  }

  if (/checkpoint|challenge|pin|verification/i.test(url)) {
    console.warn(
      "  → LinkedIn security checkpoint (2FA/captcha). Use a fresh bot profile or login once locally and copy to Railway volume."
    );
    return { ok: false, reason: "checkpoint" };
  }

  console.warn(`  → Login not confirmed (url: ${url || "unknown"}).`);
  if (process.env.CHROME_HEADLESS === "true") {
    console.warn(
      "  → Headless server logins are often blocked by LinkedIn. Copy linkedin-bot-chrome profile from your laptop to /app/data on Railway."
    );
  }
  return { ok: false, reason: "login_failed" };
}

module.exports = {
  ensureLinkedInLoggedIn,
  needsLinkedInLogin,
  isLoggedIn,
  isLoginUrl,
};
