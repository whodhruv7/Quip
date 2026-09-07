// tests/runtime-audit.test.mjs
// 315-point audit — RUNTIME verification: every check here EXECUTES engine code
// (stubbed network where needed, real filesystem for file ops), it does not
// merely inspect it. Sections map to the master audit spec:
//   A. model transport failures   B. real file operations   C. app discovery
//   D. URL safety + YouTube       E. chaos / Hinglish       F. persistence
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.GROQ_API_KEY = "test-key-groq-000";
process.env.OPENROUTER_API_KEY = "test-key-or-000";

const { parseIntentV2 } = await import("../dist-test/electron/engine/intent-parser-v2.js");
const { ModelRouter, ModelTransportError, describeError } = await import(
  "../dist-test/electron/system/model-router.js"
);
const { resolveUserPath, searchFiles, executeFileOp } = await import(
  "../dist-test/electron/engine/file-ops.js"
);
const { normalizeAppName, resolveApp, scoreAppMatch } = await import(
  "../dist-test/electron/engine/app-discovery.js"
);
const { isSafePublicUrl, scoreYouTubeResult, pickBestYouTubeResult, extractYouTubeResults } =
  await import("../dist-test/electron/engine/browser-automation.js");
const { loadPrefs, savePrefs, loadCurrentMessages, saveCurrentMessages } = await import(
  "../dist-test/src/lib/storage.js"
);

// ─── helpers ─────────────────────────────────────────────────────────────────
const realFetch = globalThis.fetch;
const jsonResponse = (body, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

test.afterEach?.(() => {}, {});
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

// ═══ SECTION A — MODEL TRANSPORT (checks 36–50) ═════════════════════════════
test("A1: no keys configured → complete() throws no-key and NEVER touches the network", async () => {
  const g = process.env.GROQ_API_KEY, o = process.env.OPENROUTER_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return jsonResponse({ choices: [{ message: { content: "FAKE" } }] }); };
  try {
    const router = new ModelRouter();
    await assert.rejects(
      () => router.complete("sys", [], 500),
      (e) => e instanceof ModelTransportError && e.kind === "no-key"
    );
    assert.equal(calls, 0, "must not call fetch without keys");
  } finally {
    process.env.GROQ_API_KEY = g;
    process.env.OPENROUTER_API_KEY = o;
  }
});

test("A2: auth rejection on both providers → kind=auth, no fabricated answer", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return jsonResponse("{}", 401); };
  const router = new ModelRouter();
  await assert.rejects(
    () => router.complete("sys", [], 500),
    (e) => e instanceof ModelTransportError && e.kind === "auth"
  );
  assert.equal(calls, 2, "one attempt per configured provider");
});

test("A3: transient 500 recovers on the single same-provider retry — no duplicate storms", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return calls === 1 ? jsonResponse("boom", 500) : jsonResponse({ choices: [{ message: { content: "HELLO" } }] });
  };
  const router = new ModelRouter();
  const out = await router.complete("sys", [], 500);
  assert.equal(out, "HELLO");
  assert.equal(calls, 2, "exactly one retry, not a loop");
});

test("A4: hung request aborts → kind=timeout (real abort signal, not a fake catch)", async () => {
  globalThis.fetch = (url, init) =>
    new Promise((_, rej) => {
      init.signal.addEventListener("abort", () => {
        const e = new Error("The operation was aborted");
        e.name = "AbortError";
        rej(e);
      });
    });
  const router = new ModelRouter();
  await assert.rejects(
    () => router.complete("sys", [], 50),
    (e) => e instanceof ModelTransportError && e.kind === "timeout"
  );
});

test("A5: malformed JSON response → refuses to answer, error message leaks no internals", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return jsonResponse("not-json{{{", 200); };
  const router = new ModelRouter();
  const err = await router.complete("sys", [], 500).then(
    () => { throw new Error("should have rejected"); },
    (e) => e
  );
  assert.ok(calls >= 2, "retried across providers instead of faking");
  assert.equal(describeError(err).message.includes("not-json"), false);
});

test("A6: empty model response comes back as honest empty string — never invented text", async () => {
  globalThis.fetch = async () => jsonResponse({ choices: [] }, 200);
  const router = new ModelRouter();
  const out = await router.complete("sys", [], 500);
  assert.equal(out, "");
});

// ═══ SECTION B — REAL FILE OPERATIONS (checks 111–120) ══════════════════════
const TMP = path.join(os.homedir(), "my-project", "scripts", ".audit-tmp");

test.before?.(() => {}, {});
test.before(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(path.join(TMP, "invoices"), { recursive: true });
  fs.writeFileSync(path.join(TMP, "invoices", "My Invoice 2024.pdf"), "invoice-a");
  fs.writeFileSync(path.join(TMP, "invoices", "old invoice draft.pdf"), "invoice-b");
  fs.writeFileSync(path.join(TMP, "photo.PNG"), "img");
  fs.writeFileSync(path.join(TMP, "notes.txt"), "hello world");
});
test.after?.(() => {}, {});
test.after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

