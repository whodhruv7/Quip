// Tests: Open-Visible round — the user's kwazy asks on top of Build 13
// ── the ghost cursor PERFORMS every open (apps / sites / files / compose)
// ── file-search follow-up flow (pending choices → "open it" → open-with)
// ── surface routing ("open X on web / in chrome")
// ── gmail compose WITH details + "gmail likh and send" → MailWing + switch
// Deterministic: no PowerShell, no real browser, no overlay (linux build).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const requireCjs = createRequire(import.meta.url);

const parser = await import("../dist-test/electron/engine/intent-parser-v2.js");
const core = await import("../dist-test/electron/engine/ghost-cursor-core.js");
const ghost = await import("../dist-test/electron/engine/ghost-cursor.js");
const contextMod = await import("../dist-test/electron/engine/context-store.js");
const registry = await import("../dist-test/electron/engine/tool-registry.js");
const browserAuto = await import("../dist-test/electron/engine/browser-automation.js");
const appDiscovery = await import("../dist-test/electron/engine/app-discovery.js");
const fileDiscovery = await import("../dist-test/electron/engine/file-discovery.js");
const mailwing = await import("../dist-test/electron/engine/mailwing.js");

const { parseIntentV2, matchPendingFollowup, parsePendingChoice } = parser;
const { openCaption, keyCaption, physicalFromDip } = core;
const { ghostPerformOpen, ghostCursorEnabled } = ghost;
const { contextStore } = contextMod;
const { executeTool, invalidateAppIndex } = registry;
const { resolveLocalCandidates } = fileDiscovery;

const CTX = { platform: "win32" };

// Patchable CJS exports — the compiled engine dereferences THESE objects,
// so mutating them redirects the real call sites (ESM namespaces are frozen).
const browserAutoCjs = requireCjs("../dist-test/electron/engine/browser-automation.js");
const appDiscoveryCjs = requireCjs("../dist-test/electron/engine/app-discovery.js");

// ─── Pure core additions ─────────────────────────────────────────────────────

test("ghost core: open/key captions + DIP conversion", () => {
  assert.equal(openCaption("YouTube"), "opening YouTube…");
  assert.equal(openCaption(""), "opening…");
  assert.match(keyCaption(["ctrl", "enter"]), /pressing ctrl \+ enter…/);
  assert.deepEqual(physicalFromDip(100, 200, 1.5), { x: 150, y: 300 });
  assert.deepEqual(physicalFromDip(100, 200, 1), { x: 100, y: 200 });
  assert.deepEqual(physicalFromDip(NaN, 5, 1.5), { x: 0, y: 5 }, "garbage falls back safely");
});

test("ghost: the cursor is soft-off off-Windows and the act still fires", async () => {
  let fired = 0;
  const shown = await ghostPerformOpen({ label: "Spotify", act: () => { fired += 1; } });
  if (!ghostCursorEnabled()) {
    assert.equal(fired, 1, "performance is a layer on top — never a dependency");
    assert.equal(shown, undefined); // void; the act is the contract
  }
  await ghostPerformOpen({ label: "X" }); // must not throw without overlay
});

// ─── Surface routing ─────────────────────────────────────────────────────────

test("surface: 'open whatsapp on web' opens the web surface, not the app", () => {
  const p = parseIntentV2("open whatsapp on web");
  assert.equal(p.isTask, true);
  assert.equal(p.steps[0].action, "open_website");
  assert.match(p.steps[0].params.url, /web\.whatsapp\.com/);
});

test("surface: 'open youtube in chrome' names the browser", () => {
  const p = parseIntentV2("open youtube in chrome");
  assert.equal(p.steps[0].action, "open_website");
  assert.equal(p.steps[0].params.browser, "chrome");
});

test("surface: plain 'open whatsapp' still prefers the desktop app", () => {
  const p = parseIntentV2("open whatsapp");
  assert.equal(p.steps[0].action, "open_app");
});

// ─── Pending-choice follow-up flow ───────────────────────────────────────────

