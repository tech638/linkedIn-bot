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

function clearLoggedIn(page) {
  const active = getActivePage(page);
  active.__linkedinLoggedIn = false;
  if (page !== active) page.__linkedinLoggedIn = false;
}

function isAuthPageUrl(url) {
  return (
    isLoginUrl(url) ||
    /session_redirect=/i.test(url || "") ||
    /ssr-login|remember-me-auto-login/i.test(url || "") ||
    /checkpoint\/challenge/i.test(url || "")
  );
}

function needsLinkedInAuth(page) {
  let url = "";
  try {
    url = getActivePage(page).url();
  } catch {
    return true;
  }
  return isAuthPageUrl(url);
}

function isLoginUrl(url) {
  return /linkedin\.com\/(login|uas\/login|checkpoint|authwall)/i.test(url || "");
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

async function logBotUrl(page, label = "") {
  try {
    const active = getActivePage(page);
    const url = active.url().replace(/^https?:\/\//, "");
    const tag = label ? `[${label}] ` : "";
    console.log(`  → URL ${tag}${url}`);
    return url;
  } catch {
    console.log(`  → URL [${label || "unknown"}] (unavailable)`);
    return "";
  }
}

async function isLoggedIn(page) {
  const active = getActivePage(page);
  let url = "";
  try {
    url = active.url();
  } catch {
    return false;
  }

  if (isAuthPageUrl(url)) {
    clearLoggedIn(page);
    return false;
  }

  if (active.__linkedinLoggedIn) return true;

  if (await readLiAtCookie(page)) {
    markLoggedIn(page);
    return true;
  }

  const onLinkedInApp = await active
    .evaluate(() => {
      if (!location.hostname.includes("linkedin.com")) return false;
      const hasLoginForm = !!document.querySelector(
        '#username, input[name="session_key"], form.login__form, [id="«r3»"], [id="«r4»"]'
      );
      const hasAppNav = !!document.querySelector(
        ".global-nav, nav.global-nav, header.global-nav, [data-global-nav]"
      );
      return hasAppNav || (!hasLoginForm && !location.pathname.includes("/login"));
    })
    .catch(() => false);

  if (onLinkedInApp) markLoggedIn(page);
  return onLinkedInApp;
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
        captchaRejected: /please provide correct input|incorrect captcha|captcha verification failed/i.test(
          text
        ),
        wrongPassword:
          /wrong password|couldn't sign|could not sign|incorrect password/i.test(text) &&
          !/please provide correct input/i.test(text),
      };
    })
    .catch(() => ({
      errText: "",
      checkpoint: false,
      captchaRejected: false,
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

async function readPagePhase(page) {
  let url = "";
  try {
    url = page.url();
  } catch {
    url = "";
  }
  const dom = await page
    .evaluate(() => {
      const text = (document.body?.innerText || "").slice(0, 5000);
      const lower = text.toLowerCase();
      return {
        autoSignIn: /we're signing you in|we are signing you in|signing you in/i.test(
          lower
        ),
        securityCheck: /quick security check|security verification|i'm not a robot/i.test(
          lower
        ),
        hasLoginForm: !!document.querySelector(
          '#username, input[name="session_key"], [id="«r3»"], [id="«r4»"]'
        ),
      };
    })
    .catch(() => ({
      autoSignIn: false,
      securityCheck: false,
      hasLoginForm: false,
    }));

  return {
    url,
    isCheckpoint: /checkpoint\/challenge/i.test(url),
    isLogin: isLoginUrl(url) || /session_redirect=/i.test(url),
    ...dom,
  };
}

/** Step 1: "We're signing you in" — wait for checkpoint or feed. */
async function waitForAutoSignIn(page, maxMs = 35_000) {
  let active = getActivePage(page);
  const deadline = Date.now() + maxMs;
  let announced = false;

  while (Date.now() < deadline) {
    const phase = await readPagePhase(active);
    if (!phase.autoSignIn) {
      if (phase.isCheckpoint) await logBotUrl(page, "checkpoint");
      return phase;
    }
    if (await isLoggedIn(page)) return phase;
    if (!announced) {
      console.log("  → Step 1: LinkedIn auto sign-in (We're signing you in)…");
      announced = true;
    }
    await sleep(2000);
    await active
      .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 5000 })
      .catch(() => null);
    active = getActivePage(page);
  }
  return readPagePhase(active);
}

