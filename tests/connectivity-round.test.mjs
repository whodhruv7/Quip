// Tests: V3.1 connectivity round — env precedence fix, circuit breaker,
// Retry-After, prompt budget, connection journal, model auto-health,
// Gemini + Ollama providers, Doctor network probe. No real network calls.
import test from "node:test";
import assert from "node:assert/strict";

const {
  applyEnvText,
  parseEnvFileText,
  isPlaceholderValue,
  findEnvConflicts,
} = await import("../dist-test/electron/system/env-load.js");
const {
  CircuitBreaker,
  parseRetryAfterMs,
  backoffMs,
} = await import("../dist-test/electron/system/circuit-breaker.js");
const {
  assembleSections,
  trimHistory,
} = await import("../dist-test/electron/system/prompt-budget.js");
const {
  ConnectionJournal,
  summarizeJournal,
} = await import("../dist-test/electron/system/connection-journal.js");
const {
  autoMigrateModel,
  looksLikeModelRejection,
} = await import("../dist-test/electron/system/model-health.js");
const {
  probeNetworkPath,
  buildVerdict,
} = await import("../dist-test/electron/system/brain-health.js");
const {
  ModelRouter,
  ModelTransportError,
} = await import("../dist-test/electron/system/model-router.js");
const {
  PROVIDER_ORDER,
  validateApiKey,
  isProviderEnabled,
  providerEnabledByDefault,
  DEFAULT_MODELS,
  FALLBACK_MODELS,
} = await import("../dist-test/electron/system/env-store.js");
const {
  probeProvider,
  probeOllama,
  ollamaBaseUrl,
} = await import("../dist-test/electron/system/provider-probe.js");
const {
  getSpeakConfig,
  speakConfigEnvEntries,
} = await import("../dist-test/electron/system/speech.js");
const { connectionJournal } = await import(
  "../dist-test/electron/system/connection-journal.js"
);

// ─── helpers ──────────────────────────────────────────────────────────────────

const KEY_ENV_KEYS = [
  "GROQ_API_KEY", "CEREBRAS_API_KEY", "NVIDIA_API_KEY", "OPENROUTER_API_KEY",
  "GEMINI_API_KEY", "GEMINI_MODEL", "GEMINI_VISION_MODEL",
  "QUIP_GROQ_ENABLED", "QUIP_CEREBRAS_ENABLED", "QUIP_NVIDIA_ENABLED",
  "QUIP_OPENROUTER_ENABLED", "QUIP_GEMINI_ENABLED", "QUIP_OLLAMA_ENABLED",
  "QUIP_OLLAMA_URL", "QUIP_OLLAMA_MODEL", "QUIP_PRIMARY_PROVIDER",
  "QUIP_TRANSPORT", "GROQ_MODEL", "CEREBRAS_MODEL", "NVIDIA_MODEL",
  "OPENROUTER_MODEL", "QUIP_SPEAK_ENABLED", "QUIP_SPEAK_ENGINE",
  "GROQ_TTS_VOICE", "QUIP_EDGE_VOICE", "QUIP_LOCAL_VOICE",
];