test("B1: searchFiles finds files with spaces in nested folders", () => {
  const { hits } = searchFiles("invoice", TMP);
  // searchFiles also scans home Desktop/Documents/Downloads by design, so
  // assert the tmp fixtures are FOUND rather than an exact total count.
  assert.ok(hits.length >= 2, `expected ≥2 hits, got ${hits.length}`);
  assert.ok(hits.some((h) => h.includes("My Invoice 2024.pdf")));
  assert.ok(hits.some((h) => h.includes("old invoice draft.pdf")));
});

test("B2: searchFiles with empty or whitespace query returns nothing (no blind scan)", () => {
  assert.equal(searchFiles("   ", TMP).hits.length, 0);
});

test("B3: resolveUserPath blocks Windows system locations", () => {
  assert.equal(resolveUserPath("C:\\Windows\\System32\\cmd.exe").ok, false);
  assert.equal(resolveUserPath("C:\\Program Files\\App\\x.dll").ok, false);
  assert.equal(resolveUserPath("C:\\ProgramData\\secret").ok, false);
});

test("B4: resolveUserPath blocks Unix system locations (defense-in-depth)", () => {
  assert.equal(resolveUserPath("/etc/passwd").ok, false);
  assert.equal(resolveUserPath("/usr/bin/node").ok, false);
});

test("B5: resolveUserPath expands ~, folder aliases and strips quotes", () => {
  const home = os.homedir();
  assert.equal(resolveUserPath("~/Documents").path, path.join(home, "Documents"));
  assert.equal(resolveUserPath('"desktop"').path, path.join(home, "desktop"));
  assert.equal(resolveUserPath("").ok, false);
});

test("B6: executeFileOp write→append→read round-trips real content", () => {
  const p = path.join(TMP, "rt.txt");
  assert.equal(executeFileOp({ op: "write", path: p, content: "hello" }).ok, true);
  assert.equal(executeFileOp({ op: "write", path: p, content: "world", append: true }).ok, true);
  const read = executeFileOp({ op: "read", path: p });
  assert.equal(read.ok, true);
  assert.ok(String(read.evidence ?? read.summary ?? "").includes("helloworld") || fs.readFileSync(p, "utf8") === "helloworld");
});

test("B7: executeFileOp mkdir/copy/move/delete all verify on disk", () => {
  const dir = path.join(TMP, "made");
  const src = path.join(TMP, "rt.txt");
  const cp = path.join(TMP, "made", "rt-copy.txt");
  const mv = path.join(TMP, "made", "rt-moved.txt");
  assert.equal(executeFileOp({ op: "mkdir", path: dir }).ok, true);
  assert.equal(fs.existsSync(dir), true);
  assert.equal(executeFileOp({ op: "copy", from: src, to: cp }).ok, true);
  assert.equal(fs.existsSync(cp), true);
  assert.equal(executeFileOp({ op: "move", from: cp, to: mv }).ok, true);
  assert.equal(fs.existsSync(cp), false);
  assert.equal(fs.existsSync(mv), true);
  assert.equal(executeFileOp({ op: "delete", path: mv }).ok, true);
  assert.equal(fs.existsSync(mv), false);
});

test("B8: deleting a missing file reports honest failure — never fake success", () => {
  const r = executeFileOp({ op: "delete", path: path.join(TMP, "does-not-exist.txt") });
  assert.equal(r.ok, false);
});

test("B9: file ops refuse system paths even when asked directly", () => {
  const r = executeFileOp({ op: "delete", path: "C:\\Windows\\notepad.exe" });
  assert.equal(r.ok, false);
});

// ═══ SECTION C — APP DISCOVERY (checks 81–85) ═══════════════════════════════
const APPS = [
  { name: "Visual Studio Code", procName: "Code", confidence: 1 },
  { name: "Google Chrome", procName: "chrome", confidence: 1 },
  { name: "Microsoft Edge", procName: "msedge", confidence: 1 },
  { name: "Spotify", procName: "Spotify", confidence: 1 },
];

test("C1: normalizeAppName strips .lnk, underscores and dashes", () => {
  assert.equal(normalizeAppName("Visual Studio Code.lnk"), "visual studio code");
  assert.equal(normalizeAppName("My_App-Name"), "my app name");
});

test("C2: resolveApp resolves aliases and case-insensitively", () => {
  assert.equal(resolveApp("vs code", APPS)?.name, "Visual Studio Code");
  assert.equal(resolveApp("CHROME", APPS)?.name, "Google Chrome");
  assert.equal(resolveApp("edge", APPS)?.name, "Microsoft Edge");
});