test("pending: short replies map onto choices, cancel and search-again", () => {
  assert.equal(parsePendingChoice("the second one"), 2);
  assert.equal(parsePendingChoice("last"), -1);
  assert.equal(matchPendingFollowup("open it")?.kind, "choice");
  assert.equal(matchPendingFollowup("haan")?.choice, 1);
  assert.equal(matchPendingFollowup("no")?.kind, "cancel");
  assert.equal(matchPendingFollowup("search again")?.kind, "again");
  const withApp = matchPendingFollowup("open it with vlc");
  assert.equal(withApp?.openWith, "vlc");
  assert.equal(matchPendingFollowup("open chrome"), null, "real targets are not hijacked");
});

test("pending: parser turns replies into fromPending steps", () => {
  contextStore.reset();
  contextStore.update({
    pendingChoices: [
      { label: "resume.pdf", path: "C:\\u\\Desktop\\resume.pdf", kind: "file" },
      { label: "resume-old.pdf", path: "C:\\u\\Documents\\resume-old.pdf", kind: "file" },
    ],
    pendingQuery: "resume",
  });
  const pick = parseIntentV2("open the second one", { context: contextStore.get() });
  assert.equal(pick.steps[0].action, "open_file");
  assert.equal(pick.steps[0].params.fromPending, "true");
  assert.equal(pick.steps[0].params.choice, "2");
  const cancel = parseIntentV2("no", { context: contextStore.get() });
  assert.equal(cancel.steps[0].params.fromPending, "cancel");
  const again = parseIntentV2("search again", { context: contextStore.get() });
  assert.equal(again.steps[0].params.query, "resume");
  contextStore.reset();
});

test("pending: open_file search results ASK and store choices; follow-up opens", async () => {
  fs.mkdirSync(path.join(os.homedir(), "Desktop"), { recursive: true });
  fs.mkdirSync(path.join(os.homedir(), "Documents"), { recursive: true });
  const a = `quipcap-follow-${Date.now()}-a.txt`;
  const b = `quipcap-follow-${Date.now()}-b.txt`;
  fs.writeFileSync(path.join(os.homedir(), "Desktop", a), "x");
  fs.writeFileSync(path.join(os.homedir(), "Documents", b), "x");
  try {
    contextStore.reset();
    // file_op search → list + pending choices stored
    const search = await executeTool(
      "file_op",
      { action: "file_op", target: "quipcap-follow", params: { op: "search", query: "quipcap-follow" } },
      CTX
    );
    assert.equal(search.success, true);
    assert.match(search.output, /open the second one|open it/);
    const stored = contextStore.get().pendingChoices;
    assert.ok(stored && stored.length >= 2, "hits stored as pending choices");

    // follow-up reply → parses to fromPending step → opens (honest result)
    const pick = parseIntentV2("open the first one", { context: contextStore.get() });
    assert.equal(pick.steps[0].params.choice, "1");
    const opened = await executeTool("open_file", pick.steps[0], CTX);
    assert.equal(typeof opened.success, "boolean");
    assert.ok(opened.output.length > 0);

    // cancel clears
    const cancel = await executeTool(
      "open_file",
      { action: "open_file", target: "cancel", params: { fromPending: "cancel", query: "cancel" } },
      CTX
    );
    assert.equal(cancel.success, true);
    assert.equal((contextStore.get().pendingChoices ?? []).length, 0);
  } finally {
    for (const f of [a, b]) {
      try { fs.unlinkSync(path.join(os.homedir(), "Desktop", f)); } catch { /* Documents one */ }
      try { fs.unlinkSync(path.join(os.homedir(), "Documents", f)); } catch { /* already gone */ }
    }
    contextStore.reset();
  }
});