async function withEnv(env, fn) {
  const saved = Object.fromEntries(KEY_ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEY_ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    for (const k of KEY_ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const ALL_KEYS = {
  GROQ_API_KEY: "gsk_test_groq_key_1234",
  GEMINI_API_KEY: "AIza_test_gemini_key_123",
  CEREBRAS_API_KEY: "csk_test_cerebras_key_1",
  NVIDIA_API_KEY: "nvapi_test_nvidia_key_12",
  OPENROUTER_API_KEY: "sk-or-test-key-1234",
};

// ─── 1. env precedence — THE root-cause fix ──────────────────────────────────

test("repo .env only FILLS missing keys — it can never override existing ones", () => {
  const target = { GROQ_API_KEY: "gsk_real_existing_key" };
  applyEnvText(target, "GROQ_API_KEY=gsk_stale_old_key\nNEW_VAR=hello", false);
  assert.equal(target.GROQ_API_KEY, "gsk_real_existing_key", "existing key must survive repo file");
  assert.equal(target.NEW_VAR, "hello", "missing keys still get filled");
});

test("the Settings (userData) file WINS over everything in override mode", () => {
  const target = { GROQ_API_KEY: "gsk_stale_repo_key" };
  applyEnvText(target, "GROQ_API_KEY=gsk_new_settings_key", true);
  assert.equal(target.GROQ_API_KEY, "gsk_new_settings_key");
});

test("placeholder values NEVER occupy a slot (the old 'your-groq-key-here' trap)", () => {
  assert.equal(isPlaceholderValue("your-groq-key-here"), true);
  assert.equal(isPlaceholderValue("nvapi-your-key-here"), true);
  assert.equal(isPlaceholderValue(""), true);
  assert.equal(isPlaceholderValue("gsk_actual_key_value"), false);
  const target = {};
  applyEnvText(target, "GROQ_API_KEY=your-groq-key-here", false);
  assert.equal(target.GROQ_API_KEY, undefined, "placeholder must not land in env");
});

test("a placeholder ALREADY in env gets cleared so a real key can land", () => {
  const target = { GROQ_API_KEY: "your-groq-key-here" };
  applyEnvText(target, "GROQ_API_KEY=your-groq-key-here\nGEMINI_API_KEY=AIza_real", false);
  // placeholder re-encountered → cleared (no longer blocks later files)
  assert.equal(target.GROQ_API_KEY, undefined);
  assert.equal(target.GEMINI_API_KEY, "AIza_real");
});

test("empty values never shadow existing env (export lines + quotes parse)", () => {
  const target = { GROQ_API_KEY: "gsk_keep_me", EMPTY: undefined };
  applyEnvText(target, 'GROQ_API_KEY=\nexport NVIDIA_API_KEY="nvapi_quoted"', true);
  assert.equal(target.GROQ_API_KEY, "gsk_keep_me", "empty value must not wipe a real key");
  assert.equal(target.NVIDIA_API_KEY, "nvapi_quoted");
});

test("parseEnvFileText handles comments, export prefix and single quotes", () => {
  const pairs = parseEnvFileText("# comment\nexport A=1\nB = 'two words'\nC=three\nnoeqline");
  assert.deepEqual(pairs, [["A", "1"], ["B", "two words"], ["C", "three"]]);
});

test("findEnvConflicts flags keys that differ across files (Doctor evidence)", () => {
  const conflicts = findEnvConflicts([
    { name: "repo", txt: "GROQ_API_KEY=gsk_old\nSHARED=same" },
    { name: "settings", txt: "GROQ_API_KEY=gsk_new\nSHARED=same" },
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].key, "GROQ_API_KEY");
  assert.deepEqual(conflicts[0].files, ["repo", "settings"]);
});

// ─── 2. circuit breaker ───────────────────────────────────────────────────────

function fakeClock() {
  let t = 1_000_000;
  return { now: () => t, tick: (ms) => { t += ms; } };
}

test("breaker: first failure does NOT park; second failure parks with backoff", () => {
  const c = fakeClock();
  const b = new CircuitBreaker(c.now);
  b.recordFailure("groq", { lastError: "x" });
  assert.equal(b.isAvailable("groq"), true, "1st failure = still available");
  assert.equal(b.parkedForMs("groq"), 0);
  b.recordFailure("groq");
  assert.ok(b.parkedForMs("groq") > 0, "2nd failure parks");
  assert.equal(b.isAvailable("groq"), false);
  c.tick(backoffMs(2) + 1);
  assert.equal(b.isAvailable("groq"), true, "park expires automatically");
});

test("breaker: backoff grows with repeated failures and caps at 10 minutes", () => {
  assert.equal(backoffMs(2), 30_000);
  assert.equal(backoffMs(3), 60_000);
  assert.equal(backoffMs(4), 120_000);
  assert.equal(backoffMs(9), backoffMs(20), "capped");
  assert.ok(backoffMs(20) <= 10 * 60_000);
});

test("breaker: a 429 Retry-After parks the provider IMMEDIATELY (first failure)", () => {
  const b = new CircuitBreaker();
  b.recordFailure("openrouter", { retryAfterMs: 12_000 });
  assert.equal(b.isAvailable("openrouter"), false);
  assert.ok(b.parkedForMs("openrouter") > 10_000 && b.parkedForMs("openrouter") <= 12_000);
});

test("breaker: success resets everything; resetAll clears all parks", () => {
  const b = new CircuitBreaker();
  b.recordFailure("groq", { retryAfterMs: 5_000 });
  b.recordFailure("nvidia", { retryAfterMs: 5_000 });
  b.recordSuccess("groq");
  assert.equal(b.isAvailable("groq"), true);
  b.resetAll();
  assert.equal(b.isAvailable("nvidia"), true);
});

test("parseRetryAfterMs: seconds, HTTP-date, garbage", () => {
  assert.equal(parseRetryAfterMs("12"), 12_000);
  assert.equal(parseRetryAfterMs("0"), null);
  assert.equal(parseRetryAfterMs(null), null);
  assert.equal(parseRetryAfterMs("soon"), null);
  const future = new Date(Date.now() + 30_000).toUTCString();
  const ms = parseRetryAfterMs(future);
  assert.ok(ms !== null && ms > 25_000 && ms <= 31_000, "HTTP-date parsed");
});

// ─── 3. prompt budget + history trim (free-tier TPM diet) ────────────────────

test("assembleSections: identity (priority 1) always survives a tiny budget", () => {
  const sections = [
    { id: "identity", priority: 1, text: "IDENTITY" },
    { id: "timeline", priority: 5, text: "T".repeat(500) },
    { id: "memories", priority: 2, text: "M".repeat(500) },
  ];
  const r = assembleSections(sections, 600);
  assert.ok(r.prompt.includes("IDENTITY"), "identity must survive");
  assert.ok(r.prompt.includes("M"), "priority 2 fits under the budget");
  assert.ok(r.dropped.includes("timeline"), "priority 5 drops first");
  assert.ok(!r.dropped.includes("identity"), "identity is never dropped");
  // order preserved: identity first in the joined prompt
  assert.ok(r.prompt.indexOf("IDENTITY") < r.prompt.indexOf("M"));
});

test("assembleSections: priority order decides what fits first", () => {
  const sections = [
    { id: "a", priority: 5, text: "A".repeat(200) },
    { id: "b", priority: 2, text: "B".repeat(200) },
    { id: "c", priority: 3, text: "C".repeat(200) },
  ];
  const r = assembleSections(sections, 450);
  assert.ok(r.prompt.includes("B"));
  assert.ok(r.prompt.includes("C"));
  assert.ok(!r.prompt.includes("A"));
});

test("trimHistory: keeps the most recent window, never drops the last message", () => {
  const big = Array.from({ length: 40 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `msg-${i}`,
  }));
  const trimmed = trimHistory(big);
  assert.ok(trimmed.length <= 14);
  assert.equal(trimmed[trimmed.length - 1].content, "msg-39", "last message always kept");
  assert.equal(trimmed[0].content, "msg-26", "oldest trimmed first");
});

test("trimHistory: char budget drops old messages; per-message cap truncates", () => {
  const history = [
    { role: "user", content: "x".repeat(5000) },
    { role: "assistant", content: "y".repeat(5000) },
    { role: "user", content: "final question" },
  ];
  const trimmed = trimHistory(history, { maxChars: 3000, maxMessages: 10, perMessageCap: 1000 });
  assert.equal(trimmed[trimmed.length - 1].content, "final question");
  assert.ok(trimmed.reduce((n, m) => n + m.content.length, 0) <= 3000 + 1000, "budget respected (± one message)");
});

// ─── 4. connection journal ────────────────────────────────────────────────────

test("journal: ring buffer caps at the limit and tail() reads the last N", () => {
  const j = new ConnectionJournal();
  for (let i = 0; i < 100; i++) {
    j.record({ provider: `p${i}`, model: "m", ok: i % 2 === 0, kind: "none", latencyMs: i, note: "" });
  }
  assert.equal(j.all().length, 80);
  const tail = j.tail(3);
  assert.deepEqual(tail.map((e) => e.provider), ["p97", "p98", "p99"]);
});

test("journal: persistence is debounced and never throws into the caller", async () => {
  let saved = null;
  let savedCount = 0;
  const j = new ConnectionJournal();
  j.configurePersist((entries) => {
    savedCount++;
    saved = entries;
    if (savedCount === 1) throw new Error("disk full"); // must not break the app
  });
  j.record({ provider: "groq", model: "m", ok: true, kind: "none", latencyMs: 5, note: "" });
  await new Promise((r) => setTimeout(r, 1700));
  assert.ok(savedCount >= 1);
  assert.ok(Array.isArray(saved));
});

test("summarizeJournal renders an honest, readable evidence trail", () => {
  const j = new ConnectionJournal();
  j.record({ provider: "groq", model: "m", ok: false, kind: "auth", latencyMs: 120, note: "key rejected" });
  const line = summarizeJournal(j.all(), 5);
  assert.ok(line.includes("✗"));
  assert.ok(line.includes("groq"));
  assert.ok(line.includes("key rejected"));
});

// ─── 5. model auto-health (dead model ids heal themselves) ───────────────────

test("looksLikeModelRejection matches decommission words only", () => {
  assert.equal(looksLikeModelRejection({ ok: true, message: "" }), false);
  assert.equal(looksLikeModelRejection({ ok: false, message: "The model `llama-3.3-70b-versatile` has been decommissioned" }), true);
  assert.equal(looksLikeModelRejection({ ok: false, message: "Invalid API key" }), false);
  assert.equal(looksLikeModelRejection({ ok: false, message: "rate limit exceeded" }), false);
});

test("autoMigrateModel: rejected configured id → first live spare is chosen", async () => {
  const probed = [];
  const decision = await autoMigrateModel({
    configured: "old-model",
    spares: ["spare-a", "spare-b"],
    probe: async (model) => {
      probed.push(model);
      return model === "spare-a"
        ? { ok: true, message: "Connected" }
        : { ok: false, message: `The model ${model} does not exist` };
    },
  });
  assert.equal(decision.migrated, true);
  assert.equal(decision.model, "spare-a");
  assert.deepEqual(probed, ["old-model", "spare-a"]);
});

test("autoMigrateModel: auth/network problems NEVER trigger migration", async () => {
  const decision = await autoMigrateModel({
    configured: "some-model",
    spares: ["spare"],
    probe: async () => ({ ok: false, message: "Invalid API key (HTTP 401)" }),
  });
  assert.equal(decision.migrated, false);
});

test("autoMigrateModel: healthy configured model → no change", async () => {
  const decision = await autoMigrateModel({
    configured: "good-model",
    spares: ["spare"],
    probe: async () => ({ ok: true, message: "Connected" }),
  });
  assert.equal(decision.migrated, false);
  assert.match(decision.reason, /ok/);
});

// ─── 6. Doctor network probe (401 proves the internet path) ──────────────────

test("probeNetworkPath: HTTP 401 = internet alive from inside the app", async () => {
  const r = await probeNetworkPath(async () => ({ status: 401 }));
  assert.equal(r.ok, true);
});

test("probeNetworkPath: network error = the app is offline/blocked (honest)", async () => {
  const r = await probeNetworkPath(async () => { throw new Error("getaddrinfo ENOTFOUND"); });
  assert.equal(r.ok, false);
  assert.match(r.message, /can't reach the network|can't reach/i);
});

test("probeNetworkPath: timeout reported distinctly", async () => {
  const r = await probeNetworkPath(async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); });
  assert.equal(r.ok, false);
  assert.match(r.message, /timed out/i);
});

