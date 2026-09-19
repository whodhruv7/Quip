// Tests: Quip Head Brain — the Understanding Engine (Phase 1) + planner +
// task lifecycle + device index + hub routing. Pure/deterministic everywhere:
// no model calls, no process spawns, no filesystem writes.
import test from "node:test";
import assert from "node:assert/strict";

const { buildUnderstanding } = await import("../dist-test/electron/brain/understanding.js");
const { resolveReferences } = await import("../dist-test/electron/brain/references.js");
const {
  rememberInteraction,
  conversationMemoryGet,
  conversationMemoryReset,
} = await import("../dist-test/electron/brain/conversation-memory.js");
const { buildExecutionPlan } = await import("../dist-test/electron/brain/planner.js");
const {
  TaskLifecycle,
  InvalidTransitionError,
  terminalFromResult,
  createTaskLifecycle,
} = await import("../dist-test/electron/brain/task-state.js");
const {
  buildDeviceIndexData,
  activateDeviceIndex,
  lookupDeviceApp,
  mergeDeviceIndexDiff,
  refreshDeviceIndexForTests,
} = await import("../dist-test/electron/brain/device-index.js");
const { processCommand } = await import("../dist-test/electron/brain/hub.js");
const { contextStore } = await import("../dist-test/electron/engine/context-store.js");

// ─── Phase 1 STEP 1/3 — reference resolution ─────────────────────────────────

test("references: 'close it' resolves from the last interaction's target", () => {
  const r = resolveReferences("close it", {
    last: { actedTarget: "Visual Studio Code", actedTargetType: "app" },
  });
  assert.equal(r.resolved.toLowerCase(), "close visual studio code");
  assert.equal(r.unresolved, null);
  assert.ok(r.notes[0].includes("Visual Studio Code"));
});

test("references: 'play another one' keeps the intent, moves to the next item", () => {
  const r = resolveReferences("play another one", {
    last: { actedTarget: "Mitwa", actedTargetType: "song" },
  });
  assert.match(r.resolved, /^play another song$/i);
});

test("references: 'do it again' replays the previous command", () => {
  const r = resolveReferences("do it again", {
    last: { command: "open vs code" },
  });
  assert.equal(r.resolved, "open vs code");
});

test("references: unresolved pronoun with empty memory is REPORTED, not guessed", () => {
  const r = resolveReferences("close it", {});
  assert.equal(r.unresolved, "it");
  assert.equal(r.resolved, "close it");
});

test("references: 'the file I just opened' resolves from execution context", () => {
  const r = resolveReferences("open the file I just opened", { lastOpenedPath: "C:/Users/me/report.pdf" });
  assert.ok(r.resolved.includes("report.pdf"));
});

// ─── Phase 1 STEP 2 — intent detection ───────────────────────────────────────

test("understanding: 'Open VS Code' → OPEN intent, app object, simple action", () => {
  const u = buildUnderstanding("Open VS Code");
  assert.equal(u.intents.primary.kind, "OPEN");
  assert.ok(u.intents.primary.confidence >= 0.85);
  assert.equal(u.objects[0].type, "app");
  assert.equal(u.objects[0].name, "Visual Studio Code");
  assert.equal(u.classification, "simple_action");
  assert.equal(u.isTask, true);
});

test("understanding: 'Open VS Code and run Quip' → secondary intents detected", () => {
  const u = buildUnderstanding("Open VS Code and run Quip");
  assert.equal(u.intents.primary.kind, "OPEN");
  assert.ok(u.intents.secondary.length >= 1, "expected at least one secondary intent");
});

test("understanding: 'play Mitwa' → PLAY with hidden SEARCH prerequisite", () => {
  const u = buildUnderstanding("play Mitwa");
  assert.equal(u.intents.primary.kind, "PLAY");
  assert.ok(u.intents.hidden.some((h) => h.kind === "SEARCH"));
  assert.equal(u.objects[0].type, "song");
  assert.match(u.meaning, /Play "mitwa"/i);
});

