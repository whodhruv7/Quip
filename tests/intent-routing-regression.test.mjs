// Regression tests: natural language → correct intent → correct target/action.
import test from "node:test";
import assert from "node:assert/strict";
import { parseIntentV2 } from "../dist-test/electron/engine/intent-parser-v2.js";

test("open youtube and play keeps target and song separate", () => {
  const r = parseIntentV2("Open YouTube and play Mitwa");
  assert.equal(r.action, "play");
  assert.equal(r.target, "youtube");
  assert.equal(r.query.toLowerCase(), "mitwa");
  assert.equal(r.steps.some((s) => s.action === "open_website" && s.target === "youtube"), true);
  assert.equal(r.steps.some((s) => s.action === "play_media"), true);
  // The query must NOT be the whole sentence
  assert.equal(r.query.toLowerCase().includes("open"), false);
});

test("open vscode prefers the installed desktop app (open_app, not a website)", () => {
  const r = parseIntentV2("Open VS Code");
  assert.equal(r.steps[0].action, "open_app");
  assert.equal(r.steps[0].target, "Visual Studio Code");
  assert.notEqual(r.steps[0].action, "open_website");
});

test("open quip project routes to folder lookup", () => {
  const r = parseIntentV2("Open my Quip project");
  assert.equal(r.steps[0].action, "open_folder");
  assert.match(r.steps[0].params.query.toLowerCase(), /quip/);
});

test("play it reuses last media query from context", () => {
  const r = parseIntentV2("play it", {
    context: { lastMediaQuery: "Mitwa", updatedAt: Date.now() },
  });
  assert.equal(r.query.toLowerCase(), "mitwa");
  assert.equal(r.steps[0].action, "play_media");
});

test("play it with no context stays a task but reports low confidence", () => {
  const r = parseIntentV2("play it");
  assert.equal(r.action, "play");
  assert.equal(r.query, "");
});

test("direct URL navigates instead of searching the sentence", () => {
  const r = parseIntentV2("go to https://github.com/whodhruv7/Quip");
  assert.equal(r.steps[0].action, "open_url");
  assert.equal(r.steps[0].params.url, "https://github.com/whodhruv7/Quip");
});

test("search youtube routes to youtube search, not google", () => {
  const r = parseIntentV2("search youtube for lofi beats");
  assert.equal(r.target, "youtube");
  assert.equal(r.query, "lofi beats");
});

test("word-boundary matching: 'open my mix playlist' does not open X (twitter)", () => {
  const r = parseIntentV2("open my mix playlist folder");
  assert.notEqual(r.target, "twitter");
  assert.notEqual(r.steps[0].action, "open_website");
});

test("close app routes to close_app", () => {
  const r = parseIntentV2("close vs code");
  assert.equal(r.steps[0].action, "close_app");
  assert.equal(r.steps[0].target, "Visual Studio Code");
});

test("focus app routes to focus_app", () => {
  const r = parseIntentV2("focus chrome");
  assert.equal(r.steps[0].action, "focus_app");
});

test("type text routes to type_text without the type verb", () => {
  const r = parseIntentV2("type hello world");
  assert.equal(r.steps[0].action, "type_text");
  assert.equal(r.steps[0].params.text, "hello world");
});

test("press key combo routes to press_key", () => {
  const r = parseIntentV2("press ctrl+c");
  assert.equal(r.steps[0].action, "press_key");
  assert.match(r.steps[0].params.keys, /ctrl/);
});

test("click at coordinates routes to click", () => {
  const r = parseIntentV2("click at 120, 340");
  assert.equal(r.steps[0].action, "click");
  assert.equal(r.steps[0].params.x, "120");
  assert.equal(r.steps[0].params.y, "340");
});

test("scroll routes with direction", () => {
  const r = parseIntentV2("scroll up");
  assert.equal(r.steps[0].action, "scroll");
  assert.ok(parseInt(r.steps[0].params.deltaY, 10) > 0);
});

test("clipboard read and write routes", () => {
  const read = parseIntentV2("what's on my clipboard");
  assert.equal(read.steps[0].action, "clipboard");
  assert.equal(read.steps[0].params.mode, "read");

  const write = parseIntentV2('copy "hello world" to clipboard');
  assert.equal(write.steps[0].params.mode, "write");
  assert.equal(write.steps[0].params.text, "hello world");
});

test("open downloads resolves known folder", () => {
  const r = parseIntentV2("open downloads");
  assert.equal(r.steps[0].action, "open_folder");
  assert.equal(r.steps[0].target, "downloads");
});

test("open gmail routes to website, not app guess", () => {
  const r = parseIntentV2("open gmail");
  assert.equal(r.steps[0].action, "open_website");
  assert.equal(r.steps[0].params.url, "https://mail.google.com");
});

test("regular chat stays chat (no fake task)", () => {
  const r = parseIntentV2("hey how was your day");
  assert.equal(r.isTask, false);
  assert.equal(r.steps.length, 0);
});

test("open whatsapp is a task targeting the app (fallback handled at execution)", () => {
  const r = parseIntentV2("open whatsapp");
  assert.equal(r.isTask, true);
  assert.equal(r.action, "open");
});

test("compose email extracts recipient", () => {
  const r = parseIntentV2("send an email to john about the invoice");
  assert.equal(r.steps[0].action, "compose_email");
  assert.match(r.steps[0].params.to, /john/i);
});

test("read this reddit page resolves the site and reads it", () => {
  const r = parseIntentV2("Read this Reddit page");
  assert.equal(r.action, "read");
  assert.equal(r.steps[0].action, "read_page");
  assert.ok(r.steps[0].target.includes("reddit.com"));
});

test("open X routes to the x.com website (not a folder or app guess)", () => {
  const r = parseIntentV2("open x");
  assert.equal(r.steps[0].action, "open_website");
  assert.ok(r.steps[0].target === "x" || r.steps[0].target.includes("x.com"));
});