test("buildVerdict: exact, honest one-liners for every state", () => {
  const ok = { ok: true, message: "" };
  assert.match(buildVerdict(ok, [{ ok: true, label: "Groq" }], []), /1 provider working/);
  assert.match(buildVerdict({ ok: false, message: "" }, [], []), /cannot reach the internet/i);
  assert.match(buildVerdict(ok, [], []), /No provider is configured/i);
  assert.match(buildVerdict(ok, [{ ok: false, label: "Groq" }], []), /no provider answered/i);
});

// ─── 7. six-provider chain: Gemini + Ollama join correctly ───────────────────

test("default priority: groq > gemini > cerebras > nvidia > openrouter (ollama off by default)", () => {
  return withEnv(ALL_KEYS, () => {
    assert.deepEqual(PROVIDER_ORDER, ["groq", "gemini", "cerebras", "nvidia", "openrouter", "ollama"]);
    const r = new ModelRouter();
    const chain = r.status().chain.map((c) => c.provider);
    assert.deepEqual(chain, ["groq", "gemini", "cerebras", "nvidia", "openrouter"]);
  });
});

test("ollama joins the chain ONLY when explicitly enabled (opt-in offline backup)", () => {
  return withEnv({ ...ALL_KEYS, QUIP_OLLAMA_ENABLED: "1" }, () => {
    assert.equal(providerEnabledByDefault("ollama"), false);
    assert.equal(providerEnabledByDefault("groq"), true);
    assert.equal(isProviderEnabled("ollama"), true);
    const r = new ModelRouter();
    const chain = r.status().chain.map((c) => c.provider);
    assert.equal(chain[chain.length - 1], "ollama", "ollama sits LAST as the last resort");
    assert.equal(isProviderEnabled("ollama"), true);
  });
});

