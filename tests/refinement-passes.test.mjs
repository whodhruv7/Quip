// Tests: refinement passes — spontaneous-command fix, correct targets,
// new device capabilities, YouTube result understanding, retry safety,
// approval timeout. Each test maps to a diagnosed root cause.
import test from "node:test";
import assert from "node:assert/strict";
import { parseIntentV2 } from "../dist-test/electron/engine/intent-parser-v2.js";
import { permissionSystem } from "../dist-test/electron/engine/permission-modes.js";
import {
  extractYouTubeResults,
  scoreYouTubeResult,
  pickBestYouTubeResult,
} from "../dist-test/electron/engine/browser-automation.js";
import { orchestrator, RETRYABLE_ACTIONS } from "../dist-test/electron/engine/orchestrator.js";

// ─── A. No spontaneous commands (the "display → play" chaos) ────────────────

test("display/replay/player words never trigger playback", () => {
  for (const msg of [
    "display settings",
    "what does this display",
    "screenplay ideas",
    "who is the best player in the match",
    "the replay of the match was great",
  ]) {
    const r = parseIntentV2(msg);
    assert.notEqual(r.action, "play", `"${msg}" must not route to play`);
    assert.notEqual(r.steps[0]?.action, "play_media", `"${msg}" must not play media`);
  }
});

test("real play requests still work after the word-boundary fix", () => {
  const r = parseIntentV2("play mitwa");
  assert.equal(r.action, "play");
  assert.equal(r.steps[0].action, "play_media");
  assert.equal(r.steps[0].params.query, "mitwa");
});

test("mid-sentence play/listen stays conversation, never auto-executes", () => {
  for (const msg of ["the play was amazing", "I listen to music while working"]) {
    const r = parseIntentV2(msg);
    assert.equal(r.isTask, false, `"${msg}" must stay chat`);
  }
  const go = parseIntentV2("go and play the song mitwa");
  assert.equal(go.steps[0].action, "play_media"); // leading "go and" still works
  const lets = parseIntentV2("let's play mitwa");
  assert.equal(lets.steps[0].action, "play_media");
});

test("song names containing filler survive (anchored filler strip)", () => {
  const r = parseIntentV2("play i want it that way");
  assert.equal(r.steps[0].params.query, "i want it that way");
});

// ─── B. Correct targets (close/focus verbs + show) ──────────────────────────

test("quit/close route with the REAL app target, not a sliced fragment", () => {
  const r = parseIntentV2("quit chrome");
  assert.equal(r.action, "close_app");
  assert.equal(r.steps[0].params.target, "Google Chrome");
});

test("show me the file X reads the file — it is NOT a window focus", () => {
  const r = parseIntentV2("show me the file notes.txt");
  assert.equal(r.action, "file_op");
  assert.equal(r.steps[0].params.op, "read");
  assert.equal(r.steps[0].params.path, "notes.txt");
});

test("show chrome focuses the app, show me the weather stays chat", () => {
  const focus = parseIntentV2("show chrome");
  assert.equal(focus.action, "focus_app");
  assert.equal(focus.steps[0].params.target, "Google Chrome");

  const chat = parseIntentV2("show me the weather");
  assert.notEqual(chat.action, "focus_app");
});

// ─── C. Device capabilities: drag, mouse move, clipboard content ────────────

test("drag from x,y to x,y routes to a real drag step", () => {
  const r = parseIntentV2("drag from 100,200 to 300,400");
  assert.equal(r.action, "drag");
  assert.equal(r.steps[0].action, "drag");
  assert.equal(r.steps[0].params.fromX, "100");
  assert.equal(r.steps[0].params.fromY, "200");
  assert.equal(r.steps[0].params.toX, "300");
  assert.equal(r.steps[0].params.toY, "400");
});

test("move mouse to x,y routes to mouse_move", () => {
  const r = parseIntentV2("move mouse to 500,300");
  assert.equal(r.action, "mouse_move");
  assert.equal(r.steps[0].params.x, "500");
  assert.equal(r.steps[0].params.y, "300");
});

test("copy <text> to clipboard writes that text", () => {
  const r = parseIntentV2("copy hello world to clipboard");
  assert.equal(r.action, "clipboard");
  assert.equal(r.steps[0].params.mode, "write");
  assert.equal(r.steps[0].params.text, "hello world");
});

test("copy this to clipboard copies the SELECTION (ctrl+c), never empty text", () => {
  const r = parseIntentV2("copy this to clipboard");
  assert.equal(r.steps[0].action, "press_key");
  assert.equal(r.steps[0].target, "ctrl+c");
});

// ─── D. Local-first search (no local file leaks to Google) ──────────────────

test("search for my invoice → local file search, not Google", () => {
  const r = parseIntentV2("search for my invoice");
  assert.equal(r.action, "file_op");
  assert.equal(r.steps[0].params.op, "search");
});

test("open my docs folder → folder, not Google Docs site", () => {
  const r = parseIntentV2("open my docs folder");
  assert.equal(r.steps[0].action, "open_folder");
});

