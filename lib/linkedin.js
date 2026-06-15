const PAGE_TIMEOUT_MS = Number(process.env.PAGE_TIMEOUT_MS || 60_000);
const POST_CLICK_TIMEOUT_MS = Number(process.env.POST_CLICK_TIMEOUT_MS || 12_000);
const GROUP_PAGE_LOAD_MS = Number(process.env.GROUP_PAGE_LOAD_MS || 15_000);

const START_POST_SELECTOR = ".artdeco-button__text";
// Legacy constant referenced by older selector lists.
// Keep defined to avoid runtime crashes.
const COMPOSER_BUTTON_SELECTOR = "button.share-box-feed-entry__trigger";

const PRIMARY_COMPOSER_OPENERS = [
  "#ember95",
  "#ember96",
  "#ember94",
  ".groups-share-box #ember95",
  ".groups-share-box #ember96",
];

const EMBER95_POPUP_EDITOR_PATH =
  "{root} > div > div.share-creation-state.share-creation-state__share-box-v2.share-creation-state__share-box-v2--redesigned-detours > div.share-creation-state__content-scrollable > div > div > div > div > div > div > div.ql-editor.ql-blank";

const ALLOWED_COMPOSER_EMBER_IDS = new Set([
  "ember94",
  "ember95",
  "ember96",
  "ember131",
  "ember276",
]);

const COMPOSER_START_LABELS = [
  "start a post in this group",
  "start a public post",
  "start a post",
];

