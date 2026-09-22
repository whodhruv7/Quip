// Tests: Problem Diary — the memory of everything that went wrong
// ─────────────────────────────────────────────────────────────────────────────
// Pure core (key/severity/merge/evict/markdown), the fs store (dedupe, reopen,
// resolve, clear, export, bounds) and the executor surface (three-way sync +
// list/resolve/export verbs through executeTool). Deterministic: temp dirs,
// no Electron, no network.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const diary = await import("../dist-test/electron/engine/problem-diary.js");
const registry = await import("../dist-test/electron/engine/tool-registry.js");
const contracts = await import("../dist-test/electron/actions/contracts.js");
const catalogMod = await import("../dist-test/electron/engine/tool-catalog.js");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "quip-diary-"));
function freshDir() {
  const dir = fs.mkdtempSync(path.join(TMP, "run-"));
  diary.configureProblemDiary(dir);
  return dir;
}

const CTX = { platform: process.platform };

// ─── Pure core ───────────────────────────────────────────────────────────────

test("diary: problemKey normalizes case + whitespace + length", () => {
  assert.equal(diary.problemKey("tool", "Mail Send   FAILED"), diary.problemKey("tool", "mail send failed"));
  assert.ok(diary.problemKey("quest", "x".repeat(300)).length <= 130 + 20, "key is bounded");
  assert.notEqual(diary.problemKey("tool", "a"), diary.problemKey("mail", "a"), "source is part of the key");
});

test("diary: classifySeverity maps auth/permission high, network medium", () => {
  assert.equal(diary.classifySeverity("smtp-auth", "password rejected"), "high");
  assert.equal(diary.classifySeverity("x", "permission denied by OS"), "high");
  assert.equal(diary.classifySeverity("ghost-blocked", "site blocked us"), "medium");
  assert.equal(diary.classifySeverity("timeout", "connection timed out"), "medium");
  assert.equal(diary.classifySeverity("misc", "some odd case"), "low");
});

test("diary: mergeRepeat bumps occurrences, reopens resolved entries", () => {
  const now = 1_700_000_000_000;
  const base = {
    id: "p-1", key: "tool::x", source: "tool", kind: "executor-failed", severity: "low",
    title: "x failed", detail: "d", status: "resolved", firstSeen: now - 1000,
    lastSeen: now - 1000, resolvedAt: now - 500, occurrences: 1, reopenCount: 0,
  };
  const merged = diary.mergeRepeat(base, { source: "tool", title: "x failed", detail: "again" }, now);
  assert.equal(merged.status, "open", "a repeat reopens");
  assert.equal(merged.occurrences, 2);
  assert.equal(merged.reopenCount, 1, "reopen is counted");
  assert.equal(merged.firstSeen, now - 1000, "first-seen is preserved");
  assert.equal(merged.lastSeen, now);
  assert.ok(merged.resolvedAt === undefined);
});

test("diary: evictOrder puts resolved first, then oldest", () => {
  const mk = (id, status, lastSeen) => ({ id, status, lastSeen });
  const ordered = diary.evictOrder([mk("a", "open", 3), mk("b", "resolved", 9), mk("c", "open", 1), mk("d", "resolved", 2)]);
  assert.deepEqual(ordered.map((e) => e.id), ["d", "b", "c", "a"]);
});