test("files: resolveLocalCandidates ranks an exact path above fuzzy hits", async () => {
  fs.mkdirSync(path.join(os.homedir(), "Desktop"), { recursive: true });
  const marker = `quipcap-rank-${Date.now()}.txt`;
  fs.writeFileSync(path.join(os.homedir(), "Desktop", marker), "x");
  try {
    const fuzzy = await resolveLocalCandidates("quipcap-rank", contextStore.get());
    assert.ok(fuzzy.length >= 1);
    assert.ok(fuzzy[0].score >= 80);
    const exact = await resolveLocalCandidates(`~/Desktop/${marker}`);
    assert.equal(exact[0].source, "exact-path");
    assert.equal(exact[0].score, 100);
  } finally {
    fs.unlinkSync(path.join(os.homedir(), "Desktop", marker));
  }
});

// ─── Gmail: compose with details, MailWing send routing, account switch ──────

test("gmail: 'gmail likh ... send kr de' reaches the MailWing real-send flow", () => {
  const p = parseIntentV2("gmail likh dhruv@gmail.com ko and send kr de saying meeting kal hai");
  assert.equal(p.isTask, true);
  const actions = p.steps.map((s) => s.action);
  assert.ok(actions.includes("mailwing_draft"), `expected mailwing_draft in ${actions}`);
  assert.ok(actions.includes("mailwing_send"), "the send step must be planned");
  assert.equal(p.steps[0].params.to, "dhruv@gmail.com");
});

test("gmail: compose without send prefills to/subject/body (never a blank window)", () => {
  const p = parseIntentV2("email to boss@work.com about report saying numbers attached");
  assert.equal(p.steps[0].action, "compose_email");
  assert.equal(p.steps[0].params.to, "boss@work.com");
  assert.equal(p.steps[0].params.subject, "report");
  assert.match(p.steps[0].params.body, /numbers attached/);
  assert.ok(String(p.steps[0].params.text).trim().length > 0, "contract text slot");
});

test("gmail: 'switch my gmail' → account switch step (no compose verb)", () => {
  const p = parseIntentV2("switch my gmail");
  assert.equal(p.steps[0].action, "mailwing_accounts");
  assert.equal(p.steps[0].params.op, "switch");
  const named = parseIntentV2("switch gmail to other.id@gmail.com");
  assert.equal(named.steps[0].params.account, "other.id@gmail.com");
  // "email my second client about X" must NOT switch accounts
  const notSwitch = parseIntentV2("email my second client about the invoice");
  assert.notEqual(notSwitch.steps[0]?.action, "mailwing_accounts");
});

test("gmail: compose_email executor bakes the details into the URL", async () => {
  const original = browserAutoCjs.openBrowserSurface;
  browserAutoCjs.openBrowserSurface = async (url) => ({
    ok: true,
    summary: `opened ${url}`,
    evidence: [`stub ${url}`],
  });
  try {
    const r = await executeTool(
      "compose_email",
      {
        action: "compose_email",
        target: "gmail",
        params: { to: "boss@work.com", subject: "invoice", body: "please find attached", text: "please find attached" },
      },
      CTX
    );
    assert.equal(r.success, true);
    assert.match(r.output, /boss@work\.com/);
    assert.match(r.output, /invoice/);
    // Verify via the context store — the executor records the URL it opened.
    const stored = contextStore.get().activeUrl ?? "";
    assert.match(stored, /view=cm/);
    assert.match(stored, /to=boss%40work\.com|to=boss@work\.com/);
    assert.match(stored, /su=invoice/);
    assert.match(stored, /body=please/);
  } finally {
    browserAutoCjs.openBrowserSurface = original;
    contextStore.reset();
  }
});