function isAllowedComposerSelector(selector) {
  const s = String(selector || "");
  const matches = [...s.matchAll(/#ember(\d+)/gi)];
  if (!matches.length) return true;
  return matches.every((m) => ALLOWED_COMPOSER_EMBER_IDS.has(`ember${m[1]}`));
}

const DEFAULT_START_SELECTORS = [
  "#ember95 > span",
  ".groups-share-box #ember95 > span",
  ".groups-share-box .share-box-feed-entry__trigger",
  ".groups-share-box button[aria-label*='post' i]",
  ".groups-share-box #ember95",
  ".groups-share-box #ember94",
  ".share-box-feed-entry__trigger",
  "button.share-box-feed-entry__trigger",
  '[data-control-name="create_post"]',
  ".groups-share-box__create-post-button",
  COMPOSER_BUTTON_SELECTOR,
];

const EMBER_POST_PATH_TEMPLATE = {
  editor:
    "{root} > div > div.share-creation-state.share-creation-state__share-box-v2.share-creation-state__share-box-v2--redesigned-detours > div.share-creation-state__content-scrollable > div > div > div > div > div > div > div.ql-editor.ql-blank > p",
  editorShort: "{root} div.share-creation-state .ql-editor[contenteditable='true']",
  submit:
    "{root} > div > div.share-creation-state.share-creation-state__share-box-v2.share-creation-state__share-box-v2--redesigned-detours > div.share-creation-state__bottom.share-creation-state__bottom--margin > div.share-creation-state__footer > div",
  submitShort:
    "{root} div.share-creation-state__footer button, {root} div.share-creation-state__footer > div",
};

const DEFAULT_EDITOR_SELECTORS = [
  "#ember95 div.ql-editor[contenteditable='true']",
  "#ember94 div.ql-editor[contenteditable='true']",
  ".artdeco-modal div.ql-editor[contenteditable='true']",
  ".artdeco-modal-outlet div.ql-editor[contenteditable='true']",
  "[role='dialog'] div.share-creation-state .ql-editor[contenteditable='true']",
  "[id^='ember'] div.share-creation-state .ql-editor[contenteditable='true']",
  "div.share-creation-state div.ql-editor.ql-blank > p",
  'div.share-creation-state div.ql-editor[contenteditable="true"]',
];

const DEFAULT_SUBMIT_SELECTORS = [
  "#ember95 div.share-creation-state__footer button",
  "#ember95 .artdeco-modal button.share-actions__primary-action",
  ".artdeco-modal button.share-actions__primary-action",
  ".artdeco-modal div.share-creation-state__footer button",
  "[role='dialog'] button[aria-label*='Post' i]:not([aria-label*='comment' i])",
  "[id^='ember'] div.share-creation-state__footer button",
  "[id^='ember'] div.share-creation-state__footer > div",
  'button.share-actions__primary-action',
  'button[aria-label*="Post" i]:not([aria-label*="comment" i])',
];

function emberIdsFromEnv() {
  const raw =
    process.env.POST_EMBER_IDS ||
    "ember94,ember95,ember131,ember276";
  return raw
    .split(",")
    .map((s) => s.trim().replace(/^#/, ""))
    .filter((id) => /^ember\d+$/i.test(id));
}

function selectorsForEmberRoots(ids) {
  const editors = [];
  const submits = [];
  const triggers = [];
  for (const id of ids) {
    const root = `#${id}`;
    if (id === "ember94" || id === "ember95") {
      triggers.push(
        `${root} > span`,
        `.groups-share-box ${root} > span`,
        `.groups-share-box ${root}`,
        `.groups-share-box ${root} button`,
        `${root} .share-box-feed-entry__trigger`,
        `${root} button[aria-label*='post' i]`
      );
    } else {
      triggers.push(
        `${root} .share-box-feed-entry__trigger`,
        `${root} button[aria-label*='post' i]`,
        root
      );
    }
    editors.push(
      EMBER_POST_PATH_TEMPLATE.editor.replaceAll("{root}", root),
      EMBER_POST_PATH_TEMPLATE.editorShort.replaceAll("{root}", root)
    );
    submits.push(
      EMBER_POST_PATH_TEMPLATE.submit.replaceAll("{root}", root),
      ...EMBER_POST_PATH_TEMPLATE.submitShort
        .split(",")
        .map((s) => s.trim().replaceAll("{root}", root))
    );
  }
  return { editors, submits, triggers };
}

function uniqueSelectors(list) {
  return [...new Set(list.map((s) => s.trim()).filter(Boolean))];
}

function buildPostUiSelectorLists() {
  const ember = selectorsForEmberRoots(emberIdsFromEnv());
  const editorSelectors = uniqueSelectors([
    ...selectorList("POST_EDITOR_SELECTOR", []),
    ...ember.editors,
    ...DEFAULT_EDITOR_SELECTORS,
  ]);
  const submitSelectors = uniqueSelectors([
    ...selectorList("POST_SUBMIT_SELECTOR", []),
    ...ember.submits,
    ...DEFAULT_SUBMIT_SELECTORS,
  ]);
  return { editorSelectors, submitSelectors, composerTriggers: ember.triggers };
}

async function discoverShareCreationSelectors(page) {
  return page.evaluate(() => {
    const editors = [];
    const submits = [];
    const triggers = [];
    for (const root of document.querySelectorAll('[id^="ember"]')) {
      const id = root.id;
      const esc = CSS.escape(id);
      const state = root.querySelector(".share-creation-state");
      const inShareBox = !!root.closest(
        ".groups-share-box, .share-box-feed-entry, [class*='groups-share']"
      );
      const label = (
        root.getAttribute("aria-label") ||
        root.textContent ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

      if (!state) {
        if (
          inShareBox ||
          /start a (post|public post)|post in this group|create a post|write something/.test(
            label
          )
        ) {
          const r = root.getBoundingClientRect();
          if (r.width > 1 && r.height > 1) {
            triggers.push(`#${esc}`, `button#${esc}`, `#${esc} button`);
          }
        }
        continue;
      }
      const r = root.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;

      const trigger = root.querySelector(
        ".share-box-feed-entry__trigger, button[aria-label*='post' i]"
      );
      if (trigger) triggers.push(`#${esc} .share-box-feed-entry__trigger`);

      const ed = state.querySelector(
        ".ql-editor[contenteditable='true'], div.ql-editor.ql-blank > p, div.ql-editor"
      );
      if (ed) {
        editors.push(EMBER95_POPUP_EDITOR_PATH.replaceAll("{root}", `#${esc}`));
        editors.push(`#${esc} div.share-creation-state .ql-editor[contenteditable='true']`);
        editors.push(`#${esc} div.ql-editor.ql-blank`);
        editors.push(`#${esc} div.ql-editor.ql-blank > p`);
      }

      const footer = state.querySelector(".share-creation-state__footer");
      if (footer) {
        submits.push(`#${esc} div.share-creation-state__footer button`);
        submits.push(`#${esc} div.share-creation-state__footer > div`);
      }
    }
    return {
      editors: [...new Set(editors)],
      submits: [...new Set(submits)],
      triggers: [...new Set(triggers)],
    };
  });
}

/** Popup composer after clicking #ember95 (e.g. #ember348 — id changes per session). */
async function discoverPopupComposerAfterOpen(page) {
  return page.evaluate((editorPathTpl) => {
    const editors = [];
    const submits = [];
    for (const root of document.querySelectorAll('[id^="ember"]')) {
      if (root.id === "ember95" || root.id === "ember94") continue;
      const state = root.querySelector(".share-creation-state");
      if (!state) continue;
      const ed = state.querySelector(
        ".ql-editor.ql-blank, .ql-editor[contenteditable='true']"
      );
      if (!ed) continue;
      const r = ed.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const inModal = !!root.closest(
        ".artdeco-modal, .artdeco-modal-outlet, [role='dialog']"
      );
      const hasFooter = !!state.querySelector(".share-creation-state__footer");
      if (!inModal && !hasFooter) continue;

      const esc = CSS.escape(root.id);
      const rootSel = `#${esc}`;
      editors.push(editorPathTpl.replace("{root}", rootSel));
      editors.push(`${rootSel} div.share-creation-state .ql-editor[contenteditable='true']`);
      editors.push(`${rootSel} div.ql-editor.ql-blank`);

      submits.push(`${rootSel} div.share-creation-state__footer button.share-actions__primary-action`);
      submits.push(`${rootSel} div.share-creation-state__footer button`);
      submits.push(`${rootSel} div.share-creation-state__footer > div`);
    }
    return {
      editors: [...new Set(editors)],
      submits: [...new Set(submits)],
    };
  }, EMBER95_POPUP_EDITOR_PATH);
}

async function mergeDiscoveredPostSelectors(page, base) {
  const found = await discoverShareCreationSelectors(page);
  if (found.editors.length) {
    console.log(
      `  → Composer UI detected: ${found.editors.map((s) => s.split(" ")[0]).join(", ")}`
    );
  }
  return {
    editorSelectors: uniqueSelectors([...found.editors, ...base.editorSelectors]),
    submitSelectors: uniqueSelectors([...found.submits, ...base.submitSelectors]),
    composerTriggers: uniqueSelectors([
      ...found.triggers,
      ...base.composerTriggers,
    ]),
  };
}

const DEFAULT_COMMENT_OPEN_SELECTORS = [
  ".feed-shared-social-action-bar button[aria-label*='Comment' i]",
  "button[aria-label*='Comment on' i]",
  "button.social-actions-button[aria-label*='Comment' i]",
  ".comments-comment-box-comment__button",
  "button[aria-label*='comment' i]",
];

const DEFAULT_COMMENT_EDITOR_SELECTORS = [
  "div.comments-comment-box__form div.ql-editor[contenteditable='true']",
  "div.comments-comment-texteditor div[contenteditable='true']",
  "form.comments-comment-box__form div[contenteditable='true'][role='textbox']",
  "div[contenteditable='true'][role='textbox']",
];

const DEFAULT_COMMENT_SUBMIT_SELECTORS = [
  "form.comments-comment-box__form div.display-flex.justify-space-between div.display-flex.align-items-center",
  "button.comments-comment-box__submit-button--cr",
  "button.comments-comment-box__submit-button",
  'button[aria-label*="Post comment" i]',
  'button[type="submit"].comments-comment-box__submit-button',
];
function selectorList(envKey, defaults) {
  const raw = process.env[envKey];
  if (!raw) return defaults;
  return raw
    .split("||")
    .map((s) => s.trim())
    .filter(Boolean);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomBetween(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

async function waitForLinkedIn(page) {
  await page.waitForFunction(
    () => location.hostname.includes("linkedin.com"),
    { timeout: PAGE_TIMEOUT_MS }
  );
}

async function visitGroup(page, groupUrl) {
  const active = page.__linkedInActivePage || page;
  const { logBotUrl } = require("./linkedin-login");

  console.log(`  → Opening group: ${groupUrl}`);
  try {
    await active.goto(groupUrl, {
      waitUntil: "networkidle2",
      timeout: PAGE_TIMEOUT_MS,
    });
  } catch {
    await active.goto(groupUrl, {
      waitUntil: "domcontentloaded",
      timeout: PAGE_TIMEOUT_MS,
    });
  }
  await waitForLinkedIn(active);
  await sleep(Number(process.env.GROUP_PAGE_LOAD_MS || 15_000) / 3);
  await logBotUrl(page, "group");

  const { ensureAuthForTarget, needsLinkedInAuth } = require("./linkedin-login");
  if (needsLinkedInAuth(page)) {
    console.log("  → Group opened login page — running full auth flow…");
    const auth = await ensureAuthForTarget(page, groupUrl);
    if (!auth.ok) {
      console.warn(`  → Auth failed after group redirect (${auth.reason || "login_failed"}).`);
      return active;
    }
    if (!active.url().includes(groupUrl.match(/groups\/(\d+)/)?.[1] || "___")) {
      try {
        await active.goto(groupUrl, {
          waitUntil: "domcontentloaded",
          timeout: PAGE_TIMEOUT_MS,
        });
      } catch {
        /* continue */
      }
      await sleep(2000);
      await logBotUrl(page, "group after auth");
    }
  }

  return active;
}

/** Scroll and wait for lazy-loaded group feed + composer (headless needs longer). */
async function prepareGroupPage(page, groupUrl, options = {}) {
  const active = getLinkedInPage(page);
  const forPost = options.forPost === true;
  const groupId = groupUrl?.match(/groups\/(\d+)/)?.[1];
  let url = "";
  try {
    url = active.url();
  } catch {
    url = "";
  }

  if (groupId && !url.includes(groupId)) {
    await visitGroup(page, groupUrl);
  }

  await waitForGroupPageReady(page);

  const openedTab = await active.evaluate(() => {
    const tabs = [
      ...document.querySelectorAll(
        'button, a[role="tab"], [role="tab"] button, .artdeco-tab'
      ),
    ];
    for (const t of tabs) {
      const label = (
        t.textContent ||
        t.getAttribute("aria-label") ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      if (
        /^(discussions?|feed|posts|recent|all activity)$/i.test(label) ||
        (label.includes("discussion") && label.length < 40)
      ) {
        t.click();
        return label;
      }
    }
    return null;
  });
  if (openedTab) {
    console.log(`  → Group tab: ${openedTab}`);
    await sleep(2000);
  }

  if (forPost) {
    await scrollToGroupComposer(page);
    return active;
  }

  console.log("  → Loading group feed (scroll)...");
  for (let i = 0; i < 5; i++) {
    await scrollFeed(active);
  }

  const waitMs = Number(process.env.GROUP_FEED_WAIT_MS || 12_000);
  const startLabel = (process.env.START_POST_TEXT || "start a post").toLowerCase();
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const ready = await active.evaluate((needle) => {
      const hasFeed = !!document.querySelector(
        "div.feed-shared-update-v2, article.occludable-update, div.occludable-update, main.scaffold-layout__main"
      );
      const hasComposer = [...document.querySelectorAll(
        "button, [role='button'], .share-box-feed-entry__trigger"
      )].some((el) =>
        (el.textContent || el.getAttribute("aria-label") || "")
          .toLowerCase()
          .includes(needle)
      );
      return hasFeed || hasComposer;
    }, startLabel);
    if (ready) break;
    await scrollFeed(active);
    await sleep(1500);
  }

  return active;
}

async function tryClick(page, selectors, timeout = POST_CLICK_TIMEOUT_MS) {
  for (const selector of selectors) {
    try {
      const el = await page.waitForSelector(selector, { visible: true, timeout });
      if (el) {
        await el.click();
        console.log(`  → Clicked: ${selector.slice(0, 72)}${selector.length > 72 ? "…" : ""}`);
        return true;
      }
    } catch {
      /* next */
    }
  }
  return false;
}

async function waitForGroupPageReady(page) {
  try {
    await page.waitForFunction(
      () =>
        document.readyState === "complete" &&
        location.hostname.includes("linkedin.com") &&
        !location.pathname.includes("/login"),
      { timeout: PAGE_TIMEOUT_MS }
    );
  } catch {
    /* page may still be usable */
  }
  await sleep(Number(process.env.POST_STEP_DELAY_MS || 2000));
}

const FEED_POST_ROOT_SELECTORS = [
  "div.feed-shared-update-v2",
  "article.occludable-update",
  "div.occludable-update",
];

/** After likes/comments the feed is scrolled down — composer (#ember95) is at the top. */
async function scrollToGroupComposer(page) {
  const active = getLinkedInPage(page);
  for (let i = 0; i < 2; i++) {
    try {
      await active.keyboard.press("Escape");
    } catch {
      /* ignore */
    }
    await sleep(200);
  }
  await active.evaluate(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    const main = document.querySelector("main.scaffold-layout__main, main");
    if (main) main.scrollTop = 0;
    const shareBox = document.querySelector(
      ".groups-share-box, .share-box-feed-entry, [class*='groups-share']"
    );
    if (shareBox) {
      shareBox.scrollIntoView({ block: "start", inline: "nearest" });
    }
    const ember95 = document.getElementById("ember95");
    if (ember95) {
      ember95.scrollIntoView({ block: "center", inline: "nearest" });
    }
  });
  await sleep(Number(process.env.GROUP_COMPOSER_SCROLL_WAIT_MS || 1200));
  console.log("  → Scrolled to top (group post composer)");
}

async function scrollFeed(page) {
  await page.evaluate(() => window.scrollBy(0, 700));
  await sleep(1500);
}

async function collectFeedPostCards(page) {
  return page.$$(FEED_POST_ROOT_SELECTORS.join(", "));
}

async function isFeedPostVisible(post) {
  return post.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.height > 60 && r.top >= 40 && r.top < window.innerHeight * 0.92;
  });
}

async function isPostAlreadyEngaged(post, action) {
  return post.evaluate((root, kind) => {
    const flag = root.getAttribute("data-bot-engaged") || "";
    return flag === kind || flag === "both";
  }, action);
}

async function markPostEngaged(post, action) {
  await post.evaluate((root, kind) => {
    const prev = root.getAttribute("data-bot-engaged");
    if (prev && prev !== kind) {
      root.setAttribute("data-bot-engaged", "both");
    } else {
      root.setAttribute("data-bot-engaged", kind);
    }
  }, action);
}

async function getFeedPostKey(post) {
  return post.evaluate((root) => {
    const urn =
      root.getAttribute("data-urn") ||
      root.querySelector("[data-urn]")?.getAttribute("data-urn") ||
      root.getAttribute("data-id");
    if (urn) return urn;
    const name =
      root
        .querySelector(
          ".update-components-actor__name, .feed-shared-actor__name, .feed-shared-actor__title"
        )
        ?.textContent?.trim()
        .slice(0, 48) || "";
    return `feed:${name}:${Math.round(root.getBoundingClientRect().top)}`;
  });
}

function pickCommentEmoji(index) {
  const emojis = (process.env.COMMENT_EMOJIS || "👍,👏,❤️,🔥")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!emojis.length) return "👍";
  return emojis[index % emojis.length];
}

async function likePostCard(post) {
  return post.evaluate((root) => {
    const bar = root.querySelector(".feed-shared-social-action-bar");
    if (!bar) return { ok: false, reason: "no-action-bar" };

    const btn =
      bar.querySelector(
        'button[aria-label*="Like" i]:not([aria-pressed="true"])'
      ) || bar.querySelector('button.react-button__trigger:not([aria-pressed="true"])');

    if (!btn) return { ok: false, reason: "no-like-button" };
    if (btn.closest(".comments-comment-item, .comments-comments-list")) {
      return { ok: false, reason: "comment-thread" };
    }

    const label = (btn.getAttribute("aria-label") || "").toLowerCase();
    if (/comment|reply/.test(label)) {
      return { ok: false, reason: "not-post-like" };
    }

    const r = btn.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return { ok: false, reason: "hidden" };

    btn.click();
    return { ok: true };
  });
}

async function likePostsInFeed(page, count, delays) {
  const engaged = new Set();
  let done = 0;
  let scrolls = 0;
  const maxScrolls = count + 12;

  await scrollFeed(page);
  await sleep(1500);

  while (done < count && scrolls < maxScrolls) {
    if (scrolls > 0) await scrollFeed(page);
    scrolls++;

    const posts = await collectFeedPostCards(page);
    for (const post of posts) {
      if (done >= count) break;

      const key = await getFeedPostKey(post);
      if (engaged.has(key)) continue;
      if (await isPostAlreadyEngaged(post, "like")) continue;
      if (!(await isFeedPostVisible(post))) continue;

      const result = await likePostCard(post);
      if (!result.ok) continue;

      engaged.add(key);
      await markPostEngaged(post, "like");
      done++;
      console.log(`  → Liked feed post ${done}/${count}`);
      await sleep(randomBetween(delays.min, delays.max));
    }
  }

  if (done < count) {
    console.warn(`  → Only liked ${done}/${count} distinct feed posts.`);
  }
  return done;
}

async function fillContentEditableOnce(editor, text) {
  await editor.evaluate((el, value) => {
    el.focus();
    const safe = String(value).replace(/</g, "");
    if (el.classList.contains("ql-editor")) {
      el.innerHTML = `<p>${safe}</p>`;
    } else {
      el.textContent = safe;
    }
    el.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText", data: safe })
    );
  }, text);
}

async function openCommentOnPostCard(post) {
  return post.evaluate((root) => {
    const bar = root.querySelector(".feed-shared-social-action-bar");
    if (!bar) return false;
    const btn = bar.querySelector("button[aria-label*='Comment' i]");
    if (!btn || btn.closest(".comments-comment-item")) return false;
    const r = btn.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    btn.click();
    return true;
  });
}

async function waitForVisibleEditorHandle(scope, selectors, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      const editor = await scope.$(sel);
      if (!editor) continue;
      const visible = await editor.evaluate((node) => {
        const r = node.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (visible) return editor;
    }
    await sleep(350);
  }
  return null;
}

async function waitForCommentEditorOnPost(post, selectors, timeoutMs = 5_000) {
  return waitForVisibleEditorHandle(post, selectors, timeoutMs);
}

async function waitForCommentEditorOnPage(page, selectors, timeoutMs = 5_000) {
  return waitForVisibleEditorHandle(getLinkedInPage(page), selectors, timeoutMs);
}

async function skipPostForComments(post, engaged, reason) {
  const key = await getFeedPostKey(post);
  engaged.add(key);
  await markPostEngaged(post, "comment-skip");
  return key;
}

async function submitCommentOnPostCard(post, submitSelectors) {
  return post.evaluate((root, selectors) => {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (!el) continue;
      const target =
        el.tagName === "BUTTON" ? el : el.querySelector("button") || el;
      const r = target.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        target.click();
        return { ok: true, selector: sel };
      }
    }
    const fallback = root.querySelector(
      "form.comments-comment-box__form button.comments-comment-box__submit-button, form.comments-comment-box__form button[aria-label*='Post comment' i]"
    );
    if (fallback) {
      fallback.click();
      return { ok: true, selector: "fallback-submit" };
    }
    return { ok: false };
  }, submitSelectors);
}

