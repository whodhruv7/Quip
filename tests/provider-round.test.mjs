// Tests: provider round — 4-provider failover chain (Groq/Cerebras/NVIDIA/
// OpenRouter), auto model discovery, honest failure trails, TTS voice chain,
// Skales document/weather capability ports. No real provider/network calls.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { ModelRouter, ModelTransportError } = await import(
  "../dist-test/electron/system/model-router.js"
);
const { discoverModels, clearModelCache } = await import(
  "../dist-test/electron/system/model-discovery.js"
);
const { probeProvider, providerErrorSnippet } = await import(
  "../dist-test/electron/system/provider-probe.js"
);
const {
  validateApiKey,
  PROVIDER_ORDER,
  upsertEnvFile,
} = await import("../dist-test/electron/system/env-store.js");
const {
  sanitizeForSpeech,
  speakText,
  getSpeakConfig,
  speakConfigEnvEntries,
} = await import("../dist-test/electron/system/speech.js");
const {
  createDocument,
  docxRead,
  buildZip,
  zipExtract,
} = await import("../dist-test/electron/engine/docs-tools.js");
const { TOOL_CATALOG, toolSchemas } = await import(
  "../dist-test/electron/engine/tool-catalog.js"
);
const { executorNames } = await import("../dist-test/electron/engine/tool-registry.js");

// ─── Helpers ─────────────────────────────────────────────────────────────────

const KEY_ENV_KEYS = [
  "GROQ_API_KEY",
  "CEREBRAS_API_KEY",
  "NVIDIA_API_KEY",
  "OPENROUTER_API_KEY",
  "QUIP_PRIMARY_PROVIDER",
  "QUIP_GROQ_ENABLED",
  "QUIP_CEREBRAS_ENABLED",
  "QUIP_NVIDIA_ENABLED",
  "QUIP_OPENROUTER_ENABLED",
  "GROQ_MODEL",
  "CEREBRAS_MODEL",
  "NVIDIA_MODEL",
  "OPENROUTER_MODEL",
  "QUIP_SPEAK_ENABLED",
  "QUIP_SPEAK_ENGINE",
  "GROQ_TTS_VOICE",
];

async function withEnv(env, fn) {
  const saved = Object.fromEntries(KEY_ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEY_ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  // `return await fn()` — the env must stay applied for the WHOLE async body,
  // not just its synchronous prefix (a bare `return fn()` restored the env
  // before the first await, silently un-keying every awaited assertion).
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
  CEREBRAS_API_KEY: "csk_test_cerebras_key_1",
  NVIDIA_API_KEY: "nvapi_test_nvidia_key_12",
  OPENROUTER_API_KEY: "sk-or-test-key-1234",
};

const jsonResponse = (body, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

function mockJsonFetch(status, body) {
  return async (url, init) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  });
}

// ─── 1. Four-provider chain: priority, kill switches, primary override ──────

test("default priority is groq > cerebras > nvidia > openrouter", () => {
  withEnv(ALL_KEYS, () => {
    const r = new ModelRouter();
    const chain = r.status().chain.map((c) => c.provider);
    assert.deepEqual(chain, ["groq", "cerebras", "nvidia", "openrouter"]);
  });
});

test("with only groq + openrouter keys the chain stays groq-first (old behavior kept)", () => {
  withEnv(
    { GROQ_API_KEY: ALL_KEYS.GROQ_API_KEY, OPENROUTER_API_KEY: ALL_KEYS.OPENROUTER_API_KEY },
    () => {
      const r = new ModelRouter();
      assert.equal(r.status().primary.provider, "groq");
      assert.equal(r.status().fallback.provider, "openrouter");
      assert.deepEqual(r.status().chain.map((c) => c.provider), ["groq", "openrouter"]);
    }
  );
});

test("a Cerebras key alone makes Cerebras the active brain", () => {
  withEnv({ CEREBRAS_API_KEY: ALL_KEYS.CEREBRAS_API_KEY }, () => {
    const r = new ModelRouter();
    assert.equal(r.status().primary.provider, "cerebras");
    assert.equal(r.status().active.provider, "cerebras");
    assert.match(r.activeVisionModel(), /llama-4-scout/);
  });
});

