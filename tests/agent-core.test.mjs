// Tests: V3 agent core — provider priority (Groq-first), tool catalog,
// agent loop semantics, vision coordinate parsing, web reading recipes,
// honest failure reporting. No real provider/network calls anywhere.
import test from "node:test";
import assert from "node:assert/strict";

const { ModelRouter } = await import("../dist-test/electron/system/model-router.js");
const { TOOL_CATALOG, toolSchemas, progressFor } = await import(
  "../dist-test/electron/engine/tool-catalog.js"
);
const { executeTool, executorNames } = await import("../dist-test/electron/engine/tool-registry.js");
const { runAgentLoop } = await import("../dist-test/electron/engine/agent-loop.js");
const { parseCoords } = await import("../dist-test/electron/engine/screen-vision.js");
const { youtubeRead, redditRead, rssRead } = await import("../dist-test/electron/engine/web-reading.js");
const { permissionSystem } = await import("../dist-test/electron/engine/permission-modes.js");

// ─── Helpers ─────────────────────────────────────────────────────────────────

const KEY_ENV_KEYS = [
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "QUIP_PRIMARY_PROVIDER",
  "QUIP_GROQ_ENABLED",
  "QUIP_OPENROUTER_ENABLED",
  "GROQ_MODEL",
  "OPENROUTER_MODEL",
];