async function closeCommentBox(page) {
  try {
    await page.keyboard.press("Escape");
  } catch {
    /* ignore */
  }
  await sleep(500);
}

async function commentOnPostsInFeed(page, count, delays, commentText) {
  const engaged = new Set();
  let done = 0;
  let scrolls = 0;
  let consecutiveSkips = 0;
  const maxConsecutiveSkips = Number(process.env.COMMENT_MAX_CONSECUTIVE_SKIPS || 3);
  const maxScrolls = count + 10;
  const editorSelectors = selectorList(
    "COMMENT_EDITOR_SELECTOR",
    DEFAULT_COMMENT_EDITOR_SELECTORS
  );
  const submitSelectors = selectorList(
    "COMMENT_SUBMIT_SELECTOR",
    DEFAULT_COMMENT_SUBMIT_SELECTORS
  );
  const stepDelay = Number(process.env.COMMENT_STEP_DELAY_MS || 1500);
  let abortComments = false;

  while (done < count && scrolls < maxScrolls && !abortComments) {
    if (scrolls > 0) await scrollFeed(page);
    scrolls++;

    const posts = await collectFeedPostCards(page);
    for (const post of posts) {
      if (done >= count || abortComments) break;

      const key = await getFeedPostKey(post);
      if (engaged.has(key)) continue;
      if (await isPostAlreadyEngaged(post, "comment")) continue;
      if (await isPostAlreadyEngaged(post, "comment-skip")) continue;
      if (!(await isFeedPostVisible(post))) continue;

      const emoji =
        commentText && /^[\p{Emoji}\s]+$/u.test(commentText)
          ? commentText
          : pickCommentEmoji(done);

      console.log(`  → Comment on feed post ${done + 1}/${count} (${emoji})...`);

      const opened = await openCommentOnPostCard(post);
      if (!opened) {
        await skipPostForComments(post, engaged, "no-comment-button");
        consecutiveSkips++;
        console.warn("  → No comment button on this post — skipping.");
        if (consecutiveSkips >= maxConsecutiveSkips) {
          console.warn(
            "  → Comments not available in this group — skipping remaining comments."
          );
          abortComments = true;
        }
        continue;
      }

      await sleep(stepDelay);

      let editor = await waitForCommentEditorOnPost(post, editorSelectors, 4000);
      if (!editor) {
        editor = await waitForCommentEditorOnPage(page, editorSelectors, 4000);
      }
      if (!editor) {
        await skipPostForComments(post, engaged, "no-editor");
        await closeCommentBox(page);
        consecutiveSkips++;
        console.warn(
          "  → Comment editor not found — post/group may not allow comments, skipping."
        );
        if (consecutiveSkips >= maxConsecutiveSkips) {
          console.warn(
            "  → Stopping comment phase for this group (comments disabled or blocked)."
          );
          abortComments = true;
        }
        continue;
      }

      consecutiveSkips = 0;

      await fillContentEditableOnce(editor, emoji);
      await sleep(600);

      const submitted = await submitCommentOnPostCard(post, submitSelectors);
      if (!submitted.ok) {
        await skipPostForComments(post, engaged, "no-submit");
        await closeCommentBox(page);
        console.warn("  → Comment submit not found — skipping this post.");
        continue;
      }

      engaged.add(key);
      await markPostEngaged(post, "comment");
      done++;
      console.log(`  → Commented on feed post ${done}/${count}`);
      await closeCommentBox(page);
      await sleep(randomBetween(delays.min, delays.max));
    }
  }

  if (done < count && !abortComments) {
    console.warn(`  → Only commented on ${done}/${count} distinct feed posts.`);
  }
  return done;
}