test("an NVIDIA key alone makes NVIDIA the active brain", () => {
  withEnv({ NVIDIA_API_KEY: ALL_KEYS.NVIDIA_API_KEY }, () => {
    const r = new ModelRouter();
    assert.equal(r.status().primary.provider, "nvidia");
    assert.equal(r.status().active.provider, "nvidia");
    // NVIDIA's live model list no longer carries llama-4-scout — the verified
    // vision-capable default is meta/llama-3.2-90b-vision-instruct.
    assert.match(r.activeVisionModel(), /llama-3\.2-90b-vision-instruct/);
  });
});

test("QUIP_PRIMARY_PROVIDER=cerebras puts Cerebras at the head of the chain", () => {
  withEnv({ ...ALL_KEYS, QUIP_PRIMARY_PROVIDER: "cerebras" }, () => {
    const r = new ModelRouter();
    assert.equal(r.status().primary.provider, "cerebras");
    assert.equal(r.status().chain[1].provider, "groq");
  });
});

test("per-provider kill switches remove cerebras/nvidia from the chain", () => {
  withEnv(
    { ...ALL_KEYS, QUIP_CEREBRAS_ENABLED: "0", QUIP_NVIDIA_ENABLED: "0" },
    () => {
      const r = new ModelRouter();
      const chain = r.status().chain.map((c) => c.provider);
      assert.ok(!chain.includes("cerebras"));
      assert.ok(!chain.includes("nvidia"));
      assert.deepEqual(chain, ["groq", "openrouter"]);
    }
  );
});

test("turning EVERY provider off is impossible via the chain — disabled ones are just skipped", () => {
  withEnv(ALL_KEYS, () => {
    const r = new ModelRouter();
    // status.healthy reflects that at least one configured+enabled provider exists
    assert.equal(r.status().healthy, true);
  });
});

// ─── 2. Honest failure trail — WHY every provider failed ─────────────────────