test("understanding: 'Open ChatGPT' → website object (desktop inference stays honest)", () => {
  const u = buildUnderstanding("Open ChatGPT");
  assert.equal(u.objects[0].type, "website");
  assert.equal(u.intents.primary.kind, "OPEN");
});

test("understanding: device index object resolution beats alias confidence", () => {
  refreshDeviceIndexForTests(null);
  const idx = {
    findApp: (name) => (name.toLowerCase().includes("code") ? { name: "Visual Studio Code (User)", via: "exact alias" } : null),
  };
  const u = buildUnderstanding("Open VS Code", { deviceIndex: idx });
  assert.equal(u.objects[0].confidence, 0.99);
  assert.match(u.objects[0].resolvedVia, /device index/);
  refreshDeviceIndexForTests(null);
});

// ─── Phase 1 STEP 7 — classification ─────────────────────────────────────────

test("classification: 1 step simple, 2 steps medium, 4 steps complex, chat stays chat", () => {
  const simple = buildUnderstanding("Open VS Code");
  assert.equal(simple.classification, "simple_action");

  const two = buildUnderstanding("Open VS Code and open my Quip project");
  assert.equal(two.classification, "medium_task");

  const four = buildUnderstanding("Open Chrome, go to YouTube, search for Mitwa and play it");
  assert.equal(four.classification, "complex_workflow");

  const chat = buildUnderstanding("hey, how was your day");
  assert.equal(chat.classification, "question");
});

// ─── Phase 1 STEP 9 — conversation memory ────────────────────────────────────

test("memory: remembering then referencing — 'open vs code' then 'close it' resolves", () => {
  conversationMemoryReset();
  const u1 = buildUnderstanding("open vs code");
  rememberInteraction(u1);
  const mem = conversationMemoryGet();
  const r = resolveReferences("close it", { last: mem.last });
  assert.equal(r.resolved.toLowerCase(), "close visual studio code");
  conversationMemoryReset();
});

// ─── Phase 1 — speed budget ──────────────────────────────────────────────────

test("speed: deterministic understanding completes far under the 100ms budget", () => {
  const u = buildUnderstanding("Open Chrome, go to YouTube, search for Mitwa and play it");
  assert.ok(u.timings.totalMs < 100, `took ${u.timings.totalMs}ms`);
});

// ─── Planner — explicit verification expectations (anti fake-success) ────────

test("planner: every deterministic step carries a verification expectation", () => {
  const u = buildUnderstanding("Open Chrome, go to YouTube, search for Mitwa and play it");
  const plan = buildExecutionPlan(u);
  assert.equal(plan.path, "direct");
  assert.ok(plan.steps.length === 4);
  for (const s of plan.steps) {
    assert.ok(s.verify.expect.length > 5, "each step must state what must be TRUE afterwards");
    assert.ok(s.verify.method.length > 3);
    assert.ok(s.timeoutMs > 0);
  }
  assert.equal(plan.permissionsRequired, "safe");
});

test("planner: dangerous steps escalate required permissions", () => {
  const u = buildUnderstanding("delete my notes.txt file in documents");
  const plan = buildExecutionPlan(u);
  if (plan.path === "direct" && plan.steps.some((s) => s.action === "file_op")) {
    assert.ok(plan.permissionsRequired !== "safe");
  }
});

test("planner: chat/question routes to conversation, clarify short-circuits", () => {
  const chat = buildExecutionPlan(buildUnderstanding("hey how was your day"));
  assert.equal(chat.path, "chat");

  const clarify = buildExecutionPlan(buildUnderstanding("close it", { memory: {} }));
  assert.equal(clarify.path, "clarify");
  assert.ok(clarify.expectedResult.length > 10);
});

test("planner: capability questions hit REAL tools (weather/summarize), not chat", () => {
  const weather = buildExecutionPlan(buildUnderstanding("aaj weather kya hai?"));
  assert.equal(weather.path, "agent");

  const summarize = buildExecutionPlan(buildUnderstanding("summarize this page for me"));
  assert.equal(summarize.path, "agent");

  // But plain questions stay conversational.
  const plain = buildExecutionPlan(buildUnderstanding("do you like pizza?"));
  assert.equal(plain.path, "chat");
});