test("a Gemini key alone makes Gemini the active brain", () => {
  return withEnv({ GEMINI_API_KEY: ALL_KEYS.GEMINI_API_KEY }, () => {
    const r = new ModelRouter();
    assert.equal(r.status().active.provider, "gemini");
    assert.match(r.status().active.model, /gemini/);
    assert.match(r.activeVisionModel(), /gemini/);
  });
});

test("Gemini/Ollama defaults are wired through env-store", () => {
  assert.equal(DEFAULT_MODELS.gemini, "gemini-2.5-flash");
  assert.equal(DEFAULT_MODELS.ollama, "llama3.2:3b");
  assert.ok(FALLBACK_MODELS.gemini.length >= 2, "Gemini has live spares for auto-migration");
  assert.deepEqual(validateApiKey("gemini", "AIzaSyD-test-123"), { ok: true, message: "Key format looks right." });
  assert.equal(validateApiKey("gemini", "gsk_wrong_prefix").ok, false);
  // Ollama: no key needed — validation accepts anything non-empty
  assert.equal(validateApiKey("ollama", "anything-goes").ok, true);
});

// ─── 8. Ollama URL normalization + probe honesty ─────────────────────────────

test("ollamaBaseUrl normalizes messy URLs into the /v1 root", () => {
  assert.equal(ollamaBaseUrl(undefined), "http://127.0.0.1:11434/v1");
  assert.equal(ollamaBaseUrl(""), "http://127.0.0.1:11434/v1");
  assert.equal(ollamaBaseUrl("http://localhost:11434"), "http://localhost:11434/v1");
  assert.equal(ollamaBaseUrl("http://localhost:11434/"), "http://localhost:11434/v1");
  assert.equal(ollamaBaseUrl("http://localhost:11434/v1/"), "http://localhost:11434/v1");
  assert.equal(ollamaBaseUrl("http://localhost:11434/v1/chat/completions"), "http://localhost:11434/v1");
});