function applyUtm(text, utmSlug, defaultUtm) {
  const slug = utmSlug || defaultUtm || "linkedin-group";
  const landing =
    process.env.POST_LANDING_URL ||
    "https://go.behindthecurtain.ai/top10?utm_source=linkedin&utm_medium=group&utm_campaign={{utm}}";

  return String(text || "")
    .replace(/\{\{link\}\}/g, landing.replace(/\{\{utm\}\}/g, slug))
    .replace(/\{\{utm\}\}/g, slug)
    .trim();
}

function preparePostText(text, utmSlug, defaultUtm) {
  if (utmSlug !== undefined || defaultUtm !== undefined) {
    return applyUtm(text, utmSlug, defaultUtm);
  }
  return String(text || "").trim();
}

async function waitForEditor(page, selectors) {
  const deadline = Date.now() + POST_CLICK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      let els = [];
      try {
        els = await page.$$(selector);
      } catch {
        continue;
      }
      for (const el of els) {
        const rootHandle = await el.evaluateHandle((node) => {
          if (
            node.closest(
              ".comments-comment-box, form.comments-comment-box__form, .feed-shared-update-v2"
            )
          ) {
            return null;
          }
          const root =
            node.closest('.ql-editor[contenteditable="true"]') ||
            node.closest(".ql-editor") ||
            node;
          const r = root.getBoundingClientRect();
          return r.width > 2 && r.height > 2 ? root : null;
        });
        const rootEl = rootHandle.asElement();
        if (rootEl) return rootEl;
      }
    }
    await sleep(350);
  }
  return null;
}

