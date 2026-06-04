const { LINKEDIN_EMAIL, LINKEDIN_PASSWORD } = require("./auth-credentials");
const {
  detectCaptcha,
  trySolveLoginCaptcha,
  solverEnabled,
  isReal2FA,
} = require("./linkedin-captcha");
const { trySubmitEmailVerificationCode } = require("./linkedin-email-code");

const LOGIN_URL = "https://www.linkedin.com/login";
const FEED_URL = "https://www.linkedin.com/feed/";
const LOGIN_POLL_MS = Number(process.env.LOGIN_POLL_MS || 2000);
const LOGIN_MAX_WAIT_MS = Number(process.env.LOGIN_MAX_WAIT_MS || 45_000);
const LOGIN_PROGRESS_LOG_MS = Number(process.env.LOGIN_PROGRESS_LOG_MS || 5000);
const CAPTCHA_LOGIN_WAIT_MS = Number(process.env.CAPTCHA_LOGIN_WAIT_MS || 180_000);

const EMAIL_FIELD_SELECTORS = [
  '[id="«r3»"]',
  'input[id="«r3»"]',
  '[id="«Refvl3ksop9d5j6»"]',
  'input[id*="Refvl3ksop9d5j6"]',
  "#username",
  'input[name="session_key"]',
  'input[autocomplete="username"]',
  'input[type="email"]',
];

const PASSWORD_FIELD_SELECTORS = [
  '[id="«r4»"]',
  'input[id="«r4»"]',
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
  const active = page.__linkedInActivePage || page;
  try {
    if (typeof active.isClosed === "function" && active.isClosed()) {
      return active;
    }
    active.url();
    return active;
  } catch {
    const browser = page.__browser;
    if (browser) {
      return browser.__lastPage || active;
    }
    return active;
  }
}

async function refreshPageIfDetached(page) {
  const browser = page.__browser;
  if (!browser) return getActivePage(page);
  try {
    getActivePage(page).url();
    return getActivePage(page);
  } catch {
    const pages = await browser.pages();
    const fresh = pages[pages.length - 1] || (await browser.newPage());
    page.__linkedInActivePage = fresh;
    browser.__lastPage = fresh;
    const { applyStealthToPage } = require("./browser-stealth");
    await applyStealthToPage(fresh);
    console.log("  → Page refreshed after navigation (detached frame).");
    return fresh;
  }
}

function markLoggedIn(page) {
  const active = getActivePage(page);
  active.__linkedinLoggedIn = true;
  if (page !== active) page.__linkedinLoggedIn = true;
}

function isLoginUrl(url) {
  return /linkedin\.com\/(login|uas\/login|checkpoint|authwall)/i.test(url || "");
}

function isLoginRedirectUrl(url) {
  return (
    isLoginUrl(url) ||
    /session_redirect=/i.test(url || "") ||
    /linkedin\.com\/checkpoint/i.test(url || "")
  );
}