test("probeOllama: running server = honest ok with model count", async () => {
  const r = await probeOllama("llama3.2:3b", async (url) => {
    assert.equal(url, "http://127.0.0.1:11434/v1/models");
    return { status: 200, text: async () => JSON.stringify({ data: [{ id: "llama3.2:3b" }] }) };
  });
  assert.equal(r.ok, true);
  assert.match(r.message, /1 local models/);
});

test("probeOllama: not running = gentle honest failure (it's optional)", async () => {
  const r = await probeOllama("llama3.2:3b", async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:11434"); });
  assert.equal(r.ok, false);
  assert.match(r.message, /isn't running|optional offline backup/);
});

test("probeProvider dispatches gemini to the Google OpenAI-compatible endpoint", async () => {
  let seenUrl = null;
  const r = await probeProvider("gemini", "AIza_test", "gemini-2.5-flash", async (url, init) => {
    seenUrl = url;
    return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "ok" } }] }) };
  });
  assert.equal(r.ok, true);
  assert.equal(seenUrl, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
});

// ─── 9. speech: edge engine joins the voice chain ────────────────────────────

test("getSpeakConfig exposes the edge voice; env entries persist it", () => {
  return withEnv({ QUIP_EDGE_VOICE: "en-US-AriaNeural" }, () => {
    const cfg = getSpeakConfig();
    assert.equal(cfg.edgeVoice, "en-US-AriaNeural");
    const entries = speakConfigEnvEntries({ edgeVoice: "en-IN-NeerjaNeural", engine: "edge" });
    assert.equal(entries.QUIP_EDGE_VOICE, "en-IN-NeerjaNeural");
    assert.equal(entries.QUIP_SPEAK_ENGINE, "edge");
  });
});