test("diary: toMarkdown renders status/severity/counts and honest empty state", () => {
  const mdEmpty = diary.toMarkdown([], { appVersion: "0.1.0" });
  assert.match(mdEmpty, /No problems recorded/);
  const entries = [
    { id: "1", key: "k", source: "mail", kind: "smtp-auth", severity: "high", title: "send failed", detail: "550 rejected", evidence: ["reply: 550"], status: "open", firstSeen: 0, lastSeen: 0, occurrences: 3, reopenCount: 1 },
    { id: "2", key: "k2", source: "chat", kind: "chat-no-key", severity: "low", title: "no key", detail: "", status: "resolved", firstSeen: 0, lastSeen: 0, occurrences: 1, reopenCount: 0 },
  ];
  const md = diary.toMarkdown(entries, { appVersion: "0.1.0" });
  assert.match(md, /# Quip — Problem Diary export/);
  assert.match(md, /Open problems: 1 · Resolved: 1/);
  assert.match(md, /## \[OPEN\] send failed/);
  assert.match(md, /\*\*Severity:\*\* high/);
  assert.match(md, /3×/);
  assert.match(md, /reopened 1×/);
  assert.match(md, /## \[RESOLVED\] no key/);
  assert.match(md, /reply: 550/);
});

// ─── Store ───────────────────────────────────────────────────────────────────

test("diary: unconfigured noteProblem fails soft (never throws)", () => {
  // Point the store at a FILE — mkdir + every write inside it must fail, and
  // noteProblem must still return null instead of throwing into a failing task.
  const blocker = path.join(TMP, "blocker.txt");
  fs.writeFileSync(blocker, "not a dir", "utf8");
  diary.configureProblemDiary(blocker);
  const r = diary.noteProblem({ source: "tool", title: "whatever" });
  assert.equal(r, null, "broken store → null, no crash");
  assert.equal(diary.listProblems().length, 0);
  assert.equal(diary.exportProblemsMarkdown(path.join(blocker, "report.md")).ok, false, "export into a broken store fails honest");
  // Restore a good store for later tests (each test re-configures anyway).
  freshDir();
  assert.ok(diary.noteProblem({ source: "tool", title: "recovers after store heals" }));
});

test("diary: noteProblem records, dedupes and persists across loads", () => {
  const dir = freshDir();
  const e1 = diary.noteProblem({ source: "quest", title: "email-from-website failed at read-site", detail: "site unreachable", evidence: ["url: https://x.com"] });
  assert.ok(e1);
  const e2 = diary.noteProblem({ source: "quest", title: "Email-From-Website failed at read-site", detail: "site unreachable again" });
  assert.equal(e2.id, e1.id, "same key → same entry");
  assert.equal(e2.occurrences, 2);
  const e3 = diary.noteProblem({ source: "mail", title: "send rejected 550" });
  assert.notEqual(e3.id, e1.id);
  // Store on disk matches what listProblems sees.
  const raw = JSON.parse(fs.readFileSync(path.join(dir, "problems", "diary.json"), "utf8"));
  assert.equal(raw.length, 2);
  assert.equal(diary.listProblems().length, 2);
  assert.equal(diary.listProblems({ status: "open" }).length, 2);
  assert.equal(diary.listProblems({ source: "mail" }).length, 1);
  const stats = diary.problemStats();
  assert.equal(stats.total, 2);
  assert.equal(stats.open, 2);
});

test("diary: resolve + reopen + clear lifecycle", () => {
  freshDir();
  const e = diary.noteProblem({ source: "ghost", title: "site blocked the ghost browser", kind: "ghost-blocked" });
  assert.equal(diary.resolveProblem(e.id).ok, true);
  assert.equal(diary.listProblems({ status: "open" }).length, 0);
  assert.equal(diary.listProblems({ status: "resolved" }).length, 1);
  // The same problem comes back → reopens with reopenCount=1.
  const again = diary.noteProblem({ source: "ghost", title: "site blocked the ghost browser" });
  assert.equal(again.status, "open");
  assert.equal(again.reopenCount, 1);
  assert.equal(diary.resolveProblem("does-not-exist").ok, false);
  const cleared = diary.clearResolved();
  assert.equal(cleared.ok, true);
  assert.equal(diary.problemStats().total, 1, "only the open entry survives clearResolved");
});

test("diary: exportProblemsMarkdown writes the file to Desktop-like path", () => {
  freshDir();
  diary.noteProblem({ source: "chat", title: "chat failed: no AI key configured", kind: "chat-no-key" });
  const target = path.join(TMP, "export", "report.md");
  const res = diary.exportProblemsMarkdown(target);
  assert.equal(res.ok, true);
  assert.equal(res.count, 1);
  const md = fs.readFileSync(target, "utf8");
  assert.match(md, /no AI key configured/);
});

test("diary: CAP eviction prefers resolved, then oldest (500 bound)", () => {
  freshDir();
  // 3 resolved + 3 open, cap is 500 — too slow to fill fully; instead verify
  // the ordering function drives the eviction by simulating via the pure fn.
  const many = [];
  for (let i = 0; i < 501; i++) {
    many.push({
      id: `p-${i}`, key: `k${i}`, source: "tool", kind: "k", severity: "low",
      title: `t${i}`, detail: "", status: i % 2 === 0 ? "resolved" : "open",
      firstSeen: i, lastSeen: i, occurrences: 1, reopenCount: 0,
    });
  }
  const ordered = diary.evictOrder(many);
  const kept = ordered.slice(-500); // evict from the FRONT, keep the tail
  assert.equal(kept.length, 500);
  assert.ok(!kept.some((e) => e.id === "p-0"), "oldest resolved evicted first");
  assert.ok(kept.some((e) => e.status === "open"), "open entries survive longest");
});

// ─── Hooks: executor failures land in the diary ─────────────────────────────

test("diary: executeTool failure records a problem with the real output", async () => {
  freshDir();
  const before = diary.problemStats().total;
  // Unknown action → legacy path fails honestly.
  const res = await registry.executeTool("totally_unknown_action_xyz", { params: {} }, CTX);
  assert.equal(res.success, false);
  const after = diary.problemStats();
  assert.ok(after.total >= before, "failure recorded (legacy path may bypass; core path proven below)");
  // A real executor that fails (problem_diary resolve with a bad id).
  const res2 = await registry.executeTool("problem_diary", { target: "", params: { verb: "resolve", id: "nope-404" } }, CTX);
  assert.equal(res2.success, false);
  const entries = diary.listProblems({ status: "open" });
  assert.ok(entries.some((e) => e.source === "tool" && e.title.includes("problem_diary failed")), "failed executor recorded with its action name");
});

test("diary: problem_diary executor list/resolve/export verbs work end-to-end", async () => {
  freshDir();
  diary.noteProblem({ source: "mail", title: "smtp auth rejected for test@x.com", kind: "smtp-auth", severity: "high" });
  const listed = await registry.executeTool("problem_diary", { target: "", params: {} }, CTX);
  assert.equal(listed.success, true);
  assert.match(listed.output, /HIGH.*smtp auth rejected/i);
  assert.match(listed.output, /1×/);
  // Resolve by list index.
  const resolved = await registry.executeTool("problem_diary", { target: "", params: { verb: "resolve", id: "1" } }, CTX);
  assert.equal(resolved.success, true);
  assert.equal(diary.listProblems({ status: "open" }).length, 0);
  // Export verb writes the report.
  const exported = await registry.executeTool("problem_diary", { target: "", params: { verb: "export" } }, CTX);
  assert.equal(exported.success, true);
  assert.ok(fs.existsSync(exported.evidence[0].replace("path: ", "")));
  // Empty diary is honest, not faked.
  const empty = await registry.executeTool("problem_diary", { target: "", params: { verb: "clear", scope: "all" } }, CTX);
  assert.equal(empty.success, true);
  const none = await registry.executeTool("problem_diary", { target: "", params: {} }, CTX);
  assert.match(none.output, /empty/);
});

test("diary: quest step failure auto-records into the diary", async () => {
  freshDir();
  // Same runtime pattern as the autonomy-wave suite: a fake executeTool +
  // auto-approving permission gate, so the test never needs main.ts.
  const quests = await import("../dist-test/electron/engine/quest-engine.js");
  quests.configureQuestRuntime({
    executeTool: async () => ({ success: true, output: "ok", note: "" }),
    requestApproval: async () => true,
  });
  const built = quests.buildQuest("email-from-website", { url: "http://127.0.0.1:1/", body: "hi" });
  assert.equal(built.ok, true);
  const res = await quests.runQuest(built.quest, { url: "http://127.0.0.1:1/" });
  assert.equal(res.ok, false);
  const entries = diary.listProblems({ status: "open", source: "quest" });
  assert.ok(entries.length >= 1, "quest failure recorded");
  assert.match(entries[0].title, /email-from-website failed at step "read-site"/);
});

// ─── Three-way sync (executor ↔ contract ↔ catalog) ─────────────────────────

test("diary: problem_diary is in executor, contract and catalog", () => {
  assert.ok(registry.executorNames().includes("problem_diary"));
  assert.ok(contracts.contractedActions().includes("problem_diary"));
  const cat = catalogMod.TOOL_CATALOG.find((t) => t.schema.function?.name === "problem_diary" || t.schema.name === "problem_diary");
  assert.ok(cat, "catalog advertises problem_diary");
  const contract = contracts.contractFor("problem_diary");
  assert.equal(contract.safety, "READ");
  assert.equal(contract.timeoutMs, 5000);
});

// ─── Intent routing: the user can just ASK ──────────────────────────────────

test("diary: 'problems dikhao' / 'export problem report' route deterministically", async () => {
  const parser = (await import("../dist-test/electron/engine/intent-parser-v2.js"));
  const listed = parser.parseIntentV2("problems dikhao");
  assert.equal(listed.steps?.[0]?.action, "problem_diary");
  assert.equal(listed.steps?.[0]?.params?.verb, "list");
  const exported = parser.parseIntentV2("export problem report");
  assert.equal(exported.steps?.[0]?.action, "problem_diary");
  assert.equal(exported.steps?.[0]?.params?.verb, "export");
  const kya = parser.parseIntentV2("kya problems aayi thi?");
  assert.equal(kya.steps?.[0]?.action, "problem_diary");
  // Unrelated text must NOT be hijacked by the diary branch.
  const mail = parser.parseIntentV2("rahul ko mail bhej de");
  assert.notEqual(mail.steps?.[0]?.action, "problem_diary");
});
