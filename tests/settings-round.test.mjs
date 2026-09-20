// Tests: Settings V3 round — account addressing (specific-target commands),
// theme registry integrity, IPC surface additions, and the Quip Appearance /
// Fetch Updates wiring contracts. Pure/deterministic: no network, no spawns.
import test from "node:test";
import assert from "node:assert/strict";

const {
  parseIntentV2,
  extractAccountEmail,
  accountAwareUrl,
} = await import("../dist-test/electron/engine/intent-parser-v2.js");

// ─── Account addressing — email extraction ──────────────────────────────────

test("account: extracts a plain email from the command", () => {
  assert.equal(
    extractAccountEmail("open my google calendar of gmail dhruvsharma4944@gmail.com"),
    "dhruvsharma4944@gmail.com"
  );
});

test("account: extracts dots/plus emails and returns null when absent", () => {
  assert.equal(extractAccountEmail("mail me at dhruv.sharma+quip@outlook.com now"), "dhruv.sharma+quip@outlook.com");
  assert.equal(extractAccountEmail("open calendar"), null);
});

// ─── Account addressing — URL scoping ────────────────────────────────────────

test("account: gmail URL carries the /u/<email>/ path", () => {
  assert.equal(
    accountAwareUrl("https://mail.google.com", "dhruv@gmail.com"),
    "https://mail.google.com/mail/u/dhruv%40gmail.com/"
  );
});

test("account: calendar URL carries authuser", () => {
  assert.equal(
    accountAwareUrl("https://calendar.google.com", "dhruv@gmail.com"),
    "https://calendar.google.com/calendar/r?authuser=dhruv%40gmail.com"
  );
});

test("account: drive URL opens that account's my-drive", () => {
  assert.equal(
    accountAwareUrl("https://drive.google.com", "a@b.co"),
    "https://drive.google.com/drive/u/a%40b.co/my-drive"
  );
});

test("account: youtube URL carries authuser; non-Google sites pass through", () => {
  assert.equal(
    accountAwareUrl("https://www.youtube.com", "a@b.co"),
    "https://www.youtube.com/?authuser=a%40b.co"
  );
  assert.equal(accountAwareUrl("https://github.com", "a@b.co"), "https://github.com");
  assert.equal(accountAwareUrl("https://mail.google.com", null), "https://mail.google.com");
});

// ─── Parser integration — the user's exact example ───────────────────────────

test("parser: 'open my google calendar of gmail dhruvsharma4944@gmail.com' opens THAT calendar", () => {
  const r = parseIntentV2("open my google calendar of gmail dhruvsharma4944@gmail.com");
  const step = r.steps.find((s) => s.action === "open_website");
  assert.ok(step, "expected an open_website step");
  assert.equal(step.params.url, "https://calendar.google.com/calendar/r?authuser=dhruvsharma4944%40gmail.com");
  assert.equal(step.params.account, "dhruvsharma4944@gmail.com");
});

test("parser: 'open gmail of second.account@gmail.com' scopes gmail", () => {
  const r = parseIntentV2("open gmail of second.account@gmail.com");
  const step = r.steps.find((s) => s.action === "open_website");
  assert.ok(step, "expected an open_website step");
  assert.equal(step.params.url, "https://mail.google.com/mail/u/second.account%40gmail.com/");
});

test("parser: plain 'open gmail' stays the generic URL (no account named)", () => {
  const r = parseIntentV2("open gmail");
  const step = r.steps.find((s) => s.action === "open_website");
  assert.ok(step, "expected an open_website step");
  assert.equal(step.params.url, "https://mail.google.com");
  assert.ok(!("account" in step.params));
});

// ─── Theme registry integrity (src/lib/theme.ts mirrored invariants) ────────

test("theme: every theme id is unique, has label + two swatch colors", async () => {
  // Read the source module text — the renderer module needs DOM globals,
  // so we assert the invariants on its exported data definition instead.
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/lib/theme.ts", import.meta.url), "utf8");
  const ids = [...src.matchAll(/id: "([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length >= 8, `expected >= 8 themes, got ${ids.length}`);
  assert.equal(new Set(ids).size, ids.length, "theme ids must be unique");
  assert.ok(ids.includes("black") && ids.includes("midnight"), "dark themes present");
  const swatches = [...src.matchAll(/swatch: \["(#[0-9A-Fa-f]{6})", "(#[0-9A-Fa-f]{6})"\]/g)];
  assert.equal(swatches.length, ids.length, "every theme declares two swatches");
});

// ─── IPC surface additions (Settings buttons) ────────────────────────────────

test("ipc: SHOW_QUIP_DESKTOP + APP_FETCH_UPDATES exist in shared IPC table", async () => {
  const { IPC } = await import("../dist-test/electron/shared.js");
  assert.equal(IPC.SHOW_QUIP_DESKTOP, "quip:show-desktop");
  assert.equal(IPC.APP_FETCH_UPDATES, "quip:fetch-updates");
});

test("preload: exposes showQuipDesktop and fetchUpdates bindings", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../electron/preload.ts", import.meta.url), "utf8");
  assert.ok(src.includes("showQuipDesktop"), "preload must bind showQuipDesktop");
  assert.ok(src.includes("fetchUpdates"), "preload must bind fetchUpdates");
  assert.ok(src.includes("IPC.SHOW_QUIP_DESKTOP"), "preload routes through the shared IPC name");
  assert.ok(src.includes("IPC.APP_FETCH_UPDATES"), "preload routes through the shared IPC name");
});

test("preload: exposes theme application hook-free persistence surface", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/lib/theme.ts", import.meta.url), "utf8");
  assert.ok(src.includes("localStorage"), "theme persists in localStorage");
  assert.ok(src.includes("applySavedTheme"), "theme re-applies before first paint");
});

// ─── Heavy deliberate prompt (main.ts content contract) ─────────────────────

test("system prompt: heavy deliberate identity + addressing + capability doctrine", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../electron/main.ts", import.meta.url), "utf8");
  // The user asked for a heavy deliberate prompt — these sections must exist.
  assert.ok(src.includes("BREAK IT DOWN"), "task-breakdown doctrine present");
  assert.ok(src.includes("VERIFY — 'I clicked' is not 'it worked'"), "verification doctrine present");
  assert.ok(src.includes("NEVER fake success"), "honest-failure doctrine present");
  assert.ok(src.includes("dhruvsharma4944@gmail.com"), "account addressing example present");
  assert.ok(src.includes("Specifics beat defaults"), "specific-target rule present");
  assert.ok(src.includes("assembleSections(sections, 5500)"), "budget raised to hold the heavy prompt");
  assert.ok(src.includes("APPS & WINDOWS") && src.includes("SCREEN:"), "capability surface enumerated");
});

test("main: Fetch Updates handler is honest — no fake success paths", async () => {
  const fs = await import("node:fs");
  const main = fs.readFileSync(new URL("../electron/main.ts", import.meta.url), "utf8");
  assert.ok(main.includes("FETCH_UPDATES"), "handler registered in main");
  // The pipeline lives in electron/system/app-updates.ts (main.ts delegates).
  const src = fs.readFileSync(new URL("../electron/system/app-updates.ts", import.meta.url), "utf8");
  assert.ok(src.includes("rev-parse"), "checks it is a git checkout");
  assert.ok(src.includes("--ff-only"), "pull is fast-forward only (no surprise merges)");
  assert.ok(src.includes("stash"), "local changes protected before pull");
  assert.ok(src.includes("needsRestart"), "restart hint only when commits actually landed");
});