function parseSessionRedirect(url) {
  const m = String(url || "").match(/session_redirect=([^&]+)/i);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

function clearLoggedIn(page) {
  const active = getActivePage(page);
  active.__linkedinLoggedIn = false;
  if (page !== active) page.__linkedinLoggedIn = false;
}

function loginWaitMs() {
  return solverEnabled() ? CAPTCHA_LOGIN_WAIT_MS : LOGIN_MAX_WAIT_MS;
}

async function readLiAtCookie(page) {
  const active = getActivePage(page);
  const hasLiAt = (list) =>
    !!list?.some((c) => c.name === "li_at" && c.value && c.value.length > 10);

  try {
    const cookies = await active.cookies("https://www.linkedin.com");
    if (hasLiAt(cookies)) return true;
  } catch {
    /* page may be detached */
  }

  try {
    const browser = active.browser?.();
    if (!browser) return false;
    const pages = await browser.pages();
    for (const p of pages) {
      try {
        const cookies = await p.cookies("https://www.linkedin.com");
        if (hasLiAt(cookies)) return true;
      } catch {
        /* try next tab */
      }
    }
  } catch {
    return false;
  }
  return false;
}

async function hasSessionCookie(page) {
  return readLiAtCookie(page);
}

async function isLoggedIn(page) {
  const active = getActivePage(page);
  let url = "";
  try {
    url = active.url();
  } catch {
    return false;
  }

  if (isLoginRedirectUrl(url)) {
    clearLoggedIn(page);
    return false;
  }

  const state = await active
    .evaluate(() => {
      const text = (document.body?.innerText || "").slice(0, 5000).toLowerCase();
      const securityWall =
        /let's do a quick security check|i'm not a robot|unusual activity|verify it's you|security verification/.test(
          text
        );
      const hasLoginForm = !!document.querySelector(
        '#username, input[name="session_key"], form.login__form, [id="«r3»"], [id="«r4»"]'
      );
      const hasAppNav = !!document.querySelector(
        ".global-nav, nav.global-nav, header.global-nav, [data-global-nav]"
      );
      const onGroupFeed =
        location.pathname.includes("/groups/") &&
        !securityWall &&
        !hasLoginForm &&
        (hasAppNav ||
          !!document.querySelector(
            ".share-box-feed-entry__trigger, button[aria-label*='Start a post' i]"
          ));
      return { securityWall, hasLoginForm, hasAppNav, onGroupFeed };
    })
    .catch(() => ({
      securityWall: true,
      hasLoginForm: true,
      hasAppNav: false,
      onGroupFeed: false,
    }));

  if (state.securityWall) {
    clearLoggedIn(page);
    return false;
  }
  if (state.hasLoginForm && !state.hasAppNav) {
    clearLoggedIn(page);
    return false;
  }
  if (state.hasAppNav || state.onGroupFeed) {
    markLoggedIn(page);
    return true;
  }

  if (
    active.__linkedinLoggedIn &&
    (await readLiAtCookie(page)) &&
    /linkedin\.com\/(feed|groups|in\/)/i.test(url)
  ) {
    return true;
  }

  return false;
}

async function needsLinkedInLogin(page) {
  return !(await isLoggedIn(page));
}

async function readLoginPageState(page) {
  let url = "";
  try {
    url = page.url();
  } catch {
    url = "";
  }

  const captcha = await detectCaptcha(page);

  const body = await page
    .evaluate(() => {
      const text = (document.body?.innerText || "").slice(0, 4000).toLowerCase();
      const errEl = document.querySelector(
        ".form__error, .alert-error, [role='alert'], .error-for-password, .error-for-username"
      );
      const errText = (errEl?.textContent || "").trim().slice(0, 120);
      return {
        errText,
        checkpoint: /checkpoint|challenge|security verification|quick security check|verify it's you/i.test(
          text
        ),
        wrongPassword: /wrong password|couldn't sign|could not sign|incorrect password/i.test(
          text
        ),
      };
    })
    .catch(() => ({
      errText: "",
      checkpoint: false,
      wrongPassword: false,
    }));

  return {
    url,
    ...body,
    hasCaptcha: captcha.solvable,
    captchaType: captcha.type,
    real2fa: captcha.real2fa,
    anyChallenge: captcha.present,
  };
}

async function fillFieldReact(page, selectors, value) {
  for (const sel of selectors) {
    try {
      const el = await page.waitForSelector(sel, { visible: true, timeout: 4000 });
      await el.click({ clickCount: 3 });
      await page.keyboard.press("Backspace");
      await el.type(value, { delay: 35 });
      const ok = await page.evaluate((s) => {
        const el = document.querySelector(s);
        return el && (el.value || "").length > 0;
      }, sel);
      if (ok) return { ok: true, selector: sel, method: "type" };
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
        el.dispatchEvent(new InputEvent("input", { bubbles: true, data: val }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, selector: sel, method: "evaluate" };
      }
      return { ok: false };
    },
    selectors,
    value
  );
  return filled.ok ? filled : { ok: false };
}

async function waitForSignInButtonEnabled(page, timeoutMs = 15_000) {
  try {
    await page.waitForFunction(
      () => {
        const buttons = [...document.querySelectorAll("#workspace button")];
        const signIn = buttons.find((b) =>
          /sign in|log in/i.test(b.textContent || "")
        );
        if (!signIn) return false;
        const r = signIn.getBoundingClientRect();
        return r.height > 0 && !signIn.disabled && !signIn.getAttribute("aria-disabled");
      },
      { timeout: timeoutMs }
    );
    return true;
  } catch {
    return false;
  }
}

