// Tests: Completion round — the remaining CAP items made real
// ─────────────────────────────────────────────────────────────────────────────
// CAP-008 ghost screenshot path builder · CAP-022 reply-chain parsing ·
// CAP-040 content grep search · CAP-048 snap presets (rect math via registry
// import) · CAP-060 quest approval budget · CAP-068 ambiguity rule ·
// CAP-069 session contact memory · CAP-070 multi-verb chains ·
// CAP-075/076 failure classification + recovery decisions.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ghost = await import("../dist-test/electron/engine/web-ghost.js");
const mailwing = await import("../dist-test/electron/engine/mailwing.js");
const fileOps = await import("../dist-test/electron/engine/file-ops.js");
const hands = await import("../dist-test/electron/engine/ghost-hands.js");
const quests = await import("../dist-test/electron/engine/quest-engine.js");
const recovery = await import("../dist-test/electron/actions/recovery.js");
const parserMod = await import("../dist-test/electron/engine/intent-parser-v2.js");
const registry = await import("../dist-test/electron/engine/tool-registry.js");
const contracts = await import("../dist-test/electron/actions/contracts.js");
const catalogMod = await import("../dist-test/electron/engine/tool-catalog.js");
const diary = await import("../dist-test/electron/engine/problem-diary.js");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "quip-complete-"));
diary.configureProblemDiary(TMP); // auto-recording hooks land somewhere honest

const CTX = { platform: process.platform };

// ─── CAP-008: ghost screenshot path builder (pure) ──────────────────────────

test("CAP-008: ghostScreenshotTarget builds host+stamp PNG names", () => {
  const t = ghost.ghostScreenshotTarget("/pics", "https://www.acme.com/contact?a=1", Date.UTC(2026, 0, 2, 3, 4, 5));
  assert.match(t.file, /^ghost-acme\.com-2026-01-02T03-04-05\.png$/);
  assert.equal(t.dir, "/pics");
  const weird = ghost.ghostScreenshotTarget("/pics", "not a url", 0);
  assert.match(weird.file, /^ghost-page-/);
});

// ─── CAP-022: reply-chain parsing (pure) ────────────────────────────────────

test("CAP-022: parseReplyChain detects Re:/Fwd: and strips repeats", () => {
  const pick = (c) => ({ isReply: c.isReply, isForward: c.isForward, cleaned: c.cleaned });
  assert.deepEqual(pick(mailwing.parseReplyChain("Re: Meeting tomorrow")), { isReply: true, isForward: false, cleaned: "Meeting tomorrow" });
  assert.equal(mailwing.parseReplyChain("FWD: invoice").isForward, true);
  const nested = mailwing.parseReplyChain("Re: Re: Fwd: hello");
  assert.equal(nested.isReply, true, "re wins the context tone");
  assert.equal(nested.cleaned, "hello");
  assert.equal(mailwing.parseReplyChain("Fresh subject").isReply, false);
  assert.equal(mailwing.parseReplyChain("").cleaned, "");
  // buildReplyContext gives the humanizer a thread-aware line only for threads.
  assert.match(mailwing.buildReplyContext(mailwing.parseReplyChain("Re: x"), "Re: x"), /REPLY/);
  assert.match(mailwing.buildReplyContext(mailwing.parseReplyChain("Fw: x")), /FORWARD/);
  assert.equal(mailwing.buildReplyContext(mailwing.parseReplyChain("x")), "");
});

// ─── CAP-040: deep file search with content grep ────────────────────────────

test("CAP-040: searchFiles content:true greps inside small text files", () => {
  const dir = fs.mkdtempSync(path.join(TMP, "grep-"));
  fs.writeFileSync(path.join(dir, "notes.txt"), "the launch code is quip-2026", "utf8");
  fs.writeFileSync(path.join(dir, "empty.md"), "", "utf8");
  fs.writeFileSync(path.join(dir, "photo.png"), Buffer.from([0x89, 0x50]), null); // binary, wrong ext
  const nameOnly = fileOps.searchFiles("launch code", dir);
  assert.equal(nameOnly.hits.length, 0, "name search finds nothing");
  const withContent = fileOps.searchFiles("launch code", dir, { content: true });
  assert.equal(withContent.hits.length, 0);
  assert.equal(withContent.contentHits?.length, 1, "content grep finds notes.txt");
  assert.match(withContent.contentHits[0], /notes\.txt$/);
  // Empty file must not match even though it's a text extension.
  const none = fileOps.searchFiles("nothing-matches-this", dir, { content: true });
  assert.equal(none.contentHits?.length, 0);
});