// ─── E. Chains with scroll/click clauses ─────────────────────────────────────

test("click here and then scroll down executes as a verified 2-step chain", () => {
  const r = parseIntentV2("click here and then scroll down");
  assert.equal(r.isMultiStep, true);
  assert.equal(r.steps.length, 2);
  assert.equal(r.steps[0].action, "click");
  assert.equal(r.steps[1].action, "scroll");
  assert.equal(r.steps[1].params.deltaY, "-360");
});

// ─── F. YouTube result UNDERSTANDING ─────────────────────────────────────────

const SAMPLE_HTML = `
<html><script>var ytInitialData = {
 "contents":[{"videoRenderer":{"videoId":"aaaaaaaaaaa","title":{"runs":[{"text":"Mitwa Official Video Song"}]}}},
 {"lockupViewModel":{"contentId":"bbbbbbbbbbb"}},
 {"videoRenderer":{"videoId":"ccccccccccc","title":{"runs":[{"text":"Mitwa Lofi Cover slowed"}]}}},
 {"videoRenderer":{"videoId":"aaaaaaaaaaa","title":{"runs":[{"text":"Mitwa Official Video Song"}]}}}]
};</script></html>`;

test("extractYouTubeResults reads organic videoRenderer entries with titles", () => {
  const results = extractYouTubeResults(SAMPLE_HTML);
  assert.equal(results.length, 2); // lockupViewModel + duplicate skipped
  assert.equal(results[0].videoId, "aaaaaaaaaaa");
  assert.equal(results[0].title, "Mitwa Official Video Song");
  assert.equal(results[1].title, "Mitwa Lofi Cover slowed");
});

test("scoring prefers the real song over covers and full-album dumps", () => {
  const exact = scoreYouTubeResult("Mitwa", "mitwa");
  const official = scoreYouTubeResult("Mitwa Official Video Song", "mitwa");
  const cover = scoreYouTubeResult("Mitwa Lofi Cover slowed", "mitwa");
  const album = scoreYouTubeResult("Mitwa Full Album Jukebox", "mitwa");
  assert.ok(exact > official, "exact title outranks decorated title");
  assert.ok(official > cover, "official video outranks a lofi cover");
  assert.ok(cover > album || cover === album, "full-album dump never outranks a cover");
});

test("pickBestYouTubeResult picks the actual requested song", () => {
  const pick = pickBestYouTubeResult(
    [
      { videoId: "ccccccccccc", title: "Mitwa Lofi Cover slowed" },
      { videoId: "aaaaaaaaaaa", title: "Mitwa Official Video Song" },
      { videoId: "ddddddddddd", title: "Top 10 Bollywood Songs Mix" },
    ],
    "mitwa"
  );
  assert.ok(pick);
  assert.equal(pick.best.videoId, "aaaaaaaaaaa");
  assert.equal(pick.confident, true);
});

test("pickBestYouTubeResult refuses to trust a random result", () => {
  const pick = pickBestYouTubeResult(
    [{ videoId: "eeeeeeeeeee", title: "Completely Unrelated Video About Cheese" }],
    "mitwa"
  );
  assert.ok(pick);
  assert.equal(pick.confident, false);
});

// ─── G. Retry safety (no double-typing / double-clicking) ────────────────────

test("retries are limited to idempotent actions", () => {
  for (const safe of ["open_app", "open_website", "open_url", "open_folder", "open_file", "search_web", "search_youtube", "site_search", "read_page", "screen", "windows_list"]) {
    assert.ok(RETRYABLE_ACTIONS.has(safe), `${safe} may retry`);
  }
  for (const risky of ["type_text", "press_key", "click", "drag", "mouse_move", "clipboard", "close_app", "focus_app", "play_media"]) {
    assert.ok(!RETRYABLE_ACTIONS.has(risky), `${risky} must NEVER retry`);
  }
});

// ─── H. Model-assist validation (no corner clicks / empty opens) ─────────────

test("model assist click is a cursor-position click, never (0,0)", () => {
  const intent = orchestrator.buildIntentFromAssist(
    "click that thing",
    "click that thing",
    { action: "click", target: "", query: "", url: "" }
  );
  assert.equal(intent.steps[0].action, "click");
  assert.equal(intent.steps[0].params.x, undefined);
  assert.equal(intent.steps[0].params.y, undefined);
});

test("model assist with no actionable target falls back to the deterministic parse", () => {
  const intent = orchestrator.buildIntentFromAssist(
    "something vague",
    "something vague",
    { action: "open", target: "", query: "", url: "" }
  );
  assert.equal(intent.isTask, false); // deterministic chat result, not a fake open
});

// ─── I. Approval requests never hang forever ─────────────────────────────────

test("approval auto-declines after the timeout instead of hanging", async () => {
  const result = await permissionSystem.requestApproval(
    "Test gated action",
    ["Do the thing"],
    "medium",
    50
  );
  assert.equal(result.approved, false);
});