/** Step 3: submit checkpoint after 2Captcha token. */
async function submitCheckpointPage(page) {
  await sleep(1500);
  const clicked = await page.evaluate(() => {
    const token = document.querySelector("#g-recaptcha-response, textarea[name='g-recaptcha-response']");
    if (token && !token.value) return "no-token";

    const verify = document.querySelector(
      "#recaptcha-verify-button, button[type='submit'], button.artdeco-button--primary"
    );
    if (verify && !verify.disabled) {
      verify.click();
      return "verify-button";
    }
    for (const b of document.querySelectorAll("button")) {
      const t = (b.textContent || b.getAttribute("aria-label") || "")
        .trim()
        .toLowerCase();
      if (/^(verify|submit|continue|next|done)$/.test(t) && !b.disabled) {
        b.click();
        return t;
      }
    }
    return null;
  });
  if (clicked === "no-token") {
    console.warn("  → Checkpoint submit skipped — token not in DOM.");
    return { ok: false, reason: "no_token" };
  }
  if (clicked) console.log(`  → Checkpoint submit: ${clicked}`);
  return { ok: Boolean(clicked) };
}

function captchaSubmitFn(page) {
  let url = "";
  try {
    url = page.url();
  } catch {
    url = "";
  }
  return /checkpoint/i.test(url) ? submitCheckpointPage : performSignIn;
}

async function tryCredentialsIfVisible(page) {
  const active = getActivePage(page);
  const phase = await readPagePhase(active);
  if (!phase.hasLoginForm) {
    console.log("  → No email/password form yet (auto sign-in or checkpoint).");
    return { ok: true, skipped: true };
  }

  console.log("  → Login page — entering email + password…");
  const filledUser = await fillFieldReact(active, EMAIL_FIELD_SELECTORS, LINKEDIN_EMAIL);
  if (!filledUser.ok) return { ok: false, reason: "email_field_not_found" };
  console.log(`  → Email entered (${filledUser.selector})`);

  await sleep(400);
  const filledPass = await fillFieldReact(
    active,
    PASSWORD_FIELD_SELECTORS,
    LINKEDIN_PASSWORD
  );
  if (!filledPass.ok) return { ok: false, reason: "password_field_not_found" };
  console.log(`  → Password entered (${filledPass.selector})`);

  await sleep(800);
  const signIn = await performSignIn(active);
  console.log(`  → Sign in submitted (${signIn.selector})`);
  await active
    .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15_000 })
    .catch(() => null);
  const waitMs = Number(process.env.LOGIN_TO_CHALLENGE_WAIT_MS || 8000);
  console.log(`  → Waiting ${Math.round(waitMs / 1000)}s for /challenge redirect…`);
  await sleep(waitMs);
  await logBotUrl(page, "after sign-in");
  return { ok: true };
}

async function gotoAfterLogin(page, targetUrl) {
  if (!targetUrl) return;
  const active = getActivePage(page);
  console.log(`  → Opening after login: ${targetUrl.replace(/^https?:\/\//, "")}`);
  try {
    await active.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
  } catch {
    /* continue */
  }
  await sleep(2000);
  await logBotUrl(page, "after login");
}

/**
 * Step 2–3: security check + reCAPTCHA (2Captcha) until logged in.
 */
