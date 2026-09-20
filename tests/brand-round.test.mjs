// Tests: brand round — account-aware site opening, app updater parsing,
// theme catalog. All pure: no spawns, no network, no filesystem.
import test from "node:test";
import assert from "node:assert/strict";

const { extractEmail, accountSiteUrl, SITE_HINTS, ACCOUNT_SITE_KEYS, parseIntentV2 } =
  await import("../dist-test/electron/engine/intent-parser-v2.js");
const { parseBehindCount, updateMessage } = await import(
  "../dist-test/electron/system/app-updates.js"
);
const { THEMES, resolveTheme, isThemeId, DEFAULT_THEME } = await import(
  "../dist-test/src/lib/theme.js"
);

// ─── Account-aware site opening ───────────────────────────────────────────────

test("extractEmail pulls the first address from a clause", () => {
  assert.equal(extractEmail("open my google calendar of gmail dhruv.sharma4944@gmail.com please"), "dhruv.sharma4944@gmail.com");
  assert.equal(extractEmail("no address here"), null);
  assert.equal(extractEmail("open MYMAIL@Example.CO"), "mymail@example.co");
});

test("accountSiteUrl: gmail uses the /mail/u/<email> route", () => {
  assert.equal(
    accountSiteUrl("https://mail.google.com", "dhruv@gmail.com"),
    "https://mail.google.com/mail/u/dhruv@gmail.com/"
  );
});

test("accountSiteUrl: other Google properties take ?authuser=<email>", () => {
  assert.equal(
    accountSiteUrl("https://calendar.google.com", "dhruv@gmail.com"),
    "https://calendar.google.com?authuser=dhruv@gmail.com"
  );
  assert.equal(
    accountSiteUrl("https://example.com?a=1", "x@y.com"),
    "https://example.com?a=1&authuser=x@y.com"
  );
});

test("accountSiteUrl: no email → URL untouched", () => {
  assert.equal(accountSiteUrl("https://calendar.google.com", null), "https://calendar.google.com");
});

test("'open my google calendar of gmail <email>' resolves the account URL (end-to-end parse)", () => {
  const r = parseIntentV2("open my google calendar of gmail dhruvsharma4944@gmail.com");
  assert.equal(r.steps[0].action, "open_website");
  const url = String(r.steps[0].params?.url);
  assert.ok(url.includes("calendar.google.com"));
  assert.ok(url.includes("authuser=dhruvsharma4944@gmail.com"));
  assert.equal(r.steps[0].params?.account, "dhruvsharma4944@gmail.com");
  assert.ok(r.steps[0].description.includes("dhruvsharma4944@gmail.com"));
});

test("'open my gmail <email>' uses the mail route (end-to-end parse)", () => {
  const r = parseIntentV2("open my gmail dhruvsharma4944@gmail.com");
  assert.equal(r.steps[0].action, "open_website");
  const url = String(r.steps[0].params?.url);
  assert.ok(url.startsWith("https://mail.google.com/mail/u/"));
  assert.ok(url.includes("dhruvsharma4944@gmail.com"));
});

test("site hints: new targets exist with correct URLs", () => {
  assert.equal(SITE_HINTS["google calendar"].url, "https://calendar.google.com");
  assert.equal(SITE_HINTS["youtube studio"].url, "https://studio.youtube.com");
  assert.equal(SITE_HINTS.chatgpt.url, "https://chatgpt.com");
  assert.equal(SITE_HINTS.gemini.url, "https://gemini.google.com");
  assert.equal(SITE_HINTS.spotify.url, "https://open.spotify.com");
  assert.equal(SITE_HINTS.flipkart.url, "https://www.flipkart.com");
  // single 'calendar' key still resolves to Google Calendar
  assert.equal(SITE_HINTS.calendar.label, "Google Calendar");
});

test("account keys cover the Google family", () => {
  for (const k of ["gmail", "calendar", "google calendar", "drive", "docs", "sheets", "meet", "gemini"]) {
    assert.ok(ACCOUNT_SITE_KEYS.has(k), `missing account key: ${k}`);
  }
  // non-Google sites never take authuser
  assert.ok(!ACCOUNT_SITE_KEYS.has("youtube"));
  assert.ok(!ACCOUNT_SITE_KEYS.has("chatgpt"));
});

test("'open chatgpt' still parses to the plain site (no account)", () => {
  const r = parseIntentV2("open chatgpt");
  assert.equal(r.steps[0].action, "open_website");
  assert.equal(r.steps[0].params?.url, "https://chatgpt.com");
  assert.equal(r.steps[0].params?.account, undefined);
});

// ─── App updater (pure parts) ────────────────────────────────────────────────

test("parseBehindCount counts commits from rev-list output", () => {
  assert.equal(parseBehindCount("abc123\ndef456\n"), 2);
  assert.equal(parseBehindCount(""), 0);
  assert.equal(parseBehindCount("  \n"), 0);
  assert.equal(parseBehindCount("one-line\n"), 1);
});

test("updateMessage: honest copy for every outcome", () => {
  assert.match(updateMessage(3, true), /3 new commits/);
  assert.match(updateMessage(1, true), /1 new commit/);
  assert.match(updateMessage(0, false), /already on the latest/);
  assert.match(updateMessage(2, false), /couldn't apply/);
});

// ─── Theme catalog ────────────────────────────────────────────────────────────

test("theme catalog: violet brand first, five themes, dark flags honest", () => {
  assert.equal(THEMES[0].id, "violet");
  assert.equal(THEMES.length, 5);
  const violet = THEMES.find((t) => t.id === "violet");
  assert.ok(violet?.dark);
  assert.equal(DEFAULT_THEME, "violet");
});

test("resolveTheme: saved values win, junk falls back to the brand default", () => {
  assert.equal(resolveTheme("pink"), "pink");
  assert.equal(resolveTheme("violet"), "violet");
  assert.equal(resolveTheme("neon-orange"), DEFAULT_THEME);
  assert.equal(resolveTheme(null), DEFAULT_THEME);
  assert.equal(resolveTheme(undefined), DEFAULT_THEME);
});

test("isThemeId validates exactly the catalog ids", () => {
  for (const t of THEMES) assert.ok(isThemeId(t.id));
  assert.ok(!isThemeId("rainbow"));
  assert.ok(!isThemeId(""));
});
