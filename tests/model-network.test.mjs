// Tests: model config — secret masking + error mapping (no real network).
import test from "node:test";
import assert from "node:assert/strict";
import { maskSecret, describeError, defaultOpenRouterModel } from "../dist-test/electron/system/model-config.js";

test("model diagnostics never include full secrets", () => {
  const fake = "sk-or-v1-abcdefghijklmnopqrstuvwxyz";
  const masked = maskSecret(fake);
  assert.equal(masked.includes("abcdefghijklmnopqrstuvwxyz"), false);
  assert.ok(masked.startsWith("sk-o"));
  assert.ok(masked.includes("..."));
});

test("missing key reports 'missing', short key reports 'present'", () => {
  assert.equal(maskSecret(undefined), "missing");
  assert.equal(maskSecret(""), "missing");
  assert.equal(maskSecret("short"), "present");
});

test("OpenRouter default model is not a stale model name", () => {
  const configured = process.env.OPENROUTER_MODEL || defaultOpenRouterModel();
  assert.notEqual(configured, "openrouter/owl-alpha");
  assert.notEqual(configured, "google/gemma-3-27b-it:free");
  assert.equal(defaultOpenRouterModel(), "minimax/minimax-m3:free");
});

test("error kinds map to calm user messages with no raw internals", () => {
  const cases = [
    [{ kind: "no-key" }, /no AI key/i],
    [{ kind: "auth" }, /rejected the API key/i],
    [{ kind: "rate-limit" }, /rate limiting/i],
    [{ kind: "timeout" }, /timed out/i],
    [{ kind: "http" }, /temporary problem/i],
    [{ kind: "network" }, /couldn't reach the network/i],
  ];
  for (const [err, re] of cases) {
    const d = describeError(err);
    assert.match(d.message, re);
  }
});

test("unknown errors fall back to the network message, never leaking internals", () => {
  const d = describeError(new Error("groq-http-401:{ Authorization: Bearer sk-SECRET }"));
  assert.equal(d.kind, "network");
  assert.equal(d.message.includes("sk-SECRET"), false);
});

test("no-key errors are distinct from auth errors", () => {
  const noKey = describeError({ kind: "no-key" });
  const auth = describeError({ kind: "auth" });
  assert.notEqual(noKey.message, auth.message);
  assert.equal(noKey.kind, "no-key");
  assert.equal(auth.kind, "auth");
});