// ─── Task lifecycle state machine ────────────────────────────────────────────

test("lifecycle: the happy path transitions deterministically", () => {
  const lc = createTaskLifecycle();
  lc.to("UNDERSTANDING");
  lc.to("PLANNING");
  lc.to("EXECUTING", "1 step");
  lc.to("VERIFYING");
  lc.to("COMPLETED");
  assert.equal(lc.state, "COMPLETED");
  assert.ok(lc.trace.length >= 6);
  assert.match(lc.explain(), /UNDERSTANDING @\+\d+ms → PLANNING/);
});

test("lifecycle: illegal jumps throw instead of corrupting state", () => {
  const lc = createTaskLifecycle();
  assert.throws(() => lc.to("EXECUTING"), InvalidTransitionError);
  assert.equal(lc.state, "IDLE");
});

test("lifecycle: cancellation works from any non-terminal state and is terminal", () => {
  const lc = createTaskLifecycle();
  lc.to("UNDERSTANDING");
  lc.to("PLANNING");
  lc.cancel("user pressed stop");
  assert.equal(lc.state, "CANCELLED");
  assert.throws(() => lc.to("EXECUTING"), InvalidTransitionError);
  assert.equal(lc.cancel(), "CANCELLED");
});

test("lifecycle: terminalFromResult maps results honestly", () => {
  assert.equal(terminalFromResult({ success: true }), "COMPLETED");
  assert.equal(terminalFromResult({ success: false }), "FAILED");
  assert.equal(terminalFromResult({ success: true, cancelled: true }), "CANCELLED");
});

// ─── Device Knowledge Layer ──────────────────────────────────────────────────

test("device index: scanner builds a searchable index and lookups stay in memory", async () => {
  const fakeExec = async (cmd, args) => {
    if (cmd === "where" && args[0] === "chrome.exe") return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    if (cmd === "where" && args[0] === "node.exe") return "C:\\Program Files\\nodejs\\node.exe";
    return "";
  };
  const data = await buildDeviceIndexData({
    execImpl: fakeExec,
    platform: "win32",
    home: "/tmp/fakehome-not-checked",
    apps: [
      { name: "Visual Studio Code", executable: "Code.exe", confidence: 0.95 },
      { name: "Spotify", executable: "Spotify.exe", confidence: 0.9 },
    ],
  });
  // userFolders: fake home doesn't exist — honest empty, no fabricated paths.
  assert.deepEqual(data.userFolders, {});
  assert.deepEqual(data.browsers, ["chrome"]);
  assert.equal(data.devTools.node, true);
  assert.equal(data.devTools.git, false);

  activateDeviceIndex(data);
  const hit = lookupDeviceApp("vscode");
  assert.ok(hit, "vscode should resolve");
  assert.match(hit.name, /Visual Studio Code/i);
  assert.ok(lookupDeviceApp("spotify"));
  assert.equal(lookupDeviceApp("zzz-unknown-thing"), null);
  refreshDeviceIndexForTests(null);
});

test("device index: diff refresh merges ONLY changes", async () => {
  const prev = {
    version: 1,
    updatedAt: 1,
    apps: [{ name: "A", confidence: 0.9, aliases: ["a"] }],
    browsers: ["chrome"],
    userFolders: { desktop: "/d" },
    devTools: { node: true },
  };
  const same = { ...prev, updatedAt: 2 };
  assert.equal(mergeDeviceIndexDiff(prev, same).changed, false);

  const fresh = {
    version: 1,
    updatedAt: 3,
    apps: [{ name: "A", confidence: 0.9, aliases: ["a"] }, { name: "B", confidence: 0.9, aliases: ["b"] }],
    browsers: ["chrome", "edge"],
    userFolders: { desktop: "/d" },
    devTools: { node: true },
  };
  const { merged, changed } = mergeDeviceIndexDiff(prev, fresh);
  assert.equal(changed, true);
  assert.equal(merged.apps.length, 2);
  assert.deepEqual(merged.browsers, ["chrome", "edge"]);
});