test("gmail: switch op flips the vault default, web-falls-back with no accounts", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quip-mailwing-"));
  mailwing.configureMailwing(dir);
  try {
    // zero accounts → web fallback (stubbed browser)
    const original = browserAutoCjs.openBrowserSurface;
    browserAutoCjs.openBrowserSurface = async (url) => ({ ok: true, summary: `opened ${url}`, evidence: [] });
    try {
      const none = await executeTool(
        "mailwing_accounts",
        { action: "mailwing_accounts", target: "other", params: { op: "switch" } },
        CTX
      );
      assert.equal(none.success, true);
      assert.match(none.output, /other signed-in Gmail|browser/);
    } finally {
      browserAutoCjs.openBrowserSurface = original;
    }

    // two accounts → "other" flips the default; named switch works too
    mailwing.upsertAccount({ label: "personal", smtpHost: "smtp.gmail.com", smtpPort: 587, secure: false, user: "a@gmail.com", pass: "pw", fromEmail: "a@gmail.com", isDefault: true });
    mailwing.upsertAccount({ label: "work", smtpHost: "smtp.gmail.com", smtpPort: 587, secure: false, user: "b@gmail.com", pass: "pw", fromEmail: "b@gmail.com" });
    const flip = await executeTool(
      "mailwing_accounts",
      { action: "mailwing_accounts", target: "other", params: { op: "switch" } },
      CTX
    );
    assert.equal(flip.success, true);
    assert.match(flip.output, /work/);
    assert.equal(mailwing.resolveAccount("work")?.isDefault, true);

    const named = await executeTool(
      "mailwing_accounts",
      { action: "mailwing_accounts", target: "personal", params: { op: "switch", account: "personal" } },
      CTX
    );
    assert.equal(named.success, true);
    assert.equal(mailwing.resolveAccount("personal")?.isDefault, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─── The ghost cursor is WIRED into every open executor ──────────────────────

test("contract: open_app/open_website/open_url/search/open_file/open_folder/compose perform the cursor", () => {
  const src = fs.readFileSync(new URL("../electron/engine/tool-registry.ts", import.meta.url), "utf8");
  const executor = (name) => {
    const i = src.indexOf(`async ${name}(`);
    assert.ok(i > 0, `${name} exists`);
    const next = src.indexOf("async ", i + 6);
    return src.slice(i, next > i ? next : undefined);
  };
  for (const name of ["open_app", "open_website", "open_url", "open_file", "open_folder", "compose_email"]) {
    assert.match(executor(name), /ghostPerformOpen\(/, `${name} must be VISIBLE — the cursor performs it`);
  }
  // the pending pick path performs too
  assert.match(src, /handlePendingOpen[\s\S]*?ghostPerformOpen\(/, "pending choices open visibly");
});

test("contract: key presses get the keycap gesture; main anchors the cursor", () => {
  const dc = fs.readFileSync(new URL("../electron/engine/desktop-controller.ts", import.meta.url), "utf8");
  const keyCase = dc.slice(dc.indexOf('case "key":'), dc.indexOf('case "click":'));
  assert.match(keyCase, /ghostType\(keyCaption/, "press_key is visible too");
  const main = fs.readFileSync(new URL("../electron/main.ts", import.meta.url), "utf8");
  assert.match(main, /setGhostAnchor\(win\.getBounds\(\)\)/, "cursor appears FROM the companion");
});

// ─── open_app end-to-end with a stubbed index + launcher ─────────────────────

test("open_app: resolves a real index hit and launches it (cursor act fires)", async () => {
  const originalBuild = appDiscoveryCjs.buildInstalledAppIndex;
  const originalLaunch = appDiscoveryCjs.launchApp;
  let launched = null;
  appDiscoveryCjs.buildInstalledAppIndex = async () => [
    { name: "QuipTestApp", executable: "C:\\apps\\QuipTestApp.exe", procName: "QuipTestApp", confidence: 0.95 },
  ];
  appDiscoveryCjs.launchApp = async (app) => ({
    ok: true,
    summary: `Opened ${app.name}.`,
    evidence: ["stub launch"],
  });
  try {
    invalidateAppIndex();
    const r = await executeTool(
      "open_app",
      { action: "open_app", target: "QuipTestApp", params: { appName: "QuipTestApp", query: "QuipTestApp" } },
      CTX
    );
    assert.equal(r.success, true, r.output);
    assert.match(r.output, /Opened QuipTestApp/);
    assert.equal(contextStore.get().activeApp, "QuipTestApp");
  } finally {
    appDiscoveryCjs.buildInstalledAppIndex = originalBuild;
    appDiscoveryCjs.launchApp = originalLaunch;
    invalidateAppIndex();
    contextStore.reset();
  }
});