async function diagnoseLoginPage(page) {
  const info = await page
    .evaluate(() => {
      const buttons = [...document.querySelectorAll("#workspace button")];
      const signIn = buttons.find((b) => /sign in|log in/i.test(b.textContent || ""));
      const errs = [...document.querySelectorAll("[role='alert'], .form__error, .error-for-password, .error-for-username")]
        .map((e) => (e.textContent || "").trim())
        .filter((t) => t.length > 0 && t.length < 200);
      const iframes = [...document.querySelectorAll("iframe")]
        .map((f) => (f.src || "").slice(0, 100))
        .filter(Boolean);
      return {
        signInDisabled: signIn?.disabled ?? null,
        signInText: (signIn?.textContent || "").trim().slice(0, 40),
        errors: errs.slice(0, 3),
        iframeCount: iframes.length,
        iframeSamples: iframes.slice(0, 4),
        cookieLiAt: document.cookie.includes("li_at="),
      };
    })
    .catch(() => ({}));

  console.log(
    `  → Login debug: sign-in disabled=${info.signInDisabled} iframes=${info.iframeCount} li_at=${info.cookieLiAt}`
  );
  if (info.errors?.length) console.log(`  → Page errors: ${info.errors.join(" | ")}`);
  if (info.iframeSamples?.length) {
    for (const src of info.iframeSamples) {
      console.log(`     iframe: ${src}`);
    }
  }
  return info;
}

async function submitLoginForm(page) {
  return page.evaluate(() => {
    const form = document.querySelector("form");
    if (form && typeof form.requestSubmit === "function") {
      form.requestSubmit();
      return "form.requestSubmit";
    }
    if (form) {
      form.submit();
      return "form.submit";
    }
    return null;
  });
}

async function clickSignIn(page) {
  await waitForSignInButtonEnabled(page, 12_000);

  for (const sel of SUBMIT_SELECTORS) {
    try {
      const el = await page.waitForSelector(sel, { visible: true, timeout: 3000 });
      const disabled = await page.evaluate((s) => {
        const node = document.querySelector(s);
        return node?.disabled || node?.getAttribute("aria-disabled") === "true";
      }, sel);
      if (disabled) continue;
      await el.click();
      return { ok: true, selector: sel };
    } catch {
      /* next */
    }
  }

  const workspace = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("#workspace button")];
    const signIn = buttons.find((b) =>
      /sign in|log in|continue/i.test(b.textContent || "")
    );
    if (signIn && !signIn.disabled) {
      signIn.click();
      return "workspace-sign-in";
    }
    const submit = document.querySelector('#workspace button[type="submit"]');
    if (submit && !submit.disabled) {
      submit.click();
      return "workspace-submit";
    }
    return null;
  });

  if (workspace) return { ok: true, selector: workspace };

  await page.keyboard.press("Enter");
  return { ok: true, selector: "enter-key" };
}

async function tryAdvanceSecurityCheck(page) {
  const clicked = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button, [role='button']")];
    for (const b of buttons) {
      const t = (b.textContent || b.getAttribute("aria-label") || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      if (
        /^(continue|submit|verify|next|done|sign in|log in)$/.test(t) ||
        (t.includes("continue") && t.length < 24)
      ) {
        if (!b.disabled && b.getAttribute("aria-disabled") !== "true") {
          b.click();
          return t;
        }
      }
    }
    const form = document.querySelector("form");
    if (form && typeof form.requestSubmit === "function") {
      form.requestSubmit();
      return "form.requestSubmit";
    }
    return null;
  });
  if (clicked) console.log(`  → Security check continue: ${clicked}`);
  return { ok: Boolean(clicked), selector: clicked || "none" };
}