// ─── Hub routing — the full pipeline ─────────────────────────────────────────

function fakeDeps(overrides = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      deviceIndex: null,
      execContext: () => contextStore.get(),
      execute: async (cmd, opts) => {
        calls.push({ cmd, onProgress: typeof opts.onProgress === "function" });
        return {
          success: true,
          summary: `done: ${cmd}`,
          notes: [],
          stepsCompleted: 1,
          stepsTotal: 1,
        };
      },
      log: () => {},
      ...overrides,
    },
  };
}

test("hub: a task routes DIRECT with the reference-resolved command", async () => {
  conversationMemoryReset();
  const { deps, calls } = fakeDeps();
  const out = await processCommand("open vs code", deps);
  assert.equal(out.route, "direct");
  assert.equal(out.result.success, true);
  assert.match(calls[0].cmd, /visual studio code|vs code/i);
  assert.equal(out.understanding.intents.primary.kind, "OPEN");
  assert.ok(out.durationMs >= 0);
  // Memory now remembers it for the NEXT message.
  assert.ok(conversationMemoryGet().last);
  conversationMemoryReset();
});

test("hub: 'close it' after a remembered interaction resolves before executing", async () => {
  conversationMemoryReset();
  const first = await processCommand("open vs code", fakeDeps().deps);
  assert.equal(first.route, "direct");

  const { deps, calls } = fakeDeps();
  const out = await processCommand("close it", deps);
  assert.equal(out.route, "direct");
  assert.match(calls[0].cmd, /visual studio code/i);
  conversationMemoryReset();
});

test("hub: unresolved reference asks ONE clarification instead of guessing", async () => {
  conversationMemoryReset();
  const { deps, calls } = fakeDeps();
  const out = await processCommand("close it", deps);
  assert.equal(out.route, "clarify");
  assert.ok(out.clarifyQuestion.length > 10);
  assert.equal(calls.length, 0, "the executor must NOT be called when clarifying");
  conversationMemoryReset();
});

test("hub: pure conversation routes to chat without touching the executor", async () => {
  const { deps, calls } = fakeDeps();
  const out = await processCommand("you are so funny haha", deps);
  assert.equal(out.route, "chat");
  assert.equal(calls.length, 0);
  assert.equal(out.lifecycle.state, "COMPLETED");
});

test("hub: a failing executor lands the lifecycle on FAILED honestly", async () => {
  const { deps } = fakeDeps({
    execute: async () => ({
      success: false,
      summary: "couldn't open the app",
      notes: ["the app is not installed"],
      stepsCompleted: 0,
      stepsTotal: 1,
      failures: ["the app is not installed"],
    }),
  });
  const out = await processCommand("open definitely-not-installed-app xyz", deps);
  assert.equal(out.route, "direct");
  assert.equal(out.result.success, false);
  assert.equal(out.lifecycle.state, "FAILED");
});

test("hub: cancellation reaches the terminal CANCELLED state", async () => {
  const { deps } = fakeDeps({
    execute: async () => ({
      success: false,
      cancelled: true,
      summary: "stopped",
      notes: [],
      stepsCompleted: 0,
      stepsTotal: 2,
    }),
  });
  const out = await processCommand("open vs code and play mitwa", deps);
  assert.equal(out.lifecycle.state, "CANCELLED");
});

test("hub: a brain bug never crashes the pipeline (hard guarantee)", async () => {
  const out = await processCommand("open vs code", {
    deviceIndex: {
      findApp() {
        throw new Error("index exploded");
      },
    },
    execContext: () => contextStore.get(),
    execute: async () => ({ success: true, summary: "ok", notes: [], stepsCompleted: 1, stepsTotal: 1 }),
    log: () => {},
  });
  // The brain degrades to a safe route — it never throws.
  assert.ok(["direct", "agent", "chat"].includes(out.route));
});