async function readEditorCharCount(editorEl) {
  return editorEl.evaluate((el) => (el.innerText || el.textContent || "").length);
}

async function clearEditorSelection(page) {
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.down(mod);
  await page.keyboard.press("KeyA");
  await page.keyboard.up(mod);
  await page.keyboard.press("Backspace");
  await sleep(300);
}

async function pasteViaQuill(editorEl, text) {
  return editorEl.evaluate((el, body) => {
    const root = el.closest(".ql-editor") || el;
    const quill =
      root.__quill || (typeof Quill !== "undefined" && Quill.find(root));
    if (!quill) return false;
    quill.setText(String(body));
    quill.focus();
    return true;
  }, text);
}

async function pasteViaCdp(page, text) {
  const client = await page.target().createCDPSession();
  await client.send("Input.insertText", { text: String(text) });
}

async function pasteViaClipboard(page, text) {
  await page.evaluate(async (body) => {
    await navigator.clipboard.writeText(body);
  }, text);
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.down(mod);
  await page.keyboard.press("KeyV");
  await page.keyboard.up(mod);
}

async function typePostParagraphs(page, text) {
  const lines = String(text).split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) await page.keyboard.press("Enter");
    if (lines[i].length) {
      await page.keyboard.type(lines[i], { delay: 12 });
    }
  }
}

async function fillPostEditor(page, editor, postContent) {
  const text = String(postContent || "").trim();
  const expectedLen = text.replace(/\r\n/g, "\n").length;
  const editorWait = Number(process.env.POST_EDITOR_WAIT_MS || 3500);
  const afterTypeWait = Number(process.env.POST_AFTER_TYPE_WAIT_MS || 3000);

  console.log(`  → Waiting ${Math.round(editorWait / 1000)}s for editor to be ready…`);
  await sleep(editorWait);

  await editor.click();
  await sleep(600);

  const strategies = [
    { name: "Quill API", run: () => pasteViaQuill(editor, text) },
    { name: "CDP insertText", run: () => pasteViaCdp(page, text) },
    { name: "clipboard paste", run: () => pasteViaClipboard(page, text) },
    { name: "keyboard paragraphs", run: () => typePostParagraphs(page, text) },
  ];

  for (const { name, run } of strategies) {
    await editor.click();
    await sleep(300);
    await clearEditorSelection(page);

    try {
      const result = await run();
      if (result === false) {
        console.log(`  → ${name}: not available, trying next…`);
        continue;
      }
    } catch (err) {
      console.log(`  → ${name} failed (${err.message}) — trying next…`);
      continue;
    }

    await sleep(afterTypeWait);
    const written = await readEditorCharCount(editor);
    console.log(`  → Editor content: ${written}/${expectedLen} chars (${name})`);

    if (written >= expectedLen * 0.88) {
      return;
    }
    console.warn(`  → Partial paste via ${name} — retrying with next method…`);
  }

  const finalCount = await readEditorCharCount(editor);
  if (finalCount < expectedLen * 0.88) {
    console.warn(
      `  → Warning: editor may still be incomplete (${finalCount}/${expectedLen} chars)`
    );
  }
}

async function discoverPostComposerButtons(page) {
  return page.evaluate(() => {
    const items = [];
    const seen = new Set();
    for (const el of document.querySelectorAll(
      '[id^="ember"], button, [role="button"], .share-box-feed-entry__trigger'
    )) {
      const label = (el.getAttribute("aria-label") || el.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      const haystack = `${label} ${el.id} ${el.className || ""}`;
      if (!/post|share|start|create|write|composer/i.test(haystack)) continue;
      const key = el.id || label;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      items.push({
        id: el.id || null,
        tag: el.tagName,
        label: label.slice(0, 120),
        selector: el.id ? `#${CSS.escape(el.id)}` : null,
      });
    }
    return items.slice(0, 25);
  });
}

async function discoverGroupComposerOpeners(page) {
  return page.evaluate((allowed) => {
    const triggers = [];
    const seen = new Set();
    const add = (sel) => {
      if (!sel || seen.has(sel)) return;
      seen.add(sel);
      triggers.push(sel);
    };

    for (const id of allowed) {
      const root = document.getElementById(id);
      if (!root) continue;
      if (root.closest(".feed-shared-update-v2, .comments-comment-box")) continue;
      if (
        !root.closest(".groups-share-box, .share-box-feed-entry, [class*='groups-share']")
      ) {
        continue;
      }
      const esc = CSS.escape(id);
      const r = root.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      add(`#${esc} > span`);
      add(`#${esc}`);
      add(`button#${esc}`);
    }
    return triggers;
  }, [...ALLOWED_COMPOSER_EMBER_IDS].filter((id) =>
    ["ember94", "ember95", "ember96"].includes(id)
  ));
}

const COMPOSER_POPUP_SELECTORS = [
  "[id^='ember'] > div > div.share-creation-state div.ql-editor.ql-blank",
  "[id^='ember'] div.share-creation-state .ql-editor[contenteditable='true']",
  ".artdeco-modal div.ql-editor[contenteditable='true']",
  ".artdeco-modal-outlet div.ql-editor[contenteditable='true']",
  "[role='dialog'] div.ql-editor[contenteditable='true']",
  "div.share-creation-state div.ql-editor[contenteditable='true']",
];

async function waitForPostComposerOpen(page, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const opened = await page.evaluate(() => {
      const exclude =
        ".comments-comment-box, form.comments-comment-box__form, .feed-shared-update-v2";
      const maxTop = window.innerHeight * 0.85;
      for (const ed of document.querySelectorAll(
        ".ql-editor[contenteditable='true'], .ql-editor.ql-blank"
      )) {
        if (ed.closest(exclude)) continue;
        const r = ed.getBoundingClientRect();
        if (r.width > 2 && r.height > 2 && r.top < maxTop) return true;
      }
      for (const state of document.querySelectorAll(".share-creation-state")) {
        if (state.closest(exclude)) continue;
        const r = state.getBoundingClientRect();
        if (r.width > 20 && r.height > 20 && r.top < maxTop) return true;
      }
      return false;
    });
    if (opened) {
      console.log("  → Composer / editor visible");
      return true;
    }
    await sleep(350);
  }
  return false;
}