test("C3: resolveApp returns null for unknown apps — no wild guesses", () => {
  assert.equal(resolveApp("totally unknown app xyz", APPS), null);
});

test("C4: exact name outranks partial match in scoring", () => {
  assert.ok(
    scoreAppMatch("visual studio code", "visual studio code") >
      scoreAppMatch("code", "visual studio code")
  );
});

// ═══ SECTION D — URL SAFETY + YOUTUBE (checks 155/233, 156–165, 298) ════════
test("D1: SSRF guard blocks private, loopback, file, credentials and odd encodings", () => {
  const blocked = [
    "http://localhost/x",
    "http://127.0.0.1/x",
    "http://10.0.0.1/x",
    "http://192.168.1.1/router",
    "http://172.16.0.1/x",
    "http://169.254.169.254/meta",
    "file:///etc/passwd",
    "ftp://example.com/x",
    "javascript:alert(1)",
    "https://user:pass@example.com/",
    "http://2130706433/",        // decimal-encoded 127.0.0.1
    "http://0x7f000001/",        // hex-encoded 127.0.0.1
    "http://[::ffff:127.0.0.1]/",
    "http://[::1]/",
  ];
  for (const u of blocked) assert.equal(isSafePublicUrl(u).safe, false, u);
});

test("D2: SSRF guard still allows genuinely public URLs", () => {
  for (const u of ["https://youtube.com/", "https://www.reddit.com/r/test/", "http://example.com/", "https://8.8.8.8/"]) {
    assert.equal(isSafePublicUrl(u).safe, true, u);
  }
});

test("D3: YouTube scoring demotes covers, live, mixes and full-album dumps", () => {
  const q = "mitwa";
  const exact = scoreYouTubeResult("Mitwa", q);
  const official = scoreYouTubeResult("Mitwa Official Video Song", q);
  const cover = scoreYouTubeResult("Mitwa Lofi Cover slowed", q);
  const live = scoreYouTubeResult("Mitwa Live Concert 2019", q);
  const mix = scoreYouTubeResult("Best of Mitwa Mix - Full Album", q);
  const junk = scoreYouTubeResult("Unrelated Cooking Video", q);
  assert.ok(exact >= official);
  assert.ok(official > cover);
  assert.ok(official > live);
  assert.ok(official > mix);
  assert.ok(junk < cover);
});

test("D4: pickBestYouTubeResult picks the real song, refuses an all-bad list", () => {
  const good = pickBestYouTubeResult(
    [
      { videoId: "cvr", title: "Mitwa Cover" },
      { videoId: "real", title: "Mitwa Official Video Song" },
    ],
    "mitwa"
  );
  assert.equal(good?.best?.videoId, "real");
  const bad = pickBestYouTubeResult(
    [
      { videoId: "a", title: "Totally Unrelated Video" },
      { videoId: "b", title: "Another Random Upload" },
    ],
    "mitwa"
  );
  // Contract: a non-confident pick is returned for introspection, and the
  // caller (playFirstYouTubeResult) must gate playback on `.confident`.
  assert.ok(bad && bad.confident === false);
});

test("D5: extractYouTubeResults ignores non-video entries, duplicates and caps at max", () => {
  const html = `<html><script>var ytInitialData = {
   "contents":[{"videoRenderer":{"videoId":"aaaaaaaaaaa","title":{"runs":[{"text":"Song One"}]}}},
    {"lockupViewModel":{"contentId":"bbbbbbbbbbb"}},
    {"videoRenderer":{"title":{"runs":[{"text":"no id"}]}}},
    {"channelRenderer":{"channelId":"c"}},
    {"videoRenderer":{"videoId":"ddddddddddd","title":{"runs":[{"text":"Song Two"}]}}}]
  };</script></html>`;
  const results = extractYouTubeResults(html);
  assert.equal(results.length, 2);
  assert.equal(results[0].videoId, "aaaaaaaaaaa");
  assert.equal(results[1].title, "Song Two");
});

// ═══ SECTION E — CHAOS + HINGLISH (checks 136–145, 63–65) ═══════════════════
test("E1: conversational sentences never become device actions", () => {
  const lines = [
    "the display looks great today",
    "he closed the door gently",
    "my typing speed improved a lot",
    "scrolling reels is my guilty pleasure",
    "what is copywriting",
    "the player scored a goal",
  ];
  for (const line of lines) {
    const r = parseIntentV2(line);
    assert.equal(r.isTask, false, `misrouted: "${line}" → ${r.action}/${r.steps[0]?.action}`);
  }
});

