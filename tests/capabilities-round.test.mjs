// Tests: capabilities-merge round — ported onto the parallel Ghost-Cursor line.
// Covers: fix suggestions (diary "Fix:" lines + retry prompts), fuzzy/OneDrive
// file discovery scoring, Hinglish + reply-by-name follow-up answers, app
// near-miss "did you mean", open_app scan honesty, panel window clamps, and
// the UX self-audit wiring. FS fixtures live under $HOME/projects, cleaned up.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const requireCjs = createRequire(import.meta.url);
const fileDiscovery = await import("../dist-test/electron/engine/file-discovery.js");
const fixSuggestions = await import("../dist-test/electron/engine/fix-suggestions.js");
const parser = await import("../dist-test/electron/engine/intent-parser-v2.js");
const registry = await import("../dist-test/electron/engine/tool-registry.js");
const registryNs = requireCjs("../dist-test/electron/engine/tool-registry.js");
const appDiscoveryNs = requireCjs("../dist-test/electron/engine/app-discovery.js");

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Patch a CJS-exported function on a compiled module namespace (call-time
 *  lookup keeps the patch visible to importers). */
function patchNs(ns, name, impl) {
  const orig = ns[name];
  ns[name] = impl;
  return () => {
    ns[name] = orig;
  };
}

const CTX = { platform: "win32" };
const APP = (name, over = {}) => ({
  name,
  executable: `C:\\Program Files\\${name}\\${name.replace(/\s+/g, "")}.exe`,
  confidence: 1,
  ...over,
});

/** Fresh tool-registry instance: getAppIndex caches its index promise at
 *  module level, so every injected-index test needs a clean module. */
function freshRegistry() {
  delete requireCjs.cache[requireCjs.resolve("../dist-test/electron/engine/tool-registry.js")];
  delete requireCjs.cache[requireCjs.resolve("../dist-test/electron/engine/app-discovery.js")];
  const ad = requireCjs("../dist-test/electron/engine/app-discovery.js");
  const reg = requireCjs("../dist-test/electron/engine/tool-registry.js");
  return { ad, reg };
}

// ═══ fix suggestions ═════════════════════════════════════════════════════════

test("fix-suggestions: failure classes map to concrete fixes", () => {
  const s = fixSuggestions.suggestFor([
    "I couldn't find an installed app called 'zzz'.",
    "the app list failed to load (powershell exit 1)",
    "The file moved or was deleted — path missing",
    "action timed out after 35s",
    "no API key configured (no-key)",
    "user declined the approval",
    "Windows has no default app (open-file-failed)",
  ]);
  assert.ok(s.length >= 6, `expected many suggestions, got ${s.length}`);
  assert.ok(s.some((x) => /rescan apps/i.test(x)));
  assert.ok(s.some((x) => /Recycle Bin/i.test(x)));
  assert.ok(s.some((x) => /AI key/i.test(x)));
  assert.ok(s.some((x) => /Approve the action card/i.test(x)));
  assert.equal(new Set(s).size, s.length, "suggestions are deduped");
});

test("fix-suggestions: retry prompts are ready-to-send", () => {
  const file = fixSuggestions.suggestedRetryPrompt("open my resume", [
    "I couldn't find a file called 'resume'.",
  ]);
  assert.ok(file && /open <file name> in <folder>/.test(file), `got ${file}`);
  const perm = fixSuggestions.suggestedRetryPrompt("clean my desktop", ["user declined the approval"]);
  assert.ok(perm && /Allow|auto-approve/.test(perm));
  const none = fixSuggestions.suggestedRetryPrompt("something", ["totally unmapped failure"]);
  assert.equal(none, null, "no invented advice for unmapped failures");
});

// ═══ file discovery scoring ══════════════════════════════════════════════════

test("scoreEntryName ranks exact > prefix > substring > token > fuzzy > 0", () => {
  const s = fileDiscovery.scoreEntryName;
  assert.equal(s("resume.pdf", "resume.pdf"), 92, "exact full name");
  assert.equal(s("resume", "resume.pdf"), 90, "exact base name (extension-insensitive)");
  assert.equal(s("resume", "resume"), 92, "name === query is the top score");
  assert.ok(s("resume", "resume_final.docx") >= 80, "prefix");
  assert.ok(s("resu", "resume.pdf") >= 68, "substring (>=3 chars)");
  assert.ok(s("my resume file", "my-resume-file.pdf") >= 62, "token coverage");
  assert.ok(s("resum", "resume.pdf") >= 50, "fuzzy typo");
  assert.equal(s("zzz", "resume.pdf"), 0, "no match");
});