async function tryFillLoginCredentials(page) {
  const active = getActivePage(page);
  const hasEmail = await active.evaluate((sels) => {
    return sels.some((s) => document.querySelector(s));
  }, EMAIL_FIELD_SELECTORS);
  if (!hasEmail) return { ok: false, reason: "no_login_form" };

  const filledUser = await fillFieldReact(active, EMAIL_FIELD_SELECTORS, LINKEDIN_EMAIL);
  if (!filledUser.ok) return { ok: false, reason: "email_field_not_found" };
  await sleep(400);
  const filledPass = await fillFieldReact(
    active,
    PASSWORD_FIELD_SELECTORS,
    LINKEDIN_PASSWORD
  );
  if (!filledPass.ok) return { ok: false, reason: "password_field_not_found" };
  console.log("  → Email + password entered on login redirect.");
  const signIn = await performSignIn(active);
  console.log(`  → Sign in submitted (${signIn.selector})`);
  await active
    .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15_000 })
    .catch(() => null);
  await sleep(2000);
  return { ok: true };
}

/**
 * LinkedIn redirected to login / security check (reCAPTCHA). Solve and return to target URL.
 */
async function handleLinkedInAuthWall(page, { targetUrl } = {}) {
  const { detectCaptcha, trySolveLoginCaptcha, solverEnabled } = require("./linkedin-captcha");

  clearLoggedIn(page);
  let active = getActivePage(page);
  const maxAttempts = Number(process.env.AUTH_WALL_MAX_ATTEMPTS || 4);
  let dest = targetUrl || parseSessionRedirect(active.url()) || FEED_URL;

  console.log("  → LinkedIn auth wall detected (login redirect or security check).");

  if (!solverEnabled()) {
    console.warn("  → Enable TWOCAPTCHA_API_KEY + CAPTCHA_SOLVER_ENABLED to pass reCAPTCHA headless.");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    active = await refreshPageIfDetached(page);
    let url = "";
    try {
      url = active.url();
    } catch {
      url = "";
    }
    const redirect = parseSessionRedirect(url);
    if (redirect) dest = redirect;

    console.log(
      `  → Auth wall ${attempt}/${maxAttempts}: ${(url || "unknown").replace(/^https?:\/\//, "").slice(0, 110)}`
    );

    const emailCode = await trySubmitEmailVerificationCode(active);
    if (emailCode.reason === "email_code_required") {
      return { ok: false, reason: "email_code_required" };
    }

    const captcha = await detectCaptcha(active);
    if (captcha.present && captcha.solvable) {
      console.log(`  → Security challenge: ${captcha.type}`);
      await trySolveLoginCaptcha(active, tryAdvanceSecurityCheck);
      await sleep(3000);
      active = await refreshPageIfDetached(page);
    } else if (captcha.present && captcha.type === "linkedin_security_check") {
      console.warn("  → Security check visible but captcha widget not detected yet — retrying…");
      await sleep(3000);
      continue;
    }

    if (isLoginRedirectUrl(url) || (await needsLinkedInLogin(page))) {
      const creds = await tryFillLoginCredentials(active);
      if (creds.ok) {
        const postCap = await detectCaptcha(active);
        if (postCap.present && postCap.solvable) {
          await trySolveLoginCaptcha(active, tryAdvanceSecurityCheck);
          await sleep(2500);
        }
        const after = await waitAfterSignIn(page);
        if (!after.ok && after.reason === "email_code_required") {
          return { ok: false, reason: "email_code_required" };
        }
      }
    }

    if (await isLoggedIn(page)) {
      try {
        console.log(`  → Auth cleared — opening: ${dest.replace(/^https?:\/\//, "").slice(0, 100)}`);
        await active.goto(dest, {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        });
        await sleep(Number(process.env.GROUP_PAGE_LOAD_MS || 15_000) / 2);
      } catch {
        /* continue */
      }
      active = await refreshPageIfDetached(page);
      if (await isLoggedIn(page)) {
        markLoggedIn(page);
        return { ok: true };
      }
    }

    await sleep(2000);
  }

  let finalUrl = "";
  try {
    finalUrl = getActivePage(page).url();
  } catch {
    finalUrl = "";
  }
  console.warn(
    `  → Auth wall not cleared (still on ${finalUrl.replace(/^https?:\/\//, "").slice(0, 100)}).`
  );
  return { ok: false, reason: "auth_wall", url: finalUrl };
}

