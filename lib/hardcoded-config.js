/**
 * Single source of truth — edit this file only (no .env).
 * Credentials: lib/auth-credentials.js
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

const IS_SERVER = fs.existsSync("/app/data");
const HOME = os.homedir();
const ROOT = path.join(__dirname, "..");

module.exports = {
  // ─── Mode ───────────────────────────────────────────────────────
  USE_SHEET_GROUPS: "true",
  TEST_MODE: "true",
  RAILWAY_TEST_SCHEDULE: IS_SERVER ? "true" : "false",
  ENGAGE_ONLY: "false",
  POST_ONLY: "false",
  CLICK_POST_BUTTON_ONLY: "false",
  KEEP_BROWSER_OPEN: "false",
  SKIP_COOLDOWN: "false",
  MAX_GROUP_ATTEMPTS_PER_CYCLE: "5",
  DRY_RUN: "false",
  POST_ROTATION: "sequential",
  CLEAR_ALL_STATE: "false",

  // Optional single-group test (USE_SHEET_GROUPS=false)
  FIXED_GROUP_URL: "",
  TEST_GROUP_URL: "",
  FIXED_GROUP_NAME: "",

  // ─── Google Sheet ───────────────────────────────────────────────
  GOOGLE_SHEET_ID: "1Hu_jdGKNbkfIeuL6aNyHaHC4mt-Sbu90SliU1NunbN8",
  GOOGLE_SHEET_GID: "0",
  GOOGLE_SHEET_CSV_URL: "",
  GOOGLE_SHEET_RANGE: "Sheet1",
  GOOGLE_USE_SERVICE_ACCOUNT: "false",
  GOOGLE_APPLICATION_CREDENTIALS: "",
  SHEET_SKIP_STATUSES: "done,posted,completed,skip",

  // ─── Chrome (bot profile only) ──────────────────────────────────
  CHROME_PATH: IS_SERVER
    ? "/usr/bin/chromium"
    : "/opt/google/chrome/google-chrome",
  CHROME_BOT_DATA_DIR: IS_SERVER
    ? "/app/data/linkedin-bot-chrome"
    : path.join(HOME, ".config/linkedin-bot-chrome"),
  CHROME_BOT_PROFILE: "Default",
  DATA_DIR: IS_SERVER ? "/app/data" : ROOT,
  CHROME_HEADLESS: IS_SERVER ? "true" : "false",
  CHROME_HUMAN_CLICKS: "true",
  CHROME_STEALTH: "true",
  CHROME_USER_AGENT: "",
  CHROME_ATTACH_WAIT_MS: "45000",
  USE_MAIN_PROFILE: "false",
  CHROME_SYNC_PROFILE: "false",
  CHROME_AUTO_DEBUG: "false",
  CHROME_AUTO_QUIT: "false",
  GMAIL_FIRST: "false",

  // ─── LinkedIn login / captcha ───────────────────────────────────
  LINKEDIN_VERIFICATION_CODE: "",
  TWOCAPTCHA_API_KEY: "6452c73ab281db0526ba83e724bb983c",
  CAPTCHA_SOLVER_ENABLED: "true",
  CAPTCHA_LOGIN_WAIT_MS: "420000",
  CHALLENGE_URL_WAIT_MS: "60000",
  LOGIN_TO_CHALLENGE_WAIT_MS: "8000",
  CAPTCHA_MAX_ATTEMPTS: "4",
  CAPTCHA_POLL_MS: "4000",
  CAPTCHA_POLL_MAX: "45",
  LOGIN_MAX_WAIT_MS: "45000",
  LOGIN_POLL_MS: "2000",
  LOGIN_PROGRESS_LOG_MS: "5000",
  LINKEDIN_GOTO_WAIT_UNTIL: "domcontentloaded",

  // ─── Scheduling ─────────────────────────────────────────────────
  CYCLES_PER_DAY: "5",
  ACTIVE_HOURS_START: "0",
  ACTIVE_HOURS_END: "24",
  INTER_CYCLE_DELAY_MIN_MS: "180000",
  INTER_CYCLE_DELAY_MAX_MS: "180000",
  TZ: "America/New_York",

  // ─── Account / verification ───────────────────────────────────────
  ACCOUNT_AGE_MULTIPLIER: "1.0",
  VERIFY_POSTS_ENABLED: "true",
  VERIFY_POSTS_AFTER_HOURS: "24",
  AUTO_REMOVE_LOW_QUALITY_GROUPS: "true",
  QUALITY_SCORE_FLOOR: "0",
  ATTRIBUTION_DEFAULT_UTM: "linkedin-group",

  // ─── Engagement ─────────────────────────────────────────────────
  ENGAGEMENT_ENABLED: "true",
  LIKES_PER_GROUP: "3",
  COMMENTS_PER_GROUP: "2",
  COOLDOWN_MS: "120000",
  COOLDOWN_JITTER_PCT: "0",
  LIKE_DELAY_MIN_MS: "3000",
  LIKE_DELAY_MAX_MS: "8000",
  COMMENT_DELAY_MIN_MS: "5000",
  COMMENT_DELAY_MAX_MS: "12000",
  COMMENT_MAX_CONSECUTIVE_SKIPS: "3",
  COMMENT_EMOJIS: "👍,👏,❤️,🔥",
  DEFAULT_COMMENT_TEXT: "👍",
  COMMENT_STEP_DELAY_MS: "2000",
  COMMENT_SUBMIT_SELECTOR:
    "form.comments-comment-box__form div.display-flex.justify-space-between div.display-flex.align-items-center||button.comments-comment-box__submit-button",

  // ─── Daily limits ───────────────────────────────────────────────
  MAX_DAILY_LIKES: "30",
  MAX_DAILY_COMMENTS: "15",
  MAX_DAILY_POSTS: "5",
  MAX_GROUPS_PER_CYCLE: "1",

  // ─── Post / group UI ────────────────────────────────────────────
  POST_EMBER_IDS: "ember131,ember276",
  START_POST_TEXT: "Start a post in this group",
  POLL_CLICK_INTERVAL_MS: "500",
  POLL_CLICK_MAX_ATTEMPTS: "120",
  COMPOSER_BUTTON_WAIT_MS: "60000",
  POST_STEP_DELAY_MS: "2000",
  GROUP_PAGE_LOAD_MS: "15000",
  GROUP_FEED_WAIT_MS: "12000",
  PAGE_TIMEOUT_MS: "60000",
  POST_CLICK_TIMEOUT_MS: "12000",
  POST_EDITOR_SELECTOR:
    "#ember131 > div > div.share-creation-state.share-creation-state__share-box-v2.share-creation-state__share-box-v2--redesigned-detours > div.share-creation-state__content-scrollable > div > div > div > div > div > div > div.ql-editor.ql-blank > p||#ember276 > div > div.share-creation-state.share-creation-state__share-box-v2.share-creation-state__share-box-v2--redesigned-detours > div.share-creation-state__content-scrollable > div > div > div > div > div > div > div.ql-editor.ql-blank > p",
  POST_SUBMIT_SELECTOR:
    "#ember131 > div > div.share-creation-state.share-creation-state__share-box-v2.share-creation-state__share-box-v2--redesigned-detours > div.share-creation-state__bottom.share-creation-state__bottom--margin > div.share-creation-state__footer > div||#ember276 > div > div.share-creation-state.share-creation-state__share-box-v2.share-creation-state__share-box-v2--redesigned-detours > div.share-creation-state__bottom.share-creation-state__bottom--margin > div.share-creation-state__footer > div",

  // ─── Gmail (optional group-link fallback) ───────────────────────
  GMAIL_INBOX_URL: "https://mail.google.com/mail/u/0/",
  GMAIL_SEARCH_QUERY: "",
  GMAIL_FALLBACK_DIRECT: "true",
};