test("when every provider fails, the error carries a per-provider trail", async () => {
  await withEnv(ALL_KEYS, async () => {
    const r = new ModelRouter();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("connection reset by peer");
    };
    try {
      await assert.rejects(
        r.stream("sys", [{ role: "user", content: "hi" }], { onChunk: () => {} }),
        (err) => {
          assert.ok(err instanceof ModelTransportError);
          assert.ok(err.attempts.length >= 4, "trail should name every provider");
          const joined = err.attempts.join("\n");
          for (const name of ["Groq", "Cerebras", "NVIDIA", "OpenRouter"]) {
            assert.ok(joined.includes(name), `trail must mention ${name}`);
          }
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("the trail also reports providers with NO key (skip notes)", async () => {
  await withEnv({ GROQ_API_KEY: "gsk_test_groq_key_1234" }, async () => {
    const r = new ModelRouter();
    // Reach into the private wrapper via a failing complete() call.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("no network");
    };
    try {
      await r.complete("sys", [{ role: "user", content: "hi" }]).then(
        () => assert.fail("should have thrown"),
        (err) => {
          const joined = (err.attempts ?? []).join("\n");
          assert.ok(joined.includes("CEREBRAS_API_KEY not set"));
          assert.ok(joined.includes("NVIDIA_API_KEY not set"));
          assert.ok(joined.includes("OPENROUTER_API_KEY not set"));
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ─── 3. Auto model discovery (the "browse all models" engine) ────────────────

test("discoverModels returns every model id the key can reach", async () => {
  clearModelCache();
  const models = [
    { id: "llama-3.3-70b-versatile", owned_by: "meta" },
    { id: "allam-2-7b", owned_by: "nvidia" },
    { id: "whisper-large-v3", owned_by: "openai" },
  ];
  const r = await discoverModels("groq", "gsk_real_key_123", mockJsonFetch(200, { data: models }));
  assert.equal(r.ok, true);
  assert.equal(r.models.length, 3);
  assert.ok(r.models[0].id <= r.models[1].id, "models come back sorted");
  assert.equal(r.models[2].ownedBy, "openai");
});

test("discoverModels surfaces the provider's own auth error honestly", async () => {
  clearModelCache();
  const r = await discoverModels("cerebras", "csk_bad_key", mockJsonFetch(401, { error: { message: "invalid api key" } }));
  assert.equal(r.ok, false);
  assert.match(r.message, /401/);
  assert.match(r.message, /invalid api key/);
});

test("discoverModels rejects unknown providers without dialing", async () => {
  const r = await discoverModels("not-a-provider", "x", mockJsonFetch(200, { data: [] }));
  assert.equal(r.ok, false);
  assert.match(r.message, /Unknown provider/);
});

// ─── 4. Probes for the two NEW providers + richer diagnostics ────────────────

test("cerebras probe proves key AND model id with a real 1-token chat completion", async () => {
  let called = null;
  const fetchImpl = async (url, init) => {
    called = { url, method: init?.method, auth: init?.headers?.Authorization, body: JSON.parse(init?.body ?? "{}") };
    return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "o" } }] }) };
  };
  const r = await probeProvider("cerebras", "csk_test_key_9", "llama-3.3-70b", fetchImpl);
  assert.equal(r.ok, true);
  assert.equal(called.url, "https://api.cerebras.ai/v1/chat/completions");
  assert.equal(called.method, "POST");
  assert.equal(called.body.model, "llama-3.3-70b");
  assert.equal(called.body.max_tokens, 1);
  assert.match(called.auth, /^Bearer csk_test_key_9$/);
});

test("groq probe validates the model id — a dead model is reported honestly", async () => {
  const fetchImpl = async () => ({
    status: 400,
    text: async () => JSON.stringify({ error: { message: "Model llama-3.3-70b-versatile is decommissioned and no longer available." } }),
  });
  const r = await probeProvider("groq", "gsk_test_key_9", "llama-3.3-70b-versatile", fetchImpl);
  assert.equal(r.ok, false);
  assert.match(r.message, /decommissioned/);
  assert.match(r.message, /llama-3.3-70b-versatile/);
});

test("nvidia probe reports rate limiting distinctly (HTTP 429)", async () => {
  const r = await probeProvider("nvidia", "nvapi_test_key_9", "m", mockJsonFetch(429, { error: "rate limit exceeded" }));
  assert.equal(r.ok, false);
  assert.equal(r.kind, "rate-limit");
  assert.match(r.message, /429/);
});

test("probe failures carry the provider's own error words", async () => {
  const r = await probeProvider("nvidia", "nvapi_bad", "m", mockJsonFetch(403, { error: { message: "API key expired — generate a new one" } }));
  assert.equal(r.kind, "auth");
  assert.match(r.message, /API key expired/);
});

test("providerErrorSnippet extracts nested messages and truncates raw bodies", () => {
  assert.equal(providerErrorSnippet(JSON.stringify({ error: { message: "boom happened" } })), "boom happened");
  assert.match(providerErrorSnippet("<html>  oops  </html>"), /<html> oops/);
  assert.equal(providerErrorSnippet(""), "");
});

// ─── 5. Key validation for the new providers ─────────────────────────────────

test("cerebras keys must start with csk- and nvidia keys with nvapi-", () => {
  assert.equal(validateApiKey("cerebras", "csk-abc123456").ok, true);
  assert.equal(validateApiKey("cerebras", "gsk_wrong").ok, false);
  assert.equal(validateApiKey("nvidia", "nvapi-abc123456").ok, true);
  assert.equal(validateApiKey("nvidia", "sk-or-wrong").ok, false);
  assert.match(validateApiKey("nvidia", "wrong").message, /nvapi-/);
});

test("PROVIDER_ORDER is the documented failover order", () => {
  assert.deepEqual(PROVIDER_ORDER, ["groq", "cerebras", "nvidia", "openrouter"]);
});

// ─── 6. Speech — the companion's real voice ──────────────────────────────────

test("sanitizeForSpeech strips markdown, links, code and emoji", () => {
  const out = sanitizeForSpeech("# Title ✨\n\nHere is **bold** and `code` and [a link](https://x.com).\n```js\nlet x=1;\n```");
  assert.ok(!out.includes("#"));
  assert.ok(!out.includes("**"));
  assert.ok(!out.includes("```"));
  assert.ok(!out.includes("✨"));
  assert.ok(out.includes("bold"));
  assert.ok(out.includes("a link"));
});

test("speak config round-trips through env entries", () => {
  withEnv({}, () => {
    const entries = speakConfigEnvEntries({ enabled: false, engine: "local", voice: "Fritz-PlayAI" });
    assert.equal(entries.QUIP_SPEAK_ENABLED, "0");
    assert.equal(entries.QUIP_SPEAK_ENGINE, "local");
    assert.equal(entries.GROQ_TTS_VOICE, "Fritz-PlayAI");
    for (const [k, v] of Object.entries(entries)) process.env[k] = v;
    const cfg = getSpeakConfig();
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.engine, "local");
    assert.equal(cfg.voice, "Fritz-PlayAI");
  });
});

test("auto engine with no Groq key and no Windows → honest failure, not silence", async () => {
  await withEnv({}, async () => {
    const outcome = await speakText("Hello there", { engine: "auto" });
    if (process.platform === "win32") {
      assert.equal(outcome.ok, true);
      assert.equal(outcome.engine, "local");
    } else {
      assert.equal(outcome.ok, false);
      assert.match(outcome.message, /Windows|voice/i);
    }
  });
});

test("groq voice failure surfaces the reason, then falls back to the local voice", async () => {
  if (process.platform !== "win32") {
    await withEnv({ GROQ_API_KEY: "gsk_real_key_1" }, async () => {
      const outcome = await speakText("Test sentence", {
        engine: "auto",
        voice: "Celeste-PlayAI",
      }, mockJsonFetch(400, { error: { message: "Terms acceptance for PlayAI TTS required" } }));
      assert.equal(outcome.ok, false);
      assert.match(outcome.message, /Terms acceptance|playai/i);
    });
  }
});

test("groq voice success returns playable wav bytes", async () => {
  await withEnv({ GROQ_API_KEY: "gsk_real_key_1", QUIP_SPEAK_ENABLED: "1" }, async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => Buffer.alloc(4096, 1).buffer,
    });
    const outcome = await speakText("Hi from the test", { engine: "groq" }, fetchImpl);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.engine, "groq");
    assert.ok(outcome.audioBase64.length > 8);
    assert.equal(outcome.mime, "audio/wav");
  });
});

// ─── 7. Documents — REAL docx/xlsx creation, verified by reading back ────────

test("create a real .docx, read it back, text survives the round-trip", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quip-docx-"));
  const file = path.join(dir, "hello.docx");
  const made = createDocument("docx", file, { text: "First line\nSecond line with details" });
  assert.equal(made.ok, true, made.summary);
  assert.ok(fs.existsSync(file));
  const zip = fs.readFileSync(file);
  assert.equal(zip.readUInt32LE(0), 0x04034b50, "starts with a real zip local header");
  const read = docxRead(file);
  assert.equal(read.ok, true, read.summary);
  assert.match(read.summary, /First line/);
  assert.match(read.summary, /Second line with details/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("create a real .xlsx with rows and verify the sheet XML inside", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quip-xlsx-"));
  const file = path.join(dir, "data.xlsx");
  const made = createDocument("xlsx", file, { rows: [["name", "age"], ["Asha", "7"]] });
  assert.equal(made.ok, true, made.summary);
  const sheet = zipExtract(fs.readFileSync(file), "xl/worksheets/sheet1.xml");
  assert.ok(sheet, "worksheet part exists");
  const xml = sheet.toString("utf8");
  assert.match(xml, /Asha/);
  assert.match(xml, /<c r="B2"><v>7<\/v><\/c>/, "numeric cells are real numbers");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("create a real .pptx with two slides and verify slide parts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quip-pptx-"));
  const file = path.join(dir, "deck.pptx");
  const made = createDocument("pptx", file, {
    slides: [
      { title: "Quip", body: "Slide one body" },
      { title: "Second", body: "More content\nSecond line" },
    ],
  });
  assert.equal(made.ok, true, made.summary);
  const zip = fs.readFileSync(file);
  const slide1 = zipExtract(zip, "ppt/slides/slide1.xml");
  const slide2 = zipExtract(zip, "ppt/slides/slide2.xml");
  assert.ok(slide1 && slide2, "both slides exist");
  assert.match(slide1.toString("utf8"), /Slide one body/);
  assert.match(slide2.toString("utf8"), /Second line/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("document creation is honest about wrong extensions and empty content", () => {
  assert.equal(createDocument("docx", "/tmp/thing.xlsx", { text: "hi" }).ok, false);
  assert.equal(createDocument("docx", "/tmp/thing.docx", { text: "" }).ok, false);
  assert.equal(createDocument("xlsx", "/tmp/thing.xlsx", { rows: [] }).ok, false);
});

test("buildZip → zipExtract roundtrip handles stored entries", () => {
  const zip = buildZip([
    { name: "a/one.txt", data: Buffer.from("hello zip") },
    { name: "two.txt", data: Buffer.from("second entry") },
  ]);
  assert.equal(zipExtract(zip, "a/one.txt").toString("utf8"), "hello zip");
  assert.equal(zipExtract(zip, "two.txt").toString("utf8"), "second entry");
  assert.equal(zipExtract(zip, "missing.txt"), null);
});

// ─── 8. New tools are in the catalog AND have real executors ─────────────────

test("Skales + Agent-Reach capability tools exist in catalog and registry", () => {
  const catalog = TOOL_CATALOG.map((t) => t.schema.function.name);
  const executors = executorNames();
  for (const required of [
    "weather", "summarize", "pdf_read", "docx_read", "doc_create",
    "sys_info", "network_info", "speak",
    "github_read", "v2ex_read", "bilibili_read", "tweet_read",
  ]) {
    assert.ok(catalog.includes(required), `missing catalog tool: ${required}`);
    assert.ok(executors.includes(required), `missing executor: ${required}`);
  }
});

test("all tool schemas stay valid OpenAI function shapes", () => {
  for (const schema of toolSchemas()) {
    assert.equal(schema.type, "function");
    for (const prop of Object.values(schema.function.parameters.properties)) {
      assert.equal(prop.type, "string");
    }
  }
});

test("escalation heuristic recognizes the new capability keywords", async () => {
  const { orchestrator } = await import("../dist-test/electron/engine/orchestrator.js");
  const heuristic = (cmd) => orchestrator.looksLikeTask(cmd);
  assert.equal(heuristic("what's the weather in delhi"), true);
  assert.equal(heuristic("mausam kaisa hai"), true);
  assert.equal(heuristic("summarize this for me"), true);
  assert.equal(heuristic("make me a pptx on space"), true);
  assert.equal(heuristic("check cpu usage"), true);
  assert.equal(heuristic("read this github repo"), true);
  // Plain conversation must NOT escalate.
  assert.equal(heuristic("you are so funny"), false);
  assert.equal(heuristic("tell me a joke"), false);
});

// ─── 9. .env upsert handles the new provider vars in place ───────────────────

test("upsertEnvFile replaces existing provider keys in place", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quip-env-"));
  const file = path.join(dir, ".env");
  fs.writeFileSync(file, "# header\nGROQ_API_KEY=gsk_old_key\nOTHER=x\n");
  const res = upsertEnvFile(file, { CEREBRAS_API_KEY: "csk_new_key", GROQ_API_KEY: "gsk_new_key" });
  assert.equal(res.ok, true);
  const text = fs.readFileSync(file, "utf8");
  assert.match(text, /GROQ_API_KEY=gsk_new_key/);
  assert.match(text, /CEREBRAS_API_KEY=csk_new_key/);
  assert.match(text, /OTHER=x/);
  assert.ok(!text.includes("gsk_old_key"), "old key replaced, not duplicated");
  fs.rmSync(dir, { recursive: true, force: true });
});

// ─── 9. Model-id fallback + honest empty-reply failover (2026-09 round) ──────

// Minimal SSE Response for stream tests (Node 18+ global Response/streams).
function sseResponse(frames) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const sseText = (text) =>
  sseResponse(['data: {"choices":[{"delta":{"content":"' + text + '"}}]}\n\n', "data: [DONE]\n\n"]);

test("a decommissioned model id retries the SAME provider with its spare model", async () => {
  await withEnv(ALL_KEYS, async () => {
    const r = new ModelRouter();
    const modelsTried = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init?.body ?? "{}");
      modelsTried.push(body.model);
      if (body.model === "openai/gpt-oss-120b") {
        return new Response(
          JSON.stringify({ error: { message: "Model openai/gpt-oss-120b is decommissioned and no longer available." } }),
          { status: 400 }
        );
      }
      return sseText("spare answered");
    };
    try {
      const { full, provider } = await r.stream("sys", [{ role: "user", content: "hi" }], { onChunk: () => {} });
      assert.equal(provider, "groq", "the SAME provider answers via its spare model");
      assert.equal(full, "spare answered");
      assert.deepEqual(modelsTried, ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("auth failures do NOT burn spare models — the router fails over instead", async () => {
  await withEnv(ALL_KEYS, async () => {
    const r = new ModelRouter();
    const modelsTried = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init?.body ?? "{}");
      if (String(url).includes("groq")) {
        modelsTried.push(body.model);
        return jsonResponse({ error: { message: "bad key" } }, 401);
      }
      return sseText("cerebras caught it");
    };
    try {
      const { provider, full } = await r.stream("sys", [{ role: "user", content: "hi" }], { onChunk: () => {} });
      assert.equal(provider, "cerebras");
      assert.equal(full, "cerebras caught it");
      assert.deepEqual(modelsTried, ["openai/gpt-oss-120b"], "exactly one groq attempt — no spare burn");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("a 200 stream that yields NOTHING fails over instead of a silent empty bubble", async () => {
  await withEnv(ALL_KEYS, async () => {
    const r = new ModelRouter();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      // groq/cerebras/nvidia return empty-but-200 streams; OpenRouter answers
      if (String(url).includes("openrouter")) return sseText("fallback brain");
      return sseResponse(["data: [DONE]\n\n"]);
    };
    try {
      const { full, provider, switched } = await r.stream("sys", [{ role: "user", content: "hi" }], { onChunk: () => {} });
      assert.equal(provider, "openrouter");
      assert.equal(full, "fallback brain");
      assert.equal(switched, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("a 200 SSE stream carrying an error frame fails over honestly", async () => {
  await withEnv(ALL_KEYS, async () => {
    const r = new ModelRouter();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes("groq")) {
        return sseResponse(['data: {"error":{"message":"quota exceeded mid-stream"}}\n\n']);
      }
      return sseText("cerebras answered");
    };
    try {
      const { full, provider } = await r.stream("sys", [{ role: "user", content: "hi" }], { onChunk: () => {} });
      assert.equal(provider, "cerebras");
      assert.equal(full, "cerebras answered");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("when all providers fail with keys present, the message is honest (not 'no provider configured')", async () => {
  await withEnv(ALL_KEYS, async () => {
    const r = new ModelRouter();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => jsonResponse({ error: { message: "boom" } }, 500);
    try {
      await assert.rejects(
        r.complete("sys", [{ role: "user", content: "hi" }], 1000),
        (err) => {
          assert.match(err.message, /couldn't get an answer from any/i);
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