function withEnv(env, fn) {
  const saved = Object.fromEntries(KEY_ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEY_ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    for (const k of KEY_ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

function mockBrain(turns) {
  let i = 0;
  const calls = [];
  return {
    calls,
    async completeWithTools(system, history, tools) {
      calls.push({ system, historyLen: history.length });
      const t = turns[Math.min(i, turns.length - 1)];
      i++;
      return typeof t === "function" ? t({ history, tools, turn: i }) : t;
    },
  };
}

const okResult = (output = "did it") => ({ success: true, output, note: output, evidence: [] });
const failResult = (output = "it failed") => ({ success: false, output, note: output, evidence: [] });

// ─── 1. Provider priority — THE GROQ-FIRST FIX ──────────────────────────────

test("groq is PRIMARY by default when both keys exist (user's key wins)", () => {
  withEnv({ GROQ_API_KEY: "gsk_test_groq_key_1234", OPENROUTER_API_KEY: "sk-or-test-key-1234" }, () => {
    const r = new ModelRouter();
    assert.equal(r.status().primary.provider, "groq");
    assert.equal(r.status().active.provider, "groq");
    assert.equal(r.status().fallback.provider, "openrouter");
  });
});

test("openrouter is primary only when groq has no key", () => {
  withEnv({ OPENROUTER_API_KEY: "sk-or-test-key-1234" }, () => {
    const r = new ModelRouter();
    assert.equal(r.status().primary.provider, "openrouter");
    assert.equal(r.status().fallback, null);
  });
});

test("QUIP_GROQ_ENABLED=0 removes groq from the chain entirely", () => {
  withEnv(
    { GROQ_API_KEY: "gsk_test_groq_key_1234", OPENROUTER_API_KEY: "sk-or-test-key-1234", QUIP_GROQ_ENABLED: "0" },
    () => {
      const r = new ModelRouter();
      assert.equal(r.status().primary.provider, "openrouter");
      assert.equal(r.status().fallback, null);
    }
  );
});

test("QUIP_OPENROUTER_ENABLED=0 leaves groq alone on duty", () => {
  withEnv(
    { GROQ_API_KEY: "gsk_test_groq_key_1234", OPENROUTER_API_KEY: "sk-or-test-key-1234", QUIP_OPENROUTER_ENABLED: "0" },
    () => {
      const r = new ModelRouter();
      assert.equal(r.status().primary.provider, "groq");
      assert.equal(r.status().fallback, null);
    }
  );
});

test("explicit QUIP_PRIMARY_PROVIDER=openrouter still wins over the default", () => {
  withEnv(
    { GROQ_API_KEY: "gsk_test_groq_key_1234", OPENROUTER_API_KEY: "sk-or-test-key-1234", QUIP_PRIMARY_PROVIDER: "openrouter" },
    () => {
      const r = new ModelRouter();
      assert.equal(r.status().primary.provider, "openrouter");
    }
  );
});

test("reload() re-reads the environment — settings changes need no restart", () => {
  withEnv({ OPENROUTER_API_KEY: "sk-or-test-key-1234" }, () => {
    const r = new ModelRouter();
    assert.equal(r.status().primary.provider, "openrouter");
    process.env.GROQ_API_KEY = "gsk_added_live_key_999";
    r.reload();
    assert.equal(r.status().primary.provider, "groq");
    delete process.env.GROQ_API_KEY;
    r.reload();
    assert.equal(r.status().primary.provider, "openrouter");
  });
});

test("vision model follows the active chain — groq llama-4 first", () => {
  withEnv({ GROQ_API_KEY: "gsk_test_groq_key_1234" }, () => {
    const r = new ModelRouter();
    assert.match(r.activeVisionModel(), /llama-4-scout/);
  });
  withEnv({ OPENROUTER_API_KEY: "sk-or-test-key-1234" }, () => {
    const r = new ModelRouter();
    assert.match(r.activeVisionModel(), /qwen/);
  });
});

// ─── 2. Tool catalog ↔ registry integrity ────────────────────────────────────

test("every catalog tool has a REAL executor — nothing model-facing is fake", () => {
  const names = executorNames();
  for (const entry of TOOL_CATALOG) {
    assert.ok(
      names.includes(entry.schema.function.name),
      `catalog tool "${entry.schema.function.name}" has no executor`
    );
  }
});

test("critical new capabilities are in the catalog", () => {
  const names = TOOL_CATALOG.map((t) => t.schema.function.name);
  for (const required of [
    "open_app", "open_website", "play_media", "read_page", "file_op",
    "screen_observe", "screen_click_element", "screen_type_into",
    "run_command", "youtube_read", "reddit_read", "rss_read", "app_list",
    "clipboard", "press_key", "scroll",
  ]) {
    assert.ok(names.includes(required), `missing critical tool: ${required}`);
  }
});

test("tool schemas are valid OpenAI function shapes with string params", () => {
  for (const schema of toolSchemas()) {
    assert.equal(schema.type, "function");
    assert.ok(schema.function.name.length > 0);
    assert.ok(schema.function.description.length > 10);
    for (const prop of Object.values(schema.function.parameters.properties)) {
      assert.equal(prop.type, "string");
    }
  }
});

test("progressFor gives every tool a friendly progress line", () => {
  assert.equal(progressFor("open_app"), "Opening app…");
  assert.equal(progressFor("no_such_tool"), "Working…");
});

// ─── 3. Agent loop semantics ─────────────────────────────────────────────────

test("pure-conversation goal → isChat, no tools, chatReply returned", async () => {
  const brain = mockBrain([{ content: "Hey! I'm Quip 🦎", toolCalls: [] }]);
  const r = await runAgentLoop({
    goal: "hi how are you",
    platform: "win32",
    brain,
    executor: async () => { throw new Error("must not execute tools"); },
  });
  assert.equal(r.isChat, true);
  assert.equal(r.chatReply, "Hey! I'm Quip 🦎");
  assert.equal(r.toolsUsed.length, 0);
});

test("multi-step goal → tools execute in order, results fed back, honest summary", async () => {
  const brain = mockBrain([
    { content: "", toolCalls: [{ id: "c1", name: "open_website", arguments: '{"url":"https://gmail.com"}' }] },
    { content: "", toolCalls: [{ id: "c2", name: "screen_click_element", arguments: '{"element":"the Compose button"}' }] },
    { content: "Done — Gmail is open and I clicked Compose.", toolCalls: [] },
  ]);
  const executed = [];
  const r = await runAgentLoop({
    goal: "open gmail and click compose",
    platform: "win32",
    brain,
    executor: async (action) => {
      executed.push(action);
      return okResult(`${action} verified`);
    },
  });
  assert.deepEqual(executed, ["open_website", "screen_click_element"]);
  assert.equal(r.isChat, false);
  assert.equal(r.success, true);
  assert.equal(r.failures.length, 0);
  assert.equal(r.summary.includes("Done"), true);
  // The final assistant turn must have seen BOTH tool results (history grows).
  assert.ok(brain.calls[2].historyLen >= 5);
});

test("failed tool → failures[] carries a plain-language reason, success=false", async () => {
  const brain = mockBrain([
    { content: "", toolCalls: [{ id: "c1", name: "open_app", arguments: '{"query":"photoshop"}' }] },
    { content: "", toolCalls: [] },
  ]);
  const r = await runAgentLoop({
    goal: "open photoshop",
    platform: "win32",
    brain,
    executor: async () => failResult("I couldn't find an installed app called \"photoshop\"."),
  });
  assert.equal(r.success, false);
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /couldn't find an installed app/);
  assert.equal(r.summary.includes("couldn't complete"), true);
});

test("malformed tool arguments are handled honestly, not crashed on", async () => {
  const brain = mockBrain([
    { content: "", toolCalls: [{ id: "c1", name: "open_app", arguments: "{not json at all" }] },
    { content: "", toolCalls: [] },
  ]);
  const seen = [];
  const r = await runAgentLoop({
    goal: "open something",
    platform: "win32",
    brain,
    executor: async (action, step) => {
      seen.push({ action, params: step.params });
      return okResult();
    },
  });
  assert.deepEqual(seen[0].params, {}); // parsed = {} — no crash
  assert.equal(r.success, true);
});

test("dangerous tool (run_command) always requires approval — declined means nothing ran", async () => {
  permissionSystem.setMode("full_access");
  permissionSystem.onApprovalRequested = (req) => permissionSystem.resolveApproval(req.id, false);
  const brain = mockBrain([
    { content: "", toolCalls: [{ id: "c1", name: "run_command", arguments: '{"command":"echo hello"}' }] },
    { content: "", toolCalls: [] },
  ]);
  let executed = false;
  const r = await runAgentLoop({
    goal: "run echo hello",
    platform: "win32",
    brain,
    executor: async () => { executed = true; return okResult(); },
  });
  assert.equal(executed, false);
  assert.equal(r.success, false);
  assert.match(r.failures[0], /declined/i);
  permissionSystem.onApprovalRequested = undefined;
});

test("cancellation between turns stops the loop and reports honestly", async () => {
  const signal = { aborted: false };
  const brain = mockBrain([
    { content: "", toolCalls: [{ id: "c1", name: "open_website", arguments: '{"url":"https://example.com"}' }] },
  ]);
  const r = await runAgentLoop({
    goal: "do a thing",
    platform: "win32",
    brain,
    signal,
    executor: async () => {
      signal.aborted = true; // user hits Stop mid-task
      return okResult();
    },
  });
  assert.equal(r.cancelled, true);
  assert.equal(r.toolsUsed.length, 1); // first step completed before the abort
});

test("budget cap stops runaway loops", async () => {
  const brain = mockBrain([
    { content: "", toolCalls: [{ id: `c`, name: "open_website", arguments: '{"url":"https://example.com"}' }] },
  ]); // always answers with the same tool call — would loop forever
  const r = await runAgentLoop({
    goal: "loop forever",
    platform: "win32",
    brain,
    budgetMs: 120,
    executor: async () => okResult(),
  });
  assert.ok(r.durationMs < 30_000);
  // The budget check runs at the top of each turn — with instant mocks a few
  // extra turns fit in 120ms. What matters: it STOPPED (finite), quickly.
  assert.ok(r.toolsUsed.length >= 1 && r.toolsUsed.length <= 40, `stopped, ran ${r.toolsUsed.length}`);
});

// ─── 4. Vision coordinate parsing (Skales contract) ─────────────────────────

test("parseCoords accepts the strict vision JSON contract", () => {
  assert.deepEqual(parseCoords('{"x":123,"y":456}'), { x: 123, y: 456 });
  assert.deepEqual(parseCoords('here: {"x":10.4,"y":20.6} done'), { x: 10, y: 21 });
  assert.equal(parseCoords('{"x":-1,"y":-1}'), null);
  assert.equal(parseCoords('{"x":0,"y":0}'), null); // 0,0 = refusal sentinel too
  assert.equal(parseCoords("no json here"), null);
  assert.equal(parseCoords('{"x":"abc","y":"def"}'), null);
});

// ─── 5. Web reading (Agent-Reach recipes) — mocked fetch ────────────────────

const realFetch = globalThis.fetch;

test("youtube video URL reads real oEmbed metadata", async () => {
  globalThis.fetch = async (url) => {
    assert.ok(String(url).includes("youtube.com/oembed"));
    return {
      ok: true,
      text: async () => JSON.stringify({ title: "Mitwa Reprise", author_name: "SomeChannel" }),
    };
  };
  const r = await youtubeRead("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(r.ok, true);
  assert.match(r.summary, /Mitwa Reprise/);
  globalThis.fetch = realFetch;
});

test("youtube search query reads the results page via the reader", async () => {
  globalThis.fetch = async (url) => {
    assert.ok(String(url).includes("r.jina.ai"));
    return { ok: true, text: async () => "Mitwa — official video\n10M views\nAnother result" };
  };
  const r = await youtubeRead("mitwa song");
  assert.equal(r.ok, true);
  assert.match(r.summary, /Mitwa — official video/);
  globalThis.fetch = realFetch;
});

test("youtube failure is honest — never a fake success", async () => {
  globalThis.fetch = async () => { throw new Error("http-404"); };
  const r = await youtubeRead("https://www.youtube.com/watch?v=privatevideo1");
  assert.equal(r.ok, false);
  assert.match(r.summary, /couldn't read/i);
  globalThis.fetch = realFetch;
});

test("reddit hot posts parse from the public JSON API", async () => {
  globalThis.fetch = async (url) => {
    assert.ok(String(url).includes("reddit.com/r/node/hot.json"));
    return {
      ok: true,
      text: async () =>
        JSON.stringify({
          data: {
            children: [
              { data: { title: "Node 24 released", subreddit: "node", score: 512, permalink: "/r/node/comments/abc/" } },
              { data: { title: "Help with streams", subreddit: "node", score: 8, permalink: "/r/node/comments/def/" } },
            ],
          },
        }),
    };
  };
  const r = await redditRead("node");
  assert.equal(r.ok, true);
  assert.match(r.summary, /Node 24 released/);
  assert.match(r.summary, /r\/node/);
  globalThis.fetch = realFetch;
});

test("rss feeds parse entries without any dependency", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    text: async () =>
      `<rss><channel><item><title>Post One</title><link>https://blog.example/1</link></item>` +
      `<item><title><![CDATA[Post Two]]></title><link>https://blog.example/2</link></item></channel></rss>`,
  });
  const r = await rssRead("https://blog.example/feed.xml");
  assert.equal(r.ok, true);
  assert.match(r.summary, /Post One/);
  assert.match(r.summary, /Post Two/);
  globalThis.fetch = realFetch;
});

test("rss blocks private/loopback URLs (SSRF guard) without dialing", async () => {
  let dialed = false;
  globalThis.fetch = async () => { dialed = true; return { ok: true, text: async () => "" }; };
  const r = await rssRead("http://127.0.0.1:8080/feed");
  assert.equal(r.ok, false);
  assert.equal(dialed, false);
  globalThis.fetch = realFetch;
});

test("empty inputs fail with guidance, not crashes", async () => {
  const y = await youtubeRead("");
  assert.equal(y.ok, false);
  const rd = await redditRead("");
  assert.equal(rd.ok, false);
});

// ─── 6. run_command — real, gated, deny-listed ───────────────────────────────

test("deny-listed catastrophic commands are refused even with approval", async () => {
  const r = await executeTool("run_command", { action: "run_command", params: { command: "format C:" } }, { platform: "win32" });
  assert.equal(r.success, false);
  assert.match(r.output, /won't run/);
});

test("empty command is refused honestly", async () => {
  const r = await executeTool("run_command", { action: "run_command", params: {} }, { platform: "win32" });
  assert.equal(r.success, false);
});

test("a real harmless command runs and returns real output (sandbox-verified)", async () => {
  const r = await executeTool("run_command", { action: "run_command", params: { command: "echo quip-live-9137" } }, { platform: process.platform });
  assert.equal(r.success, true);
  assert.match(r.output, /quip-live-9137/);
});

// ─── 7. run_command risk gating ──────────────────────────────────────────────

test("run_command is DANGEROUS in the risk map — approval always", async () => {
  const { riskForStep } = await import("../dist-test/electron/engine/permission-modes.js");
  assert.equal(riskForStep("run_command", { command: "anything" }), "dangerous");
  assert.equal(riskForStep("screen_observe", {}), "safe");
  assert.equal(riskForStep("screen_click_element", {}), "medium");
  assert.equal(riskForStep("youtube_read", {}), "safe");
});

// ─── 8. Orchestrator escalation wiring ───────────────────────────────────────

test("task-shaped message the parser misses goes to the agent loop, not silent chat", async () => {
  const { parseIntentV2 } = await import("../dist-test/electron/engine/intent-parser-v2.js");
  const { bindAgentBrain } = await import("../dist-test/electron/engine/agent-loop.js");
  const { orchestrator } = await import("../dist-test/electron/engine/orchestrator.js");

  // Pick a command the deterministic parser classifies as chat today — the
  // test adapts automatically if parser coverage changes.
  const candidates = [
    "copy whatever is on my screen into a file for me please",
    "look at my screen and note down what you see somewhere",
    "mera pura setup check karke ek report bana de",
  ];
  const cmd = candidates.find((c) => parseIntentV2(c).isTask === false);
  assert.ok(cmd, "expected at least one chat-classified candidate");

  const brain = mockBrain([
    { content: "", toolCalls: [{ id: "w1", name: "app_list", arguments: "{}" }] },
    { content: "Done — noted the installed apps.", toolCalls: [] },
  ]);
  bindAgentBrain(brain);

  const result = await orchestrator.execute(cmd, {
    platform: process.platform,
    workspacePath: process.cwd(),
  });

  // Escalation ran: notes came back from a REAL tool execution (the pure
  // chat path returns notes: []). The real app_list executor ran in-sandbox.
  const ranAgent = (result.notes && result.notes.length > 0) || (result.failures && result.failures.length > 0) || (result.summary ?? "").length > 0;
  assert.equal(ranAgent, true);
  assert.ok(brain.calls.length >= 1, "the agent brain was consulted");
});