test("parseEngine accepts the new edge engine; unknown values stay auto", () => {
  return withEnv({ QUIP_SPEAK_ENGINE: "edge" }, () => {
    assert.equal(getSpeakConfig().engine, "edge");
  });
});

// ─── 10. end-to-end: breaker parks a dead provider across messages ───────────

test("router: after 2 failed messages the dead provider is skipped (chain advances)", async () => {
  await withEnv(
    { GROQ_API_KEY: "gsk_test_groq_key_1234", GEMINI_API_KEY: ALL_KEYS.GEMINI_API_KEY },
    async () => {
      const r = new ModelRouter();
      const originalFetch = globalThis.fetch;
      let groqCalls = 0;
      globalThis.fetch = async (url) => {
        if (String(url).includes("api.groq.com")) {
          groqCalls++;
          throw new Error("connection refused");
        }
        // Gemini answers with a minimal SSE stream
        return new Response(
          'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n',
          { status: 200, headers: { "content-type": "text/event-stream" } }
        );
      };
      try {
        const seen = [];
        const first = await r.stream("sys", [{ role: "user", content: "1" }], {
          onChunk: () => {},
          onProvider: (p, confirmed) => seen.push(`${p}:${confirmed}`),
        });
        assert.equal(first.provider, "gemini");
        assert.equal(first.switched, true, "failover happened");
        assert.ok(seen.some((s) => s === "groq:false"), "chip announces the attempt");
        assert.ok(seen.some((s) => s === "gemini:true"), "chip confirms the answerer");
        const attemptsBefore = groqCalls;
        // Second message: groq is now parked (2 failures) → NOT dialed again
        const second = await r.stream("sys", [{ role: "user", content: "2" }], { onChunk: () => {} });
        assert.equal(second.provider, "gemini");
        assert.equal(groqCalls, attemptsBefore, "circuit breaker must skip the parked provider");
        // journal has honest evidence
        const entries = connectionJournal.all();
        assert.ok(entries.some((e) => e.provider === "groq" && !e.ok));
        assert.ok(entries.some((e) => e.provider === "gemini" && e.ok));
      } finally {
        globalThis.fetch = originalFetch;
        connectionJournal.clear();
      }
    }
  );
});

test("router: total failure error carries retryAfterMs from a 429 for the breaker", async () => {
  await withEnv({ GROQ_API_KEY: "gsk_test_groq_key_1234" }, async () => {
    const r = new ModelRouter();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "Rate limit reached" } }), {
      status: 429,
      headers: { "retry-after": "20" },
    });
    try {
      await assert.rejects(
        r.complete("sys", [{ role: "user", content: "hi" }]),
        (err) => {
          assert.ok(err instanceof ModelTransportError);
          assert.equal(err.kind, "rate-limit");
          assert.equal(err.retryAfterMs, 20_000);
          // and the breaker parked groq for ~20s
          assert.ok(r.breaker.parkedForMs("groq") > 15_000);
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
      r.breaker.resetAll();
    }
  });
});