async function isGroupComposerTrigger(page, selector) {
  return page.evaluate((sel) => {
    const node = document.querySelector(sel);
    if (!node) return false;
    if (
      node.closest(
        ".feed-shared-update-v2, .feed-shared-actor, .comments-comment-box, .comments-comment-box__form, .feed-shared-social-action-bar, .social-actions-button"
      )
    ) {
      return false;
    }

    const emberRoot =
      node.closest('[id^="ember"]') || (node.id?.startsWith("ember") ? node : null);
    const emberId = emberRoot?.id || node.id || "";
    const r = node.getBoundingClientRect();
    const inTopHalf = r.top < window.innerHeight * 0.55;

    if (emberId === "ember94" || emberId === "ember95" || emberId === "ember96") {
      return inTopHalf && r.width > 2 && r.height > 2;
    }

    const label = (
      node.getAttribute("aria-label") ||
      node.textContent ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

    if (label === "share" || label === "repost" || label === "send") return false;
    if (/start a (post|public post)|post in this group|create a post/.test(label)) {
      return inTopHalf;
    }

    const inShareBox = !!node.closest(
      ".groups-share-box, .share-box-feed-entry, [class*='groups-share']"
    );
    return inShareBox && inTopHalf;
  }, selector);
}

/** Find #ember95 / #ember96 or "Start a public post" in top of group page (not feed). */
async function findGroupComposerOpener(page) {
  return page.evaluate((labels) => {
    const exclude =
      ".feed-shared-update-v2, .feed-shared-actor, .comments-comment-box, .feed-shared-social-action-bar, .social-actions-button";
    const maxTop = window.innerHeight * 0.55;

    const pick = (node) => {
      if (!node || node.closest(exclude)) return null;
      const r = node.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.top > maxTop) return null;
      const label = (node.getAttribute("aria-label") || node.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      const id = node.id || node.closest("[id^='ember']")?.id;
      if (id) return { selector: `#${CSS.escape(id)}`, label: label.slice(0, 100) };
      return null;
    };

    for (const id of ["ember95", "ember96", "ember94"]) {
      const el = document.getElementById(id);
      const hit = pick(el);
      if (hit) return hit;
    }

    const scope = document.querySelector("main") || document.body;
    for (const el of scope.querySelectorAll(
      "button, [role='button'], .share-box-feed-entry__trigger, span, div[tabindex='0']"
    )) {
      if (el.closest(exclude)) continue;
      const r = el.getBoundingClientRect();
      if (r.top > maxTop || r.width < 2) continue;
      const label = (el.getAttribute("aria-label") || el.textContent || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      for (const needle of labels) {
        if (!label.includes(needle)) continue;
        const target =
          el.closest("button") ||
          el.closest("[role='button']") ||
          (el.id?.startsWith("ember") ? el : null) ||
          el.closest("[id^='ember']") ||
          el;
        const hit = pick(target);
        if (hit) return hit;
      }
    }
    return null;
  }, COMPOSER_START_LABELS);
}

async function clickGroupComposerOpener(page) {
  await scrollToGroupComposer(page);
  const { humanClickOrFallback } = require("./human-click");

  for (let attempt = 0; attempt < 10; attempt++) {
    if (attempt % 3 === 0) await scrollToGroupComposer(page);

    for (const text of COMPOSER_START_LABELS) {
      const byText = await findComposerButtonByText(page, text);
      if (byText) {
        console.log(`  → Found by text: "${text}"`);
        await byText.evaluate((n) => n.scrollIntoView({ block: "center" }));
        await sleep(400);
        await humanClickOrFallback(page, byText);
        await sleep(1500);
        if (await waitForPostComposerOpen(page, 12_000)) {
          return { ok: true, selector: `text:${text}` };
        }
      }
    }

    const hit = await findGroupComposerOpener(page);
    if (hit) {
      console.log(`  → Found composer opener: ${hit.selector} — "${hit.label}"`);
      try {
        const el = await page.waitForSelector(hit.selector, {
          visible: true,
          timeout: 5000,
        });
        await el.evaluate((n) => n.scrollIntoView({ block: "center", inline: "center" }));
        await sleep(400);
        await humanClickOrFallback(page, el);
        await sleep(1500);
        if (await waitForPostComposerOpen(page, 12_000)) {
          return { ok: true, selector: hit.selector };
        }
        console.log(`  → Clicked ${hit.selector} but editor not open yet…`);
      } catch (err) {
        console.log(`  → Could not click ${hit.selector}: ${err.message}`);
      }
    } else if (attempt % 2 === 0) {
      console.log(`  → Looking for "Start a public post" / #ember95 (attempt ${attempt + 1})…`);
    }

    await sleep(600);
  }
  return { ok: false };
}

function groupIdFromUrl(groupUrl) {
  return groupUrl?.match(/groups\/(\d+)/)?.[1] || "";
}

async function isOnGroupPage(page, groupUrl) {
  const id = groupIdFromUrl(groupUrl);
  if (!id) return true;
  try {
    const url = await getLinkedInPage(page).url();
    return url.includes(`/groups/${id}`) || url.includes(`groups/${id}`);
  } catch {
    return false;
  }
}

async function recoverGroupPageIfNeeded(page, groupUrl) {
  if (!groupUrl || (await isOnGroupPage(page, groupUrl))) return false;
  console.warn("  → Navigated away from group — returning to group page…");
  await visitGroup(page, groupUrl);
  await prepareGroupPage(page, groupUrl);
  await sleep(1500);
  return true;
}

async function findComposerButtonByText(page, text) {
  const handle = await page.evaluateHandle((needle) => {
    const n = String(needle).toLowerCase();
    const exclude =
      ".feed-shared-update-v2, .feed-shared-actor, .comments-comment-box, .comments-comment-box__form, .feed-shared-social-action-bar, .social-actions-button";
    const maxTop = window.innerHeight * 0.55;
    const scope = document.querySelector("main") || document.body;

    for (const el of scope.querySelectorAll(
      "button, [role='button'], .share-box-feed-entry__trigger, span, div[tabindex='0'], [id^='ember']"
    )) {
      if (el.closest(exclude)) continue;
      const r = el.getBoundingClientRect();
      if (r.top > maxTop || r.width < 2 || r.height < 2) continue;
      const label = (el.getAttribute("aria-label") || el.textContent || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      if (!label.includes(n)) continue;
      const clickTarget =
        el.closest("button") ||
        el.closest("[role='button']") ||
        (el.id?.startsWith("ember") ? el : null) ||
        el.closest("[id^='ember']") ||
        el;
      if (!clickTarget || clickTarget.closest(exclude)) continue;
      const tr = clickTarget.getBoundingClientRect();
      if (tr.top > maxTop || tr.width < 2) continue;
      return clickTarget;
    }
    return null;
  }, text);

  const el = handle.asElement();
  if (!el) {
    await handle.dispose();
    return null;
  }
  return el;
}

async function clickComposerByText(page, text) {
  const el = await findComposerButtonByText(page, text);
  if (!el) return false;
  const { humanClickOrFallback } = require("./human-click");
  await el.evaluate((node) =>
    node.scrollIntoView({ block: "center", inline: "center" })
  );
  await sleep(300);
  await humanClickOrFallback(page, el);
  return true;
}

function primaryComposerOpeners() {
  return uniqueSelectors([
    ...selectorList("COMPOSER_OPENER_SELECTOR", PRIMARY_COMPOSER_OPENERS),
    ...PRIMARY_COMPOSER_OPENERS,
  ]);
}

async function clickComposerSelector(page, selector, timeoutMs = 2000) {
  if (!isAllowedComposerSelector(selector)) return false;
  try {
    const el = await page.waitForSelector(selector, {
      visible: true,
      timeout: timeoutMs,
    });
    if (!el) return false;
    if (!(await isGroupComposerTrigger(page, selector))) return false;
    const { humanClickOrFallback } = require("./human-click");
    await el.evaluate((node) =>
      node.scrollIntoView({ block: "center", inline: "center" })
    );
    await sleep(300);
    await humanClickOrFallback(page, el);
    return true;
  } catch {
    return false;
  }
}

async function waitForComposerButton(page, extraTriggers = [], groupUrl = "") {
  if (groupUrl) {
    await prepareGroupPage(page, groupUrl, { forPost: true });
  }

  const { humanClickOrFallback } = require("./human-click");
  const waitMs = Number(process.env.COMPOSER_BUTTON_WAIT_MS || 60_000);
  const primaryOpeners = primaryComposerOpeners();
  const startTexts = [
    "start a public post",
    "start a post in this group",
    (process.env.START_POST_TEXT || "").trim(),
  ].filter(Boolean);
  const pollMs = Number(process.env.POLL_CLICK_INTERVAL_MS || 500);

  const discovered = await discoverGroupComposerOpeners(page);
  if (discovered.length) {
    console.log(
      `  → Group share-box openers: ${discovered.slice(0, 4).join(", ")}`
    );
  }

  const selectors = uniqueSelectors([
    ...selectorList("START_POST_SELECTOR", DEFAULT_START_SELECTORS),
    ...discovered,
    ...extraTriggers,
    COMPOSER_BUTTON_SELECTOR,
  ])
    .filter((s) => !primaryOpeners.includes(s))
    .filter(isAllowedComposerSelector);

  console.log(
    `  → Waiting for composer (up to ${Math.round(waitMs / 1000)}s, "Start a public post" / #ember95)…`
  );

  const tryOpenComposer = async (clickFn, label) => {
    const clicked = await clickFn();
    if (!clicked) return null;
    await sleep(700);
    if (await recoverGroupPageIfNeeded(page, groupUrl)) {
      console.log(`  → ${label} left group page — retrying on group…`);
      return null;
    }
    if (await waitForPostComposerOpen(page, 12_000)) {
      return { el: null, selector: label, clickedByText: label.startsWith("text:") };
    }
    console.log(`  → Clicked ${label} but composer did not open — trying next…`);
    await recoverGroupPageIfNeeded(page, groupUrl);
    try {
      await page.keyboard.press("Escape");
    } catch {
      /* ignore */
    }
    await sleep(400);
    return null;
  };

  const deadline = Date.now() + waitMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    if (attempt % 8 === 1) {
      await activeScrollForComposer(page);
    }

    if (attempt % 10 === 1) {
      console.log('  → Looking for "Start a public post" / #ember95 / #ember96…');
    }

    for (const startText of startTexts) {
      const opened = await tryOpenComposer(
        () => clickComposerByText(page, startText),
        `text:${startText}`
      );
      if (opened) {
        console.log(`  → [BUTTON] Clicked: "${startText}"`);
        return opened;
      }
    }

    for (const selector of primaryOpeners) {
      const opened = await tryOpenComposer(
        () => clickComposerSelector(page, selector, 5000),
        selector
      );
      if (opened) {
        console.log(`  → [BUTTON] Clicked: ${selector}`);
        return opened;
      }
    }

    for (const selector of selectors) {
      try {
        const el = await page.waitForSelector(selector, {
          visible: true,
          timeout: 1000,
        });
        if (!el) continue;
        if (!(await isGroupComposerTrigger(page, selector))) continue;

        await el.evaluate((node) =>
          node.scrollIntoView({ block: "center", inline: "center" })
        );
        await sleep(250);
        await humanClickOrFallback(page, el);
        const opened = await tryOpenComposer(async () => true, selector);
        if (opened) {
          opened.el = el;
          opened.clickedByText = false;
          return opened;
        }
      } catch {
        /* try next selector */
      }
    }

    await sleep(pollMs);
  }
  return null;
}

async function activeScrollForComposer(page) {
  await scrollToGroupComposer(page);
}

async function preparePageForGroupPost(page, groupUrl) {
  const active = getLinkedInPage(page);
  const groupId = groupUrl.match(/groups\/(\d+)/)?.[1];
  let url = "";
  try {
    url = await active.url();
  } catch {
    url = "";
  }

  if (groupId && !url.includes(groupId)) {
    await visitGroup(page, groupUrl);
    await waitForGroupPageReady(page);
  }

  await prepareGroupPage(page, groupUrl, { forPost: true });
}

async function clickGroupPostButton(page, groupUrl, extraTriggers = []) {
  const { isLoggedIn, ensureAuthForTarget, needsLinkedInAuth, logBotUrl } =
    require("./linkedin-login");

  if (!(await isLoggedIn(page)) || needsLinkedInAuth(page)) {
    const login = await ensureAuthForTarget(page, groupUrl);
    if (!login.ok) {
      console.warn("  → LinkedIn login failed before posting.");
      return { ok: false, reason: "login" };
    }
    if (groupUrl) await visitGroup(page, groupUrl);
  }

  await logBotUrl(page, "before composer");

  const found = await waitForComposerButton(page, extraTriggers, groupUrl);
  if (found) {
    console.log(
      `  → Clicked composer: ${found.selector.slice(0, 80)}${found.selector.length > 80 ? "…" : ""}`
    );
    return { ok: true, clicked: true, selector: found.selector };
  }

  let debugUrl = "";
  try {
    debugUrl = (await getLinkedInPage(page).url()) || "";
  } catch {
    debugUrl = "";
  }
  if (debugUrl) {
    console.log(`  → Composer miss on: ${debugUrl.replace(/^https?:\/\//, "").slice(0, 120)}`);
  }

  const candidates = await discoverPostComposerButtons(page);
  console.log("  → Composer button not found after load. Possible buttons on page:");
  for (const c of candidates) {
    const idPart = c.selector ? c.selector : c.tag;
    console.log(`     ${idPart} — ${c.label || "(no label)"}`);
  }

  return { ok: false, clicked: false, candidates };
}

/** Click #ember95 at top of group → opens popup composer (editor in #ember348 etc.). */
async function clickEmber95Composer(page) {
  await scrollToGroupComposer(page);

  const openers = uniqueSelectors([
    ...selectorList("COMPOSER_OPENER_SELECTOR", ["#ember95", ".groups-share-box #ember95"]),
    "#ember95",
    ".groups-share-box #ember95",
  ]);

  const { humanClickOrFallback } = require("./human-click");
  for (const selector of openers) {
    try {
      const el = await page.waitForSelector(selector, { visible: true, timeout: 8000 });
      if (!el) continue;
      const target = await page.$("#ember95");
      const clickEl = target || el;
      await clickEl.evaluate((node) =>
        node.scrollIntoView({ block: "center", inline: "center" })
      );
      await sleep(400);
      console.log("  → Clicking #ember95 to open post popup…");
      await humanClickOrFallback(page, clickEl);
      await sleep(1500);
      if (await waitForPostComposerOpen(page, 15_000)) {
        return true;
      }
      console.log(`  → Clicked ${selector} but popup editor not visible yet…`);
    } catch {
      /* try next */
    }
  }
  return false;
}

async function trySubmitNearEditor(page, editor, submitSelectors) {
  const scoped = await editor.evaluate((el) => {
    let node = el;
    while (node && node !== document.body) {
      if (node.id && node.id.startsWith("ember")) {
        const esc = CSS.escape(node.id);
        return [
          `#${esc} div.share-creation-state__footer button`,
          `#${esc} div.share-creation-state__footer > div`,
          `#${esc} button.share-actions__primary-action`,
        ];
      }
      node = node.parentElement;
    }
    return [];
  });
  if (scoped.length && (await tryClick(page, scoped))) {
    console.log("  → Submit via editor's ember root");
    return true;
  }
  return tryClick(page, submitSelectors);
}

async function publishPost(page, postContent, groupUrl) {
  if (!postContent) return { ok: false, postUrl: null };

  if (process.env.DRY_RUN === "true") {
    console.log(`  → [DRY RUN] Post: ${postContent.slice(0, 80)}...`);
    return { ok: true, postUrl: "dry-run" };
  }

  const baseUi = buildPostUiSelectorLists();
  console.log(
    `  → Post UI variants: ${emberIdsFromEnv().join(", ")} + auto-detect`
  );

  if (groupUrl) {
    await preparePageForGroupPost(page, groupUrl);
  }

  console.log("  → Step 1: open composer (Start a public post / #ember95)…");
  await sleep(Number(process.env.POST_STEP_DELAY_MS || 2000));

  let openResult = await clickGroupComposerOpener(page);
  if (!openResult.ok) {
    console.log("  → Retrying via composer button wait…");
    const clickResult = await clickGroupPostButton(
      page,
      groupUrl,
      baseUi.composerTriggers
    );
    if (!clickResult.ok || !clickResult.clicked) {
      return { ok: false, postUrl: null };
    }
    openResult = { ok: true, selector: clickResult.selector };
  } else {
    console.log(`  → Composer opened via ${openResult.selector}`);
  }

  await sleep(Number(process.env.POST_STEP_DELAY_MS || 2000));

  const popupUi = await discoverPopupComposerAfterOpen(page);
  if (popupUi.editors.length) {
    console.log(`  → Popup editor root: ${popupUi.editors[0].split(" ")[0]}`);
  }

  const postUi = {
    editorSelectors: uniqueSelectors([
      ...popupUi.editors,
      ...baseUi.editorSelectors,
      ...DEFAULT_EDITOR_SELECTORS,
    ]),
    submitSelectors: uniqueSelectors([
      ...popupUi.submits,
      ...baseUi.submitSelectors,
      ...DEFAULT_SUBMIT_SELECTORS,
    ]),
  };

  console.log("  → Step 2: type post in popup editor…");
  const editor = await waitForEditor(page, postUi.editorSelectors);

  if (!editor) {
    console.warn("  → Popup editor not found (#ember348 / share-creation-state .ql-editor).");
    return { ok: false, postUrl: null };
  }

  const body = String(postContent || "").trim();
  console.log(`  → Post length: ${body.length} chars`);
  await fillPostEditor(page, editor, body);

  const written = await readEditorCharCount(editor);
  if (written < body.length * 0.88) {
    console.warn(
      `  → Post incomplete in editor (${written}/${body.length} chars) — not submitting.`
    );
    return { ok: false, postUrl: null };
  }

  await sleep(Number(process.env.POST_SUBMIT_WAIT_MS || 2000));

  console.log("  → Step 3: click Post button…");
  const submitted = await trySubmitNearEditor(
    page,
    editor,
    postUi.submitSelectors
  );

  if (!submitted) {
    console.warn("  → Post typed; Post button not found in popup footer.");
    return { ok: false, postUrl: null };
  }

  await sleep(4000);
  const postUrl = page.url();
  console.log("  → Post published.");
  return { ok: true, postUrl };
}

function getLinkedInPage(page) {
  return page.__linkedInActivePage || page;
}

async function assessGroupPage(page) {
  const active = getLinkedInPage(page);
  let url = "";
  try {
    url = await active.url();
  } catch {
    return { accessible: false, reason: "navigation_error" };
  }

  const { isLoggedIn, logBotUrl, isAuthPageUrl } = require("./linkedin-login");
  await logBotUrl(page, "group assess");
  if (isAuthPageUrl(url) || !(await isLoggedIn(page))) {
    return { accessible: false, reason: "login_required" };
  }

  const startPostText = (process.env.START_POST_TEXT || "start a post").trim();
  const signals = await active.evaluate((startLabel) => {
    const text = (document.body?.innerText || "").slice(0, 8000);
    const joinBtn = document.querySelector(
      'button[aria-label*="Join" i], button.join-group, .groups-join-button'
    );
    const n = String(startLabel).toLowerCase();
    const hasComposerByText = [...document.querySelectorAll(
      "button, [role='button'], .artdeco-button__text, .share-box-feed-entry__trigger"
    )].some((el) =>
      (el.textContent || el.getAttribute("aria-label") || "")
        .toLowerCase()
        .includes(n)
    );
    return {
      requestJoin:
        /request to join|join this group|pending approval|membership pending/i.test(
          text
        ) || !!joinBtn,
      notFound: /page doesn't exist|page not found|content unavailable/i.test(
        text
      ),
      restricted: /you don.t have access|not a member of this group/i.test(text),
      hasFeed: !!document.querySelector(
        "div.feed-shared-update-v2, article.occludable-update, div.occludable-update, div.groups-feed, [data-test-id='groups-feed'], main.scaffold-layout__main"
      ),
      hasComposer:
        hasComposerByText ||
        !!document.querySelector(
          'button[aria-label*="Start a post" i], button[aria-label*="Create a post" i], .groups-share-box__create-post-button, .share-box-feed-entry__trigger, button.share-box-feed-entry__trigger, [data-control-name="create_post"]'
        ),
    };
  }, startPostText);

  if (signals.notFound) {
    return { accessible: false, reason: "group_not_found" };
  }
  if (signals.requestJoin || signals.restricted) {
    return { accessible: false, reason: "not_joined" };
  }

  return {
    accessible: true,
    hasFeed: signals.hasFeed,
    hasComposer: signals.hasComposer,
  };
}

module.exports = {
  sleep,
  waitForLinkedIn,
  getLinkedInPage,
  visitGroup,
  prepareGroupPage,
  scrollToGroupComposer,
  assessGroupPage,
  ensureLinkedInLoggedIn: require("./linkedin-login").ensureLinkedInLoggedIn,
  waitForGroupPageReady,
  likePostsInFeed,
  commentOnPostsInFeed,
  publishPost,
  clickGroupPostButton,
  preparePostText,
  applyUtm,
};