async function resolveLoginChallenges(page, targetUrl = FEED_URL) {
  let active = getActivePage(page);
  const started = Date.now();
  let lastLog = 0;
  let captchaSolveCount = 0;
  const maxCaptchaAttempts = Number(process.env.CAPTCHA_MAX_ATTEMPTS || 4);
  const maxWait = loginWaitMs();

  console.log(
    `  → Login flow (up to ${Math.round(maxWait / 1000)}s${solverEnabled() ? ", 2Captcha on" : ""})…`
  );

  while (Date.now() - started < maxWait) {
    active = await refreshPageIfDetached(page);
    await waitForAutoSignIn(page, 10_000);

    if (await hasSessionCookie(active) || (await isLoggedIn(page))) {
      await gotoAfterLogin(page, targetUrl);
      if (await isLoggedIn(page)) return { ok: true, reason: "logged_in" };
    }

    const emailCode = await trySubmitEmailVerificationCode(active);
    if (emailCode.reason === "email_code_required") {
      return { ok: false, reason: "email_code_required" };
    }
    if (emailCode.ok) {
      await sleep(3000);
      continue;
    }

    const phase = await readPagePhase(active);
    const state = await readLoginPageState(active);

    if (state.captchaRejected && captchaSolveCount < maxCaptchaAttempts) {
      console.warn("  → Captcha rejected by LinkedIn — retrying with enterprise key…");
      captchaSolveCount++;
      await trySolveLoginCaptcha(active, captchaSubmitFn(active));
      await sleep(3000);
      continue;
    }

    if (state.wrongPassword || (state.errText && !state.captchaRejected)) {
      return {
        ok: false,
        reason: "bad_credentials",
        url: state.url,
        detail: state.errText,
      };
    }

    if (state.real2fa || (state.checkpoint && isReal2FA(state.captchaType))) {
      return {
        ok: false,
        reason: "checkpoint",
        url: state.url,
        captchaType: state.captchaType,
        real2fa: true,
      };
    }

    const { isChallengeCaptchaUrl } = require("./linkedin-captcha");
    let currentUrl = "";
    try {
      currentUrl = active.url();
    } catch {
      currentUrl = "";
    }

    if (
      isChallengeCaptchaUrl(currentUrl) &&
      captchaSolveCount < maxCaptchaAttempts
    ) {
      console.log("  → Step 2: LinkedIn security check on /challenge — sending to 2Captcha…");
      captchaSolveCount++;
      const solved = await trySolveLoginCaptcha(active, captchaSubmitFn(active));
      if (solved.ok) {
        console.log("  → Step 3: reCAPTCHA solved via 2Captcha, submitting…");
      } else if (solved.reason === "challenge_url_timeout" || solved.reason === "no_challenge_url") {
        console.log("  → Captcha solve skipped — not on /checkpoint/challenge/ yet.");
        captchaSolveCount = Math.max(0, captchaSolveCount - 1);
      }
      await sleep(3000);
      await active
        .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20_000 })
        .catch(() => null);
      continue;
    }

    if (phase.hasLoginForm && !phase.autoSignIn) {
      await tryCredentialsIfVisible(page);
      continue;
    }

    const elapsed = Math.round((Date.now() - started) / 1000);
    if (Date.now() - lastLog >= LOGIN_PROGRESS_LOG_MS) {
      await logBotUrl(page, `login ${elapsed}s`);
      lastLog = Date.now();
    }

    await sleep(LOGIN_POLL_MS);
  }

  const state = await readLoginPageState(active);
  await logBotUrl(page, "login timeout");
  return { ok: false, url: state.url, captchaType: state.captchaType, reason: "timeout" };
}

