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

function loginWaitMs() {
  return solverEnabled() ? CAPTCHA_LOGIN_WAIT_MS : LOGIN_MAX_WAIT_MS;
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
      '#username, input[name="session_key"], form.login__form, [id="«r3»"], [id="«r4»"]'
    );
    const hasAppNav = !!document.querySelector(
      ".global-nav, nav.global-nav, header.global-nav, [data-global-nav]"
    );
    return hasAppNav || (!hasLoginForm && !location.pathname.includes("/login"));
  });

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

/** Reuse cookies saved in bot Chrome profile — avoids login page and new OTP emails. */
async function tryRestoreSessionFromProfile(page) {
  const active = getActivePage(page);
  try {
    await active.goto(FEED_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
  } catch {
    return false;
  }
  await sleep(2000);
  if (await isLoggedIn(page)) {
    markLoggedIn(page);
    return true;
  }
  return false;
}

async function ensureLinkedInLoggedIn(page) {
  const active = getActivePage(page);

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

  const preCaptcha = await detectCaptcha(active);
  if (preCaptcha.present) {
    console.log(
      `  → Challenge before sign-in: ${preCaptcha.type}${preCaptcha.real2fa ? " (account 2FA)" : ""}`
    );
    if (preCaptcha.solvable || !preCaptcha.real2fa) {
      await trySolveLoginCaptcha(active, performSignIn);
      await sleep(2000);
    }
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

  const emailAfterSignIn = await trySubmitEmailVerificationCode(active);
  if (emailAfterSignIn.reason === "email_code_required") {
    return { ok: false, reason: "email_code_required" };
  }

  const postCaptcha = await detectCaptcha(active);
  if (postCaptcha.present) {
    console.log(
      `  → Challenge after sign-in: ${postCaptcha.type}${postCaptcha.real2fa ? " (account 2FA)" : ""}`
    );
    if (postCaptcha.solvable || !postCaptcha.real2fa) {
      await trySolveLoginCaptcha(active, performSignIn);
    }
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
};