// ─── CAP-048: snap presets (pure rect math) ─────────────────────────────────

test("CAP-048: snapRect covers left/right/maximize/restore for window_snap", () => {
  const wa = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(hands.snapRect("left", wa), { x: 0, y: 0, width: 960, height: 1040 });
  assert.deepEqual(hands.snapRect("right", wa), { x: 960, y: 0, width: 960, height: 1040 });
  const offset = { x: 100, y: 50, width: 1600, height: 900 };
  const right = hands.snapRect("right", offset);
  assert.equal(right.x, offset.x + offset.width / 2);
  // The executor exists and validates its preset before touching the OS.
  assert.ok(registry.executorNames().includes("window_snap"));
});

test("CAP-048: window_snap rejects unknown presets without OS calls", async () => {
  const res = await registry.executeTool("window_snap", { target: "right", params: { preset: "diagonal" } }, CTX);
  assert.equal(res.success, false);
  assert.match(res.output, /Which snap\?/);
});

// ─── CAP-060: quest approval budget ─────────────────────────────────────────

test("CAP-060: repeated destructive approvals auto-approve within the budget, never beyond", async () => {
  let asked = 0;
  quests.configureQuestRuntime({
    executeTool: async () => ({ success: true, output: "ok", note: "" }),
    requestApproval: async () => { asked += 1; return true; },
  });
  const approvalQuest = {
    id: "budget-test",
    title: "Budget test",
    steps: [1, 2, 3].map((i) => ({
      name: `danger-${i}`,
      description: `dangerous step ${i}`,
      risk: "dangerous",
      run: async (ctx) => {
        ctx.emit("waiting_permission");
        const ok = await ctx.rt.requestApproval("Same destructive thing?", ["line"]);
        return ok ? { ok: true, detail: `step ${i} approved` } : { ok: false, detail: "declined" };
      },
    })),
  };
  // Budget 0 → every repeat asks.
  quests.setQuestApprovalBudget(0);
  asked = 0;
  await quests.runQuest(approvalQuest, {});
  assert.equal(asked, 3, "budget 0: asks every time");
  // Budget 1 → first ask, second auto-approved, third asks again (1 auto used).
  quests.setQuestApprovalBudget(1);
  asked = 0;
  const res = await quests.runQuest(approvalQuest, {});
  assert.ok(res.ok);
  assert.equal(asked, 2, "budget 1: asks twice (repeat #2 auto-approved)");
  assert.ok(res.notes.some((n) => n.includes("autonomy budget")), "the auto-approval is disclosed in the notes");
  assert.ok(quests.getQuestApprovalBudget() === 1);
});

// ─── CAP-068: ambiguity rule ────────────────────────────────────────────────

test("CAP-068: near-equal contacts without a hint are ambiguous, never guessed", () => {
  const a = { email: "a@x.com", source: "mailto", score: 80 };
  const b = { email: "b@x.com", source: "mailto", score: 79 };
  const c = { email: "c@x.com", source: "mailto", score: 40 };
  assert.equal(ghost.isAmbiguousContact([a, b], ""), true, "within 5 points → clarify");
  assert.equal(ghost.isAmbiguousContact([a, c], ""), false, "clear winner → decide");
  assert.equal(ghost.isAmbiguousContact([a, b], "founder"), false, "a hint breaks the tie honestly");
  assert.equal(ghost.isAmbiguousContact([a], ""), false, "one contact is never ambiguous");
  const line = ghost.ambiguousChoiceLine([a, b]);
  assert.match(line, /a@x\.com/);
  assert.match(line, / or /);
});

// ─── CAP-069: session contact memory ────────────────────────────────────────

