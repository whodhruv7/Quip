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

test("OpenRouter default model is a verified-live free id (never a stale name)", () => {
  // The old default "minimax/minimax-m3:free" NEVER EXISTED on OpenRouter
  // (only the paid "minimax/minimax-m3" does) — every chat 400'd. The
  // current default was verified live against OpenRouter's public
  // /api/v1/models list on 2026-09-13.
  assert.equal(defaultOpenRouterModel(), "google/gemma-4-31b-it:free");
  assert.notEqual(defaultOpenRouterModel(), "minimax/minimax-m3:free");
});

test("all provider defaults avoid decommissioned model ids", async () => {
  const { DEFAULT_MODELS } = await import("../dist-test/electron/system/env-store.js");
  // Groq decommissioned these for FREE tiers on 2026-08-16:
  const groqDead = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
  assert.equal(groqDead.includes(DEFAULT_MODELS.groq), false);
  // NVIDIA's live /v1/models no longer lists meta/llama-3.3-70b-instruct:
  assert.notEqual(DEFAULT_MODELS.nvidia, "meta/llama-3.3-70b-instruct");
  // Every provider must define at least one verified spare:
  const { FALLBACK_MODELS } = await import("../dist-test/electron/system/env-store.js");
  for (const p of ["groq", "cerebras", "nvidia", "openrouter"]) {
    assert.ok(Array.isArray(FALLBACK_MODELS[p]) && FALLBACK_MODELS[p].length >= 2, `${p} has spares`);
  }
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