async function performSignIn(page) {
  try {
    const pass = await page.$(PASSWORD_FIELD_SELECTORS[0]);
    if (pass) {
      await pass.focus();
      await page.keyboard.press("Enter");
      await sleep(800);
    }
  } catch {
    /* ignore */
  }

  const click = await clickSignIn(page);
  await sleep(400);
  const formMethod = await submitLoginForm(page);
  if (formMethod) console.log(`  → Also submitted via ${formMethod}`);
  return click;
}

async function maybeSolveCaptcha(page, captchaSolveCount, maxAttempts) {
  if (captchaSolveCount >= maxAttempts) return captchaSolveCount;

  const captcha = await detectCaptcha(page);
  if (!captcha.present) return captchaSolveCount;

  const solved = await trySolveLoginCaptcha(page, performSignIn);
  return solved.ok || solved.unsolvable ? captchaSolveCount + 1 : captchaSolveCount + 1;
}

async function waitAfterSignIn(page) {
  const active = getActivePage(page);
  const started = Date.now();
  let lastLog = 0;
  let lastUrl = "";
  let captchaSolveCount = 0;
  const maxCaptchaAttempts = Number(process.env.CAPTCHA_MAX_ATTEMPTS || 2);
  const maxWait = loginWaitMs();

  console.log(
    `  → Waiting for login (up to ${Math.round(maxWait / 1000)}s${solverEnabled() ? ", 2Captcha on" : ""})...`
  );

  while (Date.now() - started < maxWait) {
    if (await hasSessionCookie(active)) {
      return { ok: true, reason: "li_at cookie" };
    }
    if (await isLoggedIn(page)) {
      return { ok: true, reason: "app shell" };
    }

    const emailCode = await trySubmitEmailVerificationCode(active);
    if (emailCode.ok) {
      await sleep(3000);
      continue;
    }
    if (emailCode.reason === "email_code_required") {
      return { ok: false, reason: "email_code_required", captchaType: "linkedin_email_verification" };
    }

    const state = await readLoginPageState(active);

    if (state.hasCaptcha && captchaSolveCount < maxCaptchaAttempts) {
      console.log(`  → Captcha on page (detected: ${state.captchaType})`);
      captchaSolveCount = await maybeSolveCaptcha(
        active,
        captchaSolveCount,
        maxCaptchaAttempts
      );
      await sleep(3000);
      continue;
    }

    if (state.anyChallenge && !state.hasCaptcha && captchaSolveCount < maxCaptchaAttempts) {
      captchaSolveCount = await maybeSolveCaptcha(
        active,
        captchaSolveCount,
        maxCaptchaAttempts
      );
      await sleep(3000);
      continue;
    }

    if (state.real2fa || (state.checkpoint && isReal2FA(state.captchaType))) {
      const cap = await detectCaptcha(active);
      return {
        ok: false,
        reason: "checkpoint",
        url: state.url,
        captchaType: cap.type,
        real2fa: true,
      };
    }

    if (state.checkpoint && !state.hasCaptcha && captchaSolveCount >= maxCaptchaAttempts) {
      const cap = await detectCaptcha(active);
      return {
        ok: false,
        reason: "checkpoint",
        url: state.url,
        captchaType: cap.type,
        real2fa: cap.real2fa,
      };
    }

    if (state.wrongPassword || state.errText) {
      return {
        ok: false,
        reason: "bad_credentials",
        url: state.url,
        detail: state.errText || "wrong password",
      };
    }

    const elapsed = Math.round((Date.now() - started) / 1000);

    if (isLoginUrl(state.url) && elapsed >= 8 && captchaSolveCount < maxCaptchaAttempts) {
      const cap = await detectCaptcha(active);
      if (cap.present) {
        console.log(`  → Still on /login/ — challenge detected: ${cap.type}`);
        captchaSolveCount = await maybeSolveCaptcha(
          active,
          captchaSolveCount,
          maxCaptchaAttempts
        );
        if (captchaSolveCount <= maxCaptchaAttempts) {
          await performSignIn(active);
        }
        await sleep(3000);
        continue;
      }
    }

    if (isLoginUrl(state.url) && elapsed >= 20 && elapsed % 30 < 6) {
      await diagnoseLoginPage(active);
      const cap = await detectCaptcha(active);
      if (cap.present) {
        console.log(`  → Stuck on login — detected: ${cap.type}`);
      }
    }

    if (Date.now() - lastLog >= LOGIN_PROGRESS_LOG_MS) {
      const shortUrl = (state.url || "").replace(/^https?:\/\//, "").slice(0, 80);
      const capNote = state.anyChallenge
        ? ` [challenge: ${state.captchaType}]`
        : isLoginUrl(state.url)
          ? " [still on /login — check credentials or LINKEDIN_VERIFICATION_CODE]"
          : "";
      console.log(`  → Login still pending (${elapsed}s) — ${shortUrl || "no url"}${capNote}`);
      lastLog = Date.now();
    }

    if (state.url !== lastUrl && state.url && !isLoginUrl(state.url)) {
      console.log(`  → Navigated: ${state.url.replace(/^https?:\/\//, "").slice(0, 100)}`);
      lastUrl = state.url;
    }

    await sleep(LOGIN_POLL_MS);
  }

  const state = await readLoginPageState(active);
  await diagnoseLoginPage(active);
  return { ok: false, url: state.url, captchaType: state.captchaType };
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

function isGroupPageUrl(url) {
  return /linkedin\.com\/groups\//i.test(url || "");
}

/** Reuse cookies saved in bot Chrome profile — avoids login page and new OTP emails. */
async function tryRestoreSessionFromProfile(page) {
  let active = getActivePage(page);
  let currentUrl = "";
  try {
    currentUrl = active.url();
  } catch {
    currentUrl = "";
  }

  // Keep group URL during posting — only validate session in-place.
  if (
    isGroupPageUrl(currentUrl) &&
    !isLoginUrl(currentUrl) &&
    (await readLiAtCookie(page))
  ) {
    await sleep(1500);
    if (await isLoggedIn(page)) {
      markLoggedIn(page);
      return true;
    }
  }

  for (const navUrl of [FEED_URL, "https://www.linkedin.com/"]) {
    try {
      await active.goto(navUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
    } catch {
      active = await refreshPageIfDetached(page);
      continue;
    }
    await sleep(2000);
    const emailCode = await trySubmitEmailVerificationCode(active);
    if (emailCode.ok) {
      await sleep(2000);
    }

    let pageUrl = "";
    try {
      pageUrl = active.url();
    } catch {
      pageUrl = "";
    }

    if (isLoginRedirectUrl(pageUrl) || !(await isLoggedIn(page))) {
      const cleared = await handleLinkedInAuthWall(page, { targetUrl: navUrl });
      if (cleared.ok && (await isLoggedIn(page))) {
        markLoggedIn(page);
        return true;
      }
      return false;
    }

    if (await isLoggedIn(page)) {
      markLoggedIn(page);
      return true;
    }
  }
  return false;
}

async function ensureLinkedInLoggedIn(page) {
  const active = getActivePage(page);

  // Do not navigate to /feed/ if already logged in on the current page (e.g. group URL).
  if (await isLoggedIn(page)) {
    markLoggedIn(page);
    return { ok: true, alreadyLoggedIn: true };
  }

  let currentUrl = "";
  try {
    currentUrl = active.url();
  } catch {
    currentUrl = "";
  }

  if (isLoginRedirectUrl(currentUrl)) {
    const wall = await handleLinkedInAuthWall(page, {
      targetUrl: parseSessionRedirect(currentUrl) || FEED_URL,
    });
    if (wall.ok) return { ok: true, reason: "auth_wall_cleared" };
    return { ok: false, reason: wall.reason || "auth_wall" };
  }

  if (await tryRestoreSessionFromProfile(page)) {
    console.log(
      "  → Session restored from bot profile (skipped login — no new OTP email)."
    );
    return { ok: true, alreadyLoggedIn: true, sessionFromProfile: true };
  }

  if (await isLoggedIn(page)) {
    console.log("  → LinkedIn already logged in (bot profile).");
    return { ok: true, alreadyLoggedIn: true };
  }

  console.log(
    "  → No saved session — full login (LinkedIn may email a 6-digit code once)."
  );

  if (solverEnabled()) {
    console.log("  → 2Captcha solver enabled for login.");
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

  await sleep(2000);
  await dismissCookieBanner(active);

  active = await refreshPageIfDetached(page);

  const emailOnLogin = await trySubmitEmailVerificationCode(active);
  if (emailOnLogin.reason === "email_code_required") {
    return { ok: false, reason: "email_code_required" };
  }
  if (emailOnLogin.ok) {
    if (await isLoggedIn(page)) {
      markLoggedIn(page);
      return { ok: true, reason: "email_code" };
    }
  }

  const preCaptcha = await detectCaptcha(active);
  if (preCaptcha.present && preCaptcha.solvable) {
    console.log(`  → Captcha before sign-in: ${preCaptcha.type}`);
    await trySolveLoginCaptcha(active, performSignIn);
    await sleep(2000);
    active = await refreshPageIfDetached(page);
  }

  const filledUser = await fillFieldReact(active, EMAIL_FIELD_SELECTORS, LINKEDIN_EMAIL);
  if (!filledUser.ok) {
    console.warn("  → Email field not found.");
    return { ok: false, reason: "email_field_not_found" };
  }
  console.log(`  → Email entered (${filledUser.selector})`);

  await sleep(400);
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

  await sleep(800);
  const signIn = await performSignIn(active);
  console.log(`  → Sign in submitted (${signIn.selector})`);

  await active
    .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 12_000 })
    .catch(() => null);

  await sleep(2000);
  active = await refreshPageIfDetached(page);

  const emailAfterSignIn = await trySubmitEmailVerificationCode(active);
  if (emailAfterSignIn.reason === "email_code_required") {
    return { ok: false, reason: "email_code_required" };
  }

  const postCaptcha = await detectCaptcha(active);
  if (postCaptcha.present && postCaptcha.solvable) {
    console.log(`  → Captcha after sign-in: ${postCaptcha.type}`);
    await trySolveLoginCaptcha(active, performSignIn);
    active = await refreshPageIfDetached(page);
  }

  const result = await waitAfterSignIn(page);

  if (result.ok) {
    markLoggedIn(page);
    console.log(`  → LinkedIn login OK (${result.reason}).`);
    console.log(
      "  → Session saved in bot Chrome profile. Next restart should NOT need OTP if Railway volume is mounted at /app/data."
    );
    console.log(
      "  → After a good login you can remove LINKEDIN_VERIFICATION_CODE from Railway variables."
    );
    return { ok: true };
  }

  if (result.reason === "email_code_required") {
    return { ok: false, reason: "email_code_required" };
  }

  if (result.reason === "checkpoint") {
    if (result.captchaType === "linkedin_email_verification") {
      console.warn("  → LinkedIn email 6-digit code required — see LINKEDIN_VERIFICATION_CODE.");
    } else if (result.real2fa || isReal2FA(result.captchaType)) {
      console.warn(
        `  → LinkedIn account verification (${result.captchaType}) — enter code once in bot Chrome.`
      );
    } else {
      console.warn(
        `  → LinkedIn security check (${result.captchaType}) — not account 2FA; often datacenter/headless. 2Captcha may still apply on retry.`
      );
    }
    return { ok: false, reason: "checkpoint", captchaType: result.captchaType };
  }

  if (result.reason === "bad_credentials") {
    console.warn(`  → Login rejected: ${result.detail || "check email/password"}.`);
    return { ok: false, reason: "bad_credentials" };
  }

  const url = result.url || "";
  console.warn(
    `  → Login failed after ${Math.round(loginWaitMs() / 1000)}s (url: ${url || "unknown"}${result.captchaType ? `, captcha: ${result.captchaType}` : ""}).`
  );
  return { ok: false, reason: "login_failed", captchaType: result.captchaType };
}

module.exports = {
  ensureLinkedInLoggedIn,
  needsLinkedInLogin,
  isLoggedIn,
  isLoginUrl,
  isLoginRedirectUrl,
  markLoggedIn,
  clearLoggedIn,
  hasSessionCookie,
  handleLinkedInAuthWall,
  tryRestoreSessionFromProfile,
};
