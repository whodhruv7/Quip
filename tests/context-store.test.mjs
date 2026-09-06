// Tests: short-term execution context
import test from "node:test";
import assert from "node:assert/strict";
import { contextStore } from "../dist-test/electron/engine/context-store.js";

test("update stores and get returns a copy", () => {
  contextStore.reset();
  contextStore.update({ lastMediaQuery: "Mitwa", activeWebsite: "youtube" });
  const s = contextStore.get();
  assert.equal(s.lastMediaQuery, "Mitwa");
  assert.equal(s.activeWebsite, "youtube");
  // mutation of the returned copy must not affect the store
  s.lastMediaQuery = "hacked";
  assert.equal(contextStore.get().lastMediaQuery, "Mitwa");
});

test("context expires after 30 minutes", () => {
  contextStore.reset();
  contextStore.update({ lastMediaQuery: "Mitwa" });
  // simulate 31 minutes later
  contextStore.clearExpired(Date.now() + 31 * 60 * 1000);
  assert.equal(contextStore.get().lastMediaQuery, undefined);
});

test("context survives within TTL", () => {
  contextStore.reset();
  contextStore.update({ activeApp: "Visual Studio Code" });
  contextStore.clearExpired(Date.now() + 5 * 60 * 1000);
  assert.equal(contextStore.get().activeApp, "Visual Studio Code");
});

test("summary is a single compact line", () => {
  contextStore.reset();
  contextStore.update({
    activeWebsite: "youtube",
    lastMediaQuery: "Mitwa",
    lastOpenedPath: "C:\\dev\\Quip",
  });
  const s = contextStore.summary();
  assert.ok(s.startsWith("Current context:"));
  assert.ok(s.includes("site=youtube"));
  assert.ok(s.includes('lastMedia="Mitwa"'));
  // compact: under 200 chars for any realistic state
  assert.ok(s.length < 200);
});

test("empty summary returns empty string", () => {
  contextStore.reset();
  assert.equal(contextStore.summary(), "");
});