/** Same flow as local: login → wait → /challenge → 2Captcha → open target URL. */
async function ensureAuthForTarget(page, targetUrl) {
  if (await isLoggedIn(page)) {
    return { ok: true, alreadyLoggedIn: true };
  }

  let url = "";
  try {
    url = getActivePage(page).url();
  } catch {
    url = "";
  }

  if (!isAuthPageUrl(url)) {
    return ensureLinkedInLoggedIn(page, { targetUrl });
  }

  console.log("  → Auth required — login → /challenge → 2Captcha…");
  await dismissCookieBanner(getActivePage(page));
  await waitForAutoSignIn(page);
  await tryCredentialsIfVisible(page);
  const result = await resolveLoginChallenges(page, targetUrl);

  if (result.ok) {
    markLoggedIn(page);
    await gotoAfterLogin(page, targetUrl);
    if (await isLoggedIn(page)) return { ok: true };
  }
  return result;
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

/** Reuse cookies saved in bot Chrome profile — avoids login page and new OTP emails. */
async function tryRestoreSessionFromProfile(page) {
  let active = getActivePage(page);

  for (const navUrl of [FEED_URL, "https://www.linkedin.com/"]) {
    console.log(`  → Session check: opening ${navUrl.replace(/^https?:\/\//, "")}`);
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
    await logBotUrl(page, "session check");
    let pageUrl = "";
    try {
      pageUrl = active.url();
    } catch {
      pageUrl = "";
    }
    if (isAuthPageUrl(pageUrl)) {
      console.log("  → Session not valid (login/checkpoint redirect).");
      return false;
    }
    const emailCode = await trySubmitEmailVerificationCode(active);
    if (emailCode.ok) await sleep(2000);
    if (await isLoggedIn(page)) {
      markLoggedIn(page);
      return true;
    }
  }
  return false;
}

async function ensureLinkedInLoggedIn(page, options = {}) {
  const targetUrl = options.targetUrl || FEED_URL;
  let active = getActivePage(page);

  if (await isLoggedIn(page)) {
    await logBotUrl(page, "already logged in");
    markLoggedIn(page);
    return { ok: true, alreadyLoggedIn: true };
  }

  if (await tryRestoreSessionFromProfile(page)) {
    console.log("  → Session restored from bot profile.");
    return { ok: true, alreadyLoggedIn: true, sessionFromProfile: true };
  }

  const phase = await readPagePhase(active);
  if (!phase.isLogin && !phase.isCheckpoint && !phase.autoSignIn) {
    console.log("  → LinkedIn login (opening login page)...");
    try {
      await active.goto(LOGIN_URL, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
    } catch {
      /* continue */
    }
    await logBotUrl(page, "login page");
    await sleep(2000);
    await dismissCookieBanner(active);
    active = await refreshPageIfDetached(page);
  } else {
    console.log("  → LinkedIn login flow (redirect / checkpoint)…");
    await logBotUrl(page, "auth page");
    await dismissCookieBanner(active);
  }

  await waitForAutoSignIn(page);
  await tryCredentialsIfVisible(page);
  const result = await resolveLoginChallenges(page, targetUrl);

  if (result.ok) {
    markLoggedIn(page);
    await logBotUrl(page, "login OK");
    console.log(`  → LinkedIn login OK (${result.reason}).`);
    return { ok: true };
  }

  if (result.reason === "email_code_required") {
    return { ok: false, reason: "email_code_required" };
  }

  if (result.reason === "checkpoint") {
    console.warn(`  → LinkedIn verification blocked (${result.captchaType}).`);
    return { ok: false, reason: "checkpoint", captchaType: result.captchaType };
  }

  if (result.reason === "bad_credentials") {
    console.warn(`  → Login rejected: ${result.detail || "check email/password"}.`);
    return { ok: false, reason: "bad_credentials" };
  }

  console.warn(
    `  → Login failed (url: ${result.url || "unknown"}${result.captchaType ? `, captcha: ${result.captchaType}` : ""}).`
  );
  return { ok: false, reason: result.reason || "login_failed", captchaType: result.captchaType };
}

module.exports = {
  ensureLinkedInLoggedIn,
  ensureAuthForTarget,
  needsLinkedInLogin,
  isLoggedIn,
  isLoginUrl,
  isAuthPageUrl,
  needsLinkedInAuth,
  markLoggedIn,
  clearLoggedIn,
  hasSessionCookie,
  logBotUrl,
  tryRestoreSessionFromProfile,
};