test("resolveLocalCandidates: exact hit found via the project roots", async () => {
  const dir = path.join(os.homedir(), "projects", "quip-file-fixture");
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(path.join(dir, "resume.pdf"), "x");
    const out = await fileDiscovery.resolveLocalCandidates("resume");
    assert.equal(out[0]?.path, path.join(dir, "resume.pdf"));
    // base-name exact (90) minus depth penalty (fixture is 1 level deep)
    assert.ok(out[0]?.score >= 88, `top score ${out[0]?.score}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveLocalCandidates: two plausible hits rank best-first (follow-up data)", async () => {
  const dir = path.join(os.homedir(), "projects", "quip-file-fixture-2");
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(path.join(dir, "invoice_jan.pdf"), "x");
    fs.writeFileSync(path.join(dir, "invoice_feb.pdf"), "x");
    const out = await fileDiscovery.resolveLocalCandidates("invoice");
    assert.ok(out.length >= 2);
    assert.ok(out[0].score >= out[1].score, "ranked");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveLocalCandidates: honest empty result for a ghost query", async () => {
  const out = await fileDiscovery.resolveLocalCandidates("qqzzxxghostfile99");
  assert.equal(out.length, 0);
});

// ═══ follow-up replies (Hinglish + by-name + by-type) ═══════════════════════

test("parsePendingChoice understands Hinglish ordinals", () => {
  const p = parser.parsePendingChoice;
  assert.equal(p("dusra"), 2);
  assert.equal(p("dusra wala"), 2);
  assert.equal(p("pehla"), 1);
  assert.equal(p("teesri"), 3);
  assert.equal(p("the second one"), 2);
  assert.equal(p("3"), 3);
  assert.equal(p("last"), -1);
});

test("matchPendingFollowup: affirmative, cancel, again, open-with", () => {
  const m = parser.matchPendingFollowup;
  assert.deepEqual(m("open it"), { kind: "choice", choice: 1 });
  assert.deepEqual(m("haan"), { kind: "choice", choice: 1 });
  assert.deepEqual(m("no"), { kind: "cancel" });
  assert.deepEqual(m("nahi chahiye"), { kind: "cancel" });
  assert.deepEqual(m("search again"), { kind: "again" });
  const withApp = m("open it with vlc");
  assert.equal(withApp?.kind, "choice");
  assert.equal(withApp?.openWith, "vlc");
  const hin = m("vlc me kholo");
  assert.equal(hin?.kind, "choice");
  assert.equal(hin?.openWith, "vlc");
});

test("matchPendingFollowup: reply-by-name and by-file-type pick the listed candidate", () => {
  const labels = ["resume.pdf", "resume_final.docx", "Excel"];
  assert.deepEqual(parser.matchPendingFollowup("excel", labels), { kind: "choice", choice: 3 });
  assert.deepEqual(parser.matchPendingFollowup("the docx one please", labels), { kind: "choice", choice: 2 });
  assert.deepEqual(parser.matchPendingFollowup("resume pdf", labels), { kind: "choice", choice: 1 });
  // Unrelated short replies stay unrelated — no guessing.
  assert.equal(parser.matchPendingFollowup("what's the weather", labels), null);
});

// ═══ open_app honesty + near-miss (via patched app index) ═══════════════════

test("open_app: empty index with a broken scan reports the SCAN, not a lie", async () => {
  const { ad, reg } = freshRegistry();
  const undo = patchNs(ad, "buildInstalledAppIndex", async () => []);
  try {
    const r = await reg.executeTool("open_app", { action: "open_app", params: { query: "spotify" }, target: "spotify", description: "" }, CTX);
    const text = String(r.output ?? "");
    assert.ok(
      /couldn't check installed apps|couldn't find an installed app/.test(text),
      `got: ${text}`
    );
    assert.ok(!/opened a web search/i.test(String(r.note ?? "")), "no surprise browser window");
  } finally {
    undo();
  }
});

test("open_app: near-miss offers a did-you-mean list instead of failing", async () => {
  const { ad, reg } = freshRegistry();
  const undo = patchNs(ad, "buildInstalledAppIndex", async () => [
    APP("Visual Studio Code"),
    APP("Spotify"),
  ]);
  try {
    const r = await reg.executeTool(
      "open_app",
      { action: "open_app", params: { query: "visual studios" }, target: "visual studios", description: "" },
      CTX
    );
    assert.equal(r.success, true, "asking IS success — the loop continues");
    assert.match(String(r.output), /Did you mean one of these\?/);
    assert.match(String(r.output), /Visual Studio Code/);
  } finally {
    undo();
  }
});

test("open_app: confident match launches without asking", async () => {
  const { ad, reg } = freshRegistry();
  const undo = patchNs(ad, "buildInstalledAppIndex", async () => [APP("Visual Studio Code")]);
  try {
    const r = await reg.executeTool(
      "open_app",
      { action: "open_app", params: { query: "vis" }, target: "vis", description: "" },
      CTX
    );
    assert.notEqual(r.success, undefined);
    assert.ok(!/Did you mean/.test(String(r.output ?? "")), "0.85-confidence 'vis' resolves directly");
  } finally {
    undo();
  }
});

test("open_file: a lone weak fuzzy hit asks instead of guessing", async () => {
  const dir = path.join(os.homedir(), "projects", "quip-file-fixture-3");
  fs.mkdirSync(dir, { recursive: true });
  try {
    // "resme" is a typo; only a fuzzy hit (~50-65) will match — never decisive.
    fs.writeFileSync(path.join(dir, "resume.pdf"), "x");
    const r = await registryNs.executeTool(
      "open_file",
      { action: "open_file", params: { query: "resme" }, target: "resme", description: "" },
      CTX
    );
    const text = String(r.output ?? "");
    assert.ok(/match(es)? for "resme"|Open one\?/i.test(text), `got: ${text}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ═══ wiring contracts (source scanning) ══════════════════════════════════════

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

test("wiring: main has panel + minimum-size clamps and the UX-audit IPC", () => {
  const main = read("../electron/main.ts");
  assert.ok(main.includes("panelModeSize"), "panel size clamps to the work area");
  assert.match(main, /Math\.min\(760, a\.width\)/, "minimum size never exceeds the display");
  assert.ok(main.includes("ipcMain.on(IPC.LOG_UX_ISSUE"), "UX self-audit handler");
  assert.ok(main.includes('source: "watch"'), "UX issues land in the Problem Diary as watch entries");
});

test("wiring: task failures reach the Problem Diary with inline fixes", () => {
  const main = read("../electron/main.ts");
  assert.ok(main.includes("suggestFor(failureTexts)"), "fix suggestions computed from failures");
  assert.ok(main.includes('notes: [...(result.notes ?? []), ...fixNotes]'), "fixes ride along to the renderer");
  assert.ok(main.includes('kind: "task-failed"'), "failed tasks are diary entries");
});

test("wiring: 'what failed' and 'rescan apps' self-commands exist", () => {
  const main = read("../electron/main.ts");
  assert.match(main, /diary|failures|errors\?|problems\)\$\/\.test\(lowerCmd\)/, "diary self-command");
  assert.match(main, /rescan\\s\+\(my/, "rescan apps self-command");
  assert.ok(main.includes("invalidateAppIndex()"), "rescan invalidates the stale index first");
});

test("wiring: renderer UX self-audit + audited surfaces", () => {
  const app = read("../src/App.tsx");
  assert.ok(app.includes("logUxIssue"), "auditor reports issues");
  assert.ok(app.includes('data-ux="error-bar"'), "error bar is audited");
  assert.ok(app.includes("overflowWrap") && app.includes("minWidth: 0"), "error bar wraps long errors");
  const input = read("../src/components/ChatInput.tsx");
  assert.ok(input.includes('data-ux="composer"'), "composer is audited");
  const approval = read("../src/components/ActionApprovalPanel.tsx");
  assert.ok(approval.includes('data-ux="approval-card"'), "approval card is audited");
  const statusBar = read("../src/components/ErrorBar.tsx");
  assert.ok(statusBar.includes('data-ux="error-status"'), "status bar is audited");
  const shared = read("../electron/shared.ts");
  assert.ok(shared.includes("LOG_UX_ISSUE"));
  const preload = read("../electron/preload.ts");
  assert.ok(preload.includes("logUxIssue:"));
});

test("wiring: open_app no longer opens a surprise web search on failure", () => {
  const reg = read("../electron/engine/tool-registry.ts");
  assert.ok(!/opened a web search so you can double-check/.test(reg), "the old surprise-browser fallback is gone");
  assert.ok(reg.includes("getLastScanDiagnostic()"), "scan diagnostic surfaces");
  assert.ok(reg.includes('kind: "app"'), "app near-miss choices are launchable picks");
});

test("wiring: scan diagnostics exist in app-discovery", () => {
  const disc = read("../electron/engine/app-discovery.ts");
  assert.ok(disc.includes("getLastScanDiagnostic"));
  assert.ok(disc.includes("noteScanFailure"));
  assert.ok(disc.includes("lastScanDiagnostic = null;") || disc.includes("lastScanDiagnostic = null"), "diagnostic resets on a clean index");
});