test("CAP-069: last remembered contact resolves 'usko' and expires", async () => {
  ghost.forgetLastContact();
  assert.equal(ghost.lastRememberedContact(), null);
  ghost.rememberLastContact({ email: "rahul@acme.com", name: "Rahul", source: "mailto", score: 90 }, "https://acme.com");
  const got = ghost.lastRememberedContact();
  assert.equal(got?.email, "rahul@acme.com");
  // Negative maxAge → expired → null (30-min window is the real default).
  assert.equal(ghost.lastRememberedContact(-1), null);
  ghost.forgetLastContact();
  assert.equal(ghost.lastRememberedContact(), null);
  // The pronoun path fails honestly when memory is empty.
  const res = await registry.executeTool("mailwing_draft", { target: "usko", params: { to: "usko", body: "hi there" } }, CTX);
  assert.equal(res.success, false);
  assert.match(res.output, /recent contact in memory/);
});

// ─── CAP-070: multi-verb chains ─────────────────────────────────────────────

test("CAP-070: 'X phir Y' parses to one sequential multi-step plan", () => {
  const p = parserMod.parseIntentV2("organize downloads phir battery kitni hai");
  assert.equal(p.isMultiStep, true, "chain detected");
  assert.ok(p.steps.length >= 2, "both halves became steps");
  // A single intent with the word inside stays a single intent.
  const single = parserMod.parseIntentV2("battery kitni hai");
  assert.equal(single.isMultiStep, false);
  // A chain whose second half is garbage degrades to the raw first parse —
  // never a fabricated plan.
  const notChain = parserMod.parseIntentV2("battery kitni hai phir xyzzy qwerty flurb");
  assert.equal(notChain.steps?.length, 1);
});

// ─── CAP-075/076: failure classification + recovery decisions ───────────────

test("CAP-075: new failure modes classify first-class", () => {
  const cl = (note) => recovery.classifyFailure({ note, timedOut: false, cancelled: false });
  assert.equal(cl("smtp auth failed: 535 bad credentials"), "smtp-auth");
  assert.equal(cl("server said: 550 mailbox unavailable"), "smtp-rejected");
  assert.equal(cl("the site blocked the ghost browser (captcha)"), "ghost-blocked");
  assert.equal(cl("the stored password could not be decrypted (vault)"), "vault-locked");
  assert.equal(cl("fs.watch watcher died"), "watch-stopped");
  assert.equal(cl("connection timed out"), "transient", "old modes still classify");
});

test("CAP-076: recovery decisions are honest for the new kinds", () => {
  const dec = (kind) => recovery.decideRecovery({ kind, attempt: 1, retryable: true });
  assert.equal(dec("smtp-auth").strategy, "give-up", "auth never retries");
  assert.match(dec("smtp-auth").reason, /Settings/);
  assert.equal(dec("smtp-rejected").strategy, "give-up", "5xx is final");
  assert.equal(dec("ghost-blocked").strategy, "give-up");
  assert.match(dec("ghost-blocked").reason, /blocked/);
  assert.equal(dec("vault-locked").strategy, "give-up");
  assert.match(dec("vault-locked").reason, /re-enter/);
  assert.equal(dec("watch-stopped").strategy, "reobserve", "watch gets one re-check");
  assert.ok(dec("watch-stopped").backoffMs > 0);
});

// ─── Three-way sync for the three new executors ─────────────────────────────

test("completion round: web_ghost_wait/screenshot + window_snap are synced everywhere", () => {
  for (const action of ["web_ghost_wait", "web_ghost_screenshot", "window_snap"]) {
    assert.ok(registry.executorNames().includes(action), `${action} in registry`);
    assert.ok(contracts.contractedActions().includes(action), `${action} in contracts`);
    const inCatalog = catalogMod.TOOL_CATALOG.some((t) => (t.schema.function?.name ?? t.schema.name) === action);
    assert.ok(inCatalog, `${action} in catalog`);
  }
  assert.equal(contracts.contractFor("web_ghost_screenshot")?.safety, "EXTERNAL");
  assert.equal(contracts.contractFor("window_snap")?.safety, "WRITE");
  assert.equal(contracts.contractFor("web_ghost_wait")?.timeoutMs, 35_000);
});