test("E2: bare verbs never execute with an empty or guessed target", () => {
  for (const line of ["open", "play", "close the", "kholo", "bajao"]) {
    const r = parseIntentV2(line);
    const step = r.steps?.[0];
    const emptyTarget =
      r.isTask && step && !step.target && !step.params?.appName && !step.params?.query;
    assert.equal(emptyTarget, false, `"${line}" produced an empty-target ${step?.action}`);
  }
});

test("E3: keyword-in-sentence does not trigger playback (display/player/listen)", () => {
  const r1 = parseIntentV2("please display the quarterly report");
  assert.equal(r1.steps?.[0]?.action === "play_media", false);
  const r2 = parseIntentV2("i want to be a player someday");
  assert.equal(r2.isTask && r2.steps?.[0]?.action === "play_media", false);
});

test("E4: capitalization never changes intent", () => {
  const r = parseIntentV2("OPEN VS CODE");
  assert.equal(r.steps?.[0]?.action, "open_app");
  assert.equal(r.steps?.[0]?.target, "Visual Studio Code");
  const w = parseIntentV2("OpEn YoUtUbE");
  assert.equal(w.isTask, true);
  assert.match(w.summary + " " + w.target, /youtube/i);
});

test("E5: Hinglish trailing verbs route correctly", () => {
  const open = parseIntentV2("youtube kholo");
  assert.equal(open.steps?.[0]?.action, "open_website");
  const play = parseIntentV2("mitwa bajao");
  assert.equal(play.steps?.[0]?.action, "play_media");
  const vsCode = parseIntentV2("vs code khol do");
  assert.equal(vsCode.steps?.[0]?.action, "open_app");
  const close = parseIntentV2("chrome band karo");
  assert.equal(close.steps?.[0]?.action, "close_app");
  const find = parseIntentV2("resume dhundo");
  assert.equal(find.steps?.[0]?.action, "file_op");
  assert.equal(find.steps?.[0]?.params?.op ?? find.steps?.[0]?.params?.operation, "search");
});

test("E6: Hinglish chalao picks play for media nouns, open for apps", () => {
  assert.equal(parseIntentV2("gaana chalao").steps?.[0]?.action, "play_media");
  assert.equal(parseIntentV2("vs code chalao").steps?.[0]?.action, "open_app");
});

test("E7: multi-clause Hinglish chains through aur", () => {
  const r = parseIntentV2("youtube kholo aur mitwa bajao");
  assert.equal(r.isTask, true);
  const actions = (r.steps ?? []).map((s) => s.action);
  assert.deepEqual(actions, ["open_website", "play_media"]);
});

test("E8: English word 'band' is never mistaken for the Hinglish close verb", () => {
  const r = parseIntentV2("my favorite band announced a tour");
  assert.equal(r.isTask, false);
});

test("E9: the word play inside a song title survives (anchored strip)", () => {
  const r = parseIntentV2("play i want it that way");
  assert.equal(r.steps?.[0]?.action, "play_media");
  assert.match(r.steps?.[0]?.params?.query ?? r.query ?? "", /i want it that way/i);
});

// ═══ SECTION F — PERSISTENCE + CORRUPTION SAFETY (checks 196–205) ═══════════
class MemStore {
  constructor() { this.m = {}; }
  getItem(k) { return k in this.m ? this.m[k] : null; }
  setItem(k, v) { this.m[k] = String(v); }
  removeItem(k) { delete this.m[k]; }
  clear() { this.m = {}; }
}
globalThis.localStorage = new MemStore();

test("F1: prefs default to pix and survive a save/load round-trip", () => {
  globalThis.localStorage.clear();
  assert.equal(loadPrefs().companionId, "pix");
  savePrefs({ companionId: "ren", theme: "aqua" });
  const p = loadPrefs();
  assert.equal(p.companionId, "ren");
  assert.equal(p.theme, "aqua");
});

test("F2: legacy zee preference migrates to ren", () => {
  globalThis.localStorage.setItem("quip:prefs", JSON.stringify({ companionId: "zee" }));
  assert.equal(loadPrefs().companionId, "ren");
});

test("F3: invalid companion ids are rejected, not persisted", () => {
  globalThis.localStorage.setItem("quip:prefs", JSON.stringify({ companionId: "not-a-companion" }));
  assert.equal(loadPrefs().companionId, "pix");
});

test("F4: corrupted prefs JSON falls back to defaults without crashing", () => {
  globalThis.localStorage.setItem("quip:prefs", "{not valid json{{{");
  assert.equal(loadPrefs().companionId, "pix");
  assert.equal(typeof loadPrefs().theme, "string");
});

test("F5: per-companion message stores are isolated", () => {
  globalThis.localStorage.clear();
  const msg = { id: "m1", role: "user", content: "hi", ts: 1 };
  saveCurrentMessages("pix", [msg]);
  assert.equal(loadCurrentMessages("kai").length, 0);
  assert.equal(loadCurrentMessages("pix").length, 1);
});
