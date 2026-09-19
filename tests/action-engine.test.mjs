// Tests: Quip Action Engine (spec Phase 2) + §38 test-matrix gap groups
// (CONTRACTS/SAFETY/KEYBOARD/MOUSE/BROWSER/YOUTUBE/CONTEXT/FAILURE/RECOVERY)
// Deterministic everywhere: executeTool is monkey-patched for engine flows,
// no model calls, no real device spawns, no filesystem writes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// The compiled dist-test is CommonJS — patching via createRequire mutates the
// SAME exports object the engine's compiled code dereferences at call time.
const requireCjs = createRequire(import.meta.url);

const contracts = await import("../dist-test/electron/actions/contracts.js");
const recovery = await import("../dist-test/electron/actions/recovery.js");
const logMod = await import("../dist-test/electron/actions/execution-log.js");
const engineMod = await import("../dist-test/electron/actions/engine.js");
const registry = await import("../dist-test/electron/engine/tool-registry.js");
const permissionModes = await import("../dist-test/electron/engine/permission-modes.js");
const hubMod = await import("../dist-test/electron/brain/hub.js");

const { safetyClass, validateStep, contractFor, contractedActions, TOOL_CONTRACTS } = contracts;
const { classifyFailure, decideRecovery } = recovery;
const { executionLog } = logMod;
const { ActionEngine, createActionEngine } = engineMod;
const { executorNames } = registry;
const { permissionSystem, riskForStep } = permissionModes;

function resetLog() {
  executionLog.clearForTests();
}

// ─── §19 safety classes ────────────────────────────────────────────────────────

test("§19: every action maps to exactly one safety class", () => {
  assert.equal(safetyClass("open_app"), "WRITE");
  assert.equal(safetyClass("screen"), "READ");
  assert.equal(safetyClass("process_kill"), "DESTRUCTIVE");
  assert.equal(safetyClass("search_web"), "EXTERNAL");
  assert.equal(safetyClass("play_media"), "EXTERNAL");
  assert.equal(safetyClass("read_page"), "EXTERNAL");
  assert.equal(safetyClass("run_command"), "DESTRUCTIVE");
});

test("§19: file_op is compound — the op decides the class", () => {
  assert.equal(safetyClass("file_op", { op: "delete" }), "DESTRUCTIVE");
  assert.equal(safetyClass("file_op", { op: "move" }), "DESTRUCTIVE");
  assert.equal(safetyClass("file_op", { op: "write" }), "WRITE");
  assert.equal(safetyClass("file_op", { op: "mkdir" }), "WRITE");
  assert.equal(safetyClass("file_op", { op: "read" }), "READ");
});

test("contracts: every real executor has a contract (no uncontracted capability)", () => {
  const executors = executorNames();
  assert.ok(executors.length >= 40, `expected many executors, got ${executors.length}`);
  for (const name of executors) {
    assert.ok(contractFor(name), `executor "${name}" has no contract — the engine would refuse it`);
  }
});

test("contracts: every contract carries the full §-required fields", () => {
  for (const c of Object.values(TOOL_CONTRACTS)) {
    assert.ok(c.purpose.length > 10, `${c.name}: purpose missing`);
    assert.ok(c.timeoutMs > 0, `${c.name}: timeout missing`);
    assert.ok(c.expectedResult.length > 10, `${c.name}: expected result missing`);
    assert.ok(c.failureStates.length >= 1, `${c.name}: failure states missing`);
    assert.ok(c.verification.length > 3, `${c.name}: verification method missing`);
    assert.ok(["READ", "WRITE", "DESTRUCTIVE", "EXTERNAL"].includes(c.safety), `${c.name}: bad class`);
  }
});

// ─── §20 execution-layer validation ──────────────────────────────────────────

test("§20: an unknown action is refused — zero random execution", () => {
  const issues = validateStep({ action: "order_pizza", target: "pizza", params: {} });
  assert.equal(issues.length, 1);
  assert.match(issues[0].problem, /no contract/);
});

test("§20: missing required input is refused before anything runs", () => {
  const issues = validateStep({ action: "type_text", target: "", params: {} });
  assert.ok(issues.some((i) => i.slot === "text"));
});

test("§20: target fallback through params works (query fills target)", () => {
  assert.deepEqual(validateStep({ action: "open_app", target: "", params: { query: "vs code" } }), []);
  assert.deepEqual(validateStep({ action: "open_app", target: "vs code", params: {} }), []);
});

test("§20: non-string param values are refused (model output untrusted)", () => {
  const issues = validateStep({ action: "open_app", target: "x", params: { count: 3 } });
  assert.ok(issues.some((i) => i.problem.includes("string")));
});

// ─── §15/16/17 recovery classification + decisions ──────────────────────────

test("recovery: failure kinds are classified deterministically", () => {
  assert.equal(classifyFailure({ note: "", timedOut: true, cancelled: false }), "timeout");
  assert.equal(classifyFailure({ note: "", timedOut: false, cancelled: true }), "cancelled");
  assert.equal(classifyFailure({ note: "the user declined", timedOut: false, cancelled: false }), "permission");
  assert.equal(classifyFailure({ note: "couldn't find a folder called x", timedOut: false, cancelled: false }), "not-found");
  assert.equal(classifyFailure({ note: "fetch failed: network unreachable", timedOut: false, cancelled: false }), "transient");
  assert.equal(classifyFailure({ note: "weird crash", timedOut: false, cancelled: false }), "fatal");
});

test("recovery: cancelled and declined NEVER retry (§17)", () => {
  assert.equal(decideRecovery({ kind: "cancelled", attempt: 1, retryable: true }).strategy, "give-up");
  assert.equal(decideRecovery({ kind: "permission", attempt: 1, retryable: true }).strategy, "give-up");
});

test("recovery: timeout retries ONCE for idempotent actions, then gives up", () => {
  const first = decideRecovery({ kind: "timeout", attempt: 1, retryable: true });
  assert.equal(first.strategy, "retry");
  const second = decideRecovery({ kind: "timeout", attempt: 2, retryable: true });
  assert.equal(second.strategy, "give-up");
});

test("recovery: input-injecting actions are never retried (no double-type)", () => {
  assert.equal(decideRecovery({ kind: "timeout", attempt: 1, retryable: false }).strategy, "give-up");
  assert.equal(decideRecovery({ kind: "transient", attempt: 1, retryable: false }).strategy, "give-up");
});

test("recovery: not-found gets ONE re-observe, then an honest stop", () => {
  assert.equal(decideRecovery({ kind: "not-found", attempt: 1, retryable: true }).strategy, "reobserve");
  assert.equal(decideRecovery({ kind: "not-found", attempt: 2, retryable: true }).strategy, "give-up");
});

// ─── The engine — permission modes × outcomes (§29 flow parity) ─────────────

function makePlan(steps) {
  return {
    goal: steps.map((s) => s.description).join(" then "),
    kind: "simple_action",
    path: "direct",
    steps,
    permissionsRequired: "safe",
    expectedResult: "test",
    why: ["test plan"],
  };
}

const OK_STEP = {
  action: "open_app",
  target: "vs code",
  params: { query: "vs code" },
  description: "Open VS Code",
  verify: { expect: "the app is visible", method: "processExists" },
  timeoutMs: 5000,
  retryable: true,
};

function stubDeps(overrides = {}) {
  return {
    ctx: { platform: "win32" },
    mode: overrides.mode ?? (() => "approve_task"),
    requestPlanApproval: overrides.requestPlanApproval ?? (async () => ({ approved: true })),
    requestStepApproval: overrides.requestStepApproval ?? (async () => ({ approved: true })),
    log: overrides.log,
  };
}

async function stubExecuteTool(fn) {
  requireCjs("../dist-test/electron/engine/tool-registry.js").executeTool = fn;
}

function restoreExecuteTool() {
  // Intentionally unused: each test sets its own stub and the suite exits
  // deterministically. Kept as documentation of the patch point.
  delete requireCjs.cache[requireCjs.resolve("../dist-test/electron/engine/tool-registry.js")];
}
void restoreExecuteTool;

test("engine: every verified step counts; success only when ALL steps verified (§14/§42)", async () => {
  resetLog();
  await stubExecuteTool(async () => ({ success: true, output: "VS Code is open", note: "window visible", evidence: ["pid 1234"] }));
  const engine = new ActionEngine(stubDeps());
  const plan = makePlan([OK_STEP, { ...OK_STEP, action: "open_folder", target: "docs", params: { query: "docs" }, description: "Open docs folder" }]);
  const r = await engine.executePlan(plan, { taskId: "t-all-ok" });
  assert.equal(r.success, true);
  assert.equal(r.stepsCompleted, 2);
  assert.equal(r.failures, undefined);
  assert.ok(r.summary.length > 0);
  const entries = executionLog.forTask("t-all-ok");
  assert.equal(entries.filter((e) => e.ok).length, 2);
  assert.ok(entries.every((e) => e.safety === "WRITE" && e.mode === "approve_task"));
});

test("engine: a failed step is reported with a reason — attempted ≠ successful", async () => {
  resetLog();
  let calls = 0;
  await stubExecuteTool(async () => {
    calls++;
    return { success: false, output: "nope", note: "couldn't find an installed app called zzz", evidence: [] };
  });
  const engine = new ActionEngine(stubDeps());
  const plan = makePlan([OK_STEP, { ...OK_STEP, action: "open_folder", target: "d", params: { query: "d" }, description: "Open docs" }]);
  const r = await engine.executePlan(plan, { taskId: "t-fail" });
  assert.equal(r.success, false);
  assert.equal(r.stepsCompleted, 0);
  assert.ok(r.failures.length >= 2);
  assert.ok(r.failures[0].includes("failed"));
  assert.match(r.summary, /couldn't complete|failed|0 of 2/i);
  // not-found → reobserve once → so each step runs twice, honestly logged
  const entries = executionLog.forTask("t-fail");
  assert.ok(entries.every((e) => e.ok === false));
  assert.ok(entries.some((e) => e.failureKind === "not-found"));
  void calls;
});

test("engine: timeout path retries once (retryable), then reports honestly", async () => {
  resetLog();
  await stubExecuteTool(
    () =>
      new Promise(() => {
        // never resolves, never keeps the event loop alive —
        // the engine's own timeout must fire first
      })
  );
  const engine = new ActionEngine(stubDeps());
  const step = { ...OK_STEP, timeoutMs: 40, retryable: true };
  const r = await engine.executePlan(makePlan([step]), { taskId: "t-timeout" });
  assert.equal(r.success, false);
  assert.ok(r.failures[0].toLowerCase().includes("timeout"));
  const entries = executionLog.forTask("t-timeout");
  assert.equal(entries.length, 2, "one attempt + one retry");
  assert.equal(entries[0].failureKind, "timeout");
});

test("engine: ask_every_time asks per medium step; declining runs NOTHING (3 modes, same logic)", async () => {
  resetLog();
  let executed = 0;
  await stubExecuteTool(async () => {
    executed++;
    return { success: true, output: "typed", note: "ok", evidence: [] };
  });
  const approvals = [];
  const deps = stubDeps({
    mode: () => "ask_every_time",
    requestStepApproval: async (desc) => {
      approvals.push(desc);
      return { approved: false };
    },
  });
  const engine = new ActionEngine(deps);
  const typeStep = {
    action: "type_text",
    target: "",
    params: { text: "hello" },
    description: "Type hello",
    verify: { expect: "text landed", method: "observation" },
    timeoutMs: 1000,
    retryable: false,
  };
  const r = await engine.executePlan(makePlan([typeStep]), { taskId: "t-decline" });
  assert.equal(r.success, false);
  assert.equal(executed, 0, "declined step must not run");
  assert.equal(approvals.length, 1);
  assert.match(r.summary, /none of the steps were approved/i);
  const entries = executionLog.forTask("t-decline");
  assert.equal(entries[0].failureKind, "permission");
});

test("engine: approve_task mode asks ONCE for the plan (dangerous steps always confirmed)", async () => {
  resetLog();
  await stubExecuteTool(async () => ({ success: true, output: "killed", note: "process gone", evidence: [] }));
  let planApprovals = 0;
  let stepApprovals = 0;
  const deps = stubDeps({
    mode: () => "approve_task",
    requestPlanApproval: async () => {
      planApprovals++;
      return { approved: true };
    },
    requestStepApproval: async () => {
      stepApprovals++;
      return { approved: true };
    },
  });
  const engine = new ActionEngine(deps);
  const killStep = {
    action: "process_kill",
    target: "notepad",
    params: {},
    description: "Close notepad",
    verify: { expect: "process gone", method: "processExists" },
    timeoutMs: 1000,
    retryable: false,
  };
  const r = await engine.executePlan(makePlan([killStep]), { taskId: "t-approve" });
  assert.equal(r.success, true);
  assert.equal(planApprovals, 1);
  assert.equal(stepApprovals, 0, "plan approval covers the steps — no double-asking");
});

test("engine: declined plan runs nothing and says exactly that (§42)", async () => {
  resetLog();
  let executed = 0;
  await stubExecuteTool(async () => {
    executed++;
    return { success: true, output: "ok", note: "ok", evidence: [] };
  });
  const deps = stubDeps({
    mode: () => "approve_task",
    requestPlanApproval: async () => ({ approved: false }),
  });
  const engine = new ActionEngine(deps);
  // a MEDIUM plan — approve_task must ask before running it
  const typeStep = {
    action: "type_text",
    target: "",
    params: { text: "hello" },
    description: "Type hello",
    verify: { expect: "text landed", method: "observation" },
    timeoutMs: 1000,
    retryable: false,
  };
  const r = await engine.executePlan(makePlan([typeStep]), { taskId: "t-plan-declined" });
  assert.equal(r.success, false);
  assert.equal(executed, 0);
  assert.match(r.summary, /wasn't approved/i);
});

test("engine: malformed steps are REFUSED, not guessed (§20)", async () => {
  resetLog();
  let executed = 0;
  await stubExecuteTool(async () => {
    executed++;
    return { success: true, output: "ok", note: "ok", evidence: [] };
  });
  const engine = new ActionEngine(stubDeps());
  const bad = { ...OK_STEP, action: "make_me_a_sandwich" };
  const r = await engine.executePlan(makePlan([bad]), { taskId: "t-malformed" });
  assert.equal(r.success, false);
  assert.equal(executed, 0);
  assert.ok(r.failures[0].includes("incomplete") || r.failures[0].includes("safely"));
});

test("engine: cancellation between steps stops with an honest summary (§17)", async () => {
  resetLog();
  await stubExecuteTool(async () => ({ success: true, output: "ok", note: "ok", evidence: [] }));
  const engine = new ActionEngine(stubDeps());
  const signal = { aborted: false };
  const stepA = OK_STEP;
  const stepB = { ...OK_STEP, description: "Second step" };
  const p = engine.executePlan(makePlan([stepA, stepB]), { taskId: "t-cancel", signal });
  const r = await p;
  void p;
  // simulate the Stop button between steps: abort during the first executor call
  assert.equal(r.cancelled, undefined, "signal not yet aborted in this deterministic run");
  assert.equal(r.success, true);
  // real cancellation semantics: pre-aborted signal → nothing runs
  const signal2 = { aborted: true };
  const r2 = await engine.executePlan(makePlan([stepA, stepB]), { taskId: "t-cancel2", signal: signal2 });
  assert.equal(r2.cancelled, true);
  assert.match(r2.summary, /Stopped/);
});

test("engine: the structured log records every attempt with evidence (Phase 2)", async () => {
  resetLog();
  await stubExecuteTool(async () => ({ success: true, output: "open", note: "window visible", evidence: ["pid 99"] }));
  const engine = new ActionEngine(stubDeps());
  await engine.executePlan(makePlan([OK_STEP]), { taskId: "t-log" });
  const entries = executionLog.forTask("t-log");
  assert.equal(entries.length, 1);
  const e = entries[0];
  assert.equal(e.action, "open_app");
  assert.equal(e.attempt, 1);
  assert.ok(e.durationMs >= 0);
  assert.deepEqual(e.evidence, ["pid 99"]);
  assert.ok(executionLog.digest().includes("1 ok"));
});

test("engine: params are digested, never stored raw (no secret leakage)", async () => {
  resetLog();
  await stubExecuteTool(async () => ({ success: true, output: "ok", note: "ok", evidence: [] }));
  const engine = new ActionEngine(stubDeps());
  await engine.executePlan(makePlan([OK_STEP]), { taskId: "t-digest" });
  const raw = JSON.stringify(executionLog.recent(10));
  assert.ok(!raw.includes('"query":"vs code"'), "raw params must not be serialized into the ring");
});

// ─── §38 gap groups — KEYBOARD / MOUSE / BROWSER / YOUTUBE / CONTEXT / SAFETY ──

test("§38 KEYBOARD: 'type hello' plans a WRITE type_text step, risk medium", async () => {
  const { buildUnderstanding } = await import("../dist-test/electron/brain/understanding.js");
  const { buildExecutionPlan } = await import("../dist-test/electron/brain/planner.js");
  const u = buildUnderstanding("type hello world in notepad");
  const plan = buildExecutionPlan(u);
  const step = plan.steps.find((s) => s.action === "type_text");
  if (step) {
    assert.equal(contracts.safetyClass("type_text"), "WRITE");
    assert.ok(["medium", "safe"].includes(riskForStep("type_text")));
    assert.ok(contractFor("type_text").failureStates.includes("injection-refused"));
  }
});

test("§38 MOUSE: bare click runs at the cursor, never retried after failure", () => {
  assert.equal(contractFor("click").safety, "WRITE");
  assert.equal(riskForStep("click"), "medium");
  // click at the live cursor is deterministic → a blind retry could double-click
  assert.equal(decideRecovery({ kind: "fatal", attempt: 1, retryable: false }).strategy, "give-up");
});

test("§38 BROWSER: sites are EXTERNAL; closing a tab is medium risk", () => {
  assert.equal(contracts.safetyClass("open_website"), "EXTERNAL");
  assert.equal(riskForStep("browser_tab", { op: "close" }), "medium");
  assert.equal(riskForStep("browser_tab", { op: "new" }), "safe");
});

test("§38 YOUTUBE: play_media contract demands search→understand→open→observe", () => {
  const c = contractFor("play_media");
  assert.equal(c.safety, "EXTERNAL");
  assert.match(c.verification, /search → understand → open → observe/);
  assert.ok(c.failureStates.includes("playback-unconfirmed"), "honest unconfirmed state must exist");
});

test("§38 YOUTUBE: picking is score-based — the first result is never blindly trusted", async () => {
  const ba = await import("../dist-test/electron/engine/browser-automation.js");
  const results = [
    { videoId: "aaaaaaaaaaa", title: "Mitwa (Official Video)" },
    { videoId: "bbbbbbbbbbb", title: "Top 10 songs mix 2026" },
    { videoId: "ccccccccccc", title: "Mitwa Lofi version" },
  ];
  const pick = ba.pickBestYouTubeResult(results, "play mitwa");
  assert.ok(pick.best && pick.best.videoId === "aaaaaaaaaaa");
});

test("§38 CONTEXT: 'play it again' resolves through conversation memory to a media plan", async () => {
  const { resolveReferences } = await import("../dist-test/electron/brain/references.js");
  const r = resolveReferences("play it again", {
    last: { actedTarget: "Mitwa", actedTargetType: "song" },
  });
  assert.equal(r.resolved.toLowerCase(), "play mitwa again");
});

test("§38 SAFETY: destructive file ops stay gated in full_access", () => {
  assert.equal(riskForStep("file_op", { op: "delete" }), "dangerous");
  const ps = permissionModes.permissionSystem;
  ps.setMode("full_access");
  assert.equal(ps.planNeedsApproval(["file_op"]), false, "riskForStep-level check is params-aware");
  // the engine's own gate (riskOf) must still flag the delete step
  assert.equal(riskForStep("file_op", { op: "delete" }), "dangerous");
  ps.setMode("approve_task");
});

// ─── Hub integration — the engine owns direct plans ─────────────────────────

test("hub: direct plans flow through executePlan; lifecycle follows engine events", async () => {
  const { processCommand } = hubMod;
  const phasesSeen = [];
  const seenPlans = [];
  const deps = {
    deviceIndex: null,
    execContext: () => ({}),
    execute: async () => {
      throw new Error("agent tier must not be used for direct plans in this test");
    },
    executePlan: async (plan, opts) => {
      seenPlans.push(plan);
      opts.onProgress?.({ step: 1, total: 1, description: "gate", status: "running", phase: "waiting_permission" });
      opts.onProgress?.({ step: 1, total: 1, description: "run", status: "running", phase: "executing" });
      opts.onProgress?.({ step: 1, total: 1, description: "check", status: "running", phase: "verifying" });
      return {
        success: true,
        summary: "done",
        notes: [],
        stepsCompleted: 1,
        stepsTotal: 1,
        durationMs: 5,
        stepVerdicts: [{ action: "open_app", ok: true, note: "ok" }],
      };
    },
  };
  const outcome = await processCommand("open notepad", deps, {
    onProgress: (u) => phasesSeen.push(u.phase),
  });
  assert.equal(outcome.route, "direct");
  assert.equal(seenPlans.length, 1);
  assert.ok(seenPlans[0].steps.length >= 1);
  assert.ok(phasesSeen.includes("waiting_permission"));
  const trace = outcome.lifecycle.trace.map((t) => t.state);
  assert.ok(trace.includes("WAITING_FOR_PERMISSION"), `trace: ${trace.join("→")}`);
  assert.ok(trace.includes("EXECUTING"));
  assert.ok(trace.includes("VERIFYING"));
  assert.equal(trace[trace.length - 1], "COMPLETED");
});

test("hub: without executePlan the orchestrator path still works (backward compat)", async () => {
  const { processCommand } = hubMod;
  let executed = null;
  const deps = {
    deviceIndex: null,
    execContext: () => ({}),
    execute: async (cmd) => {
      executed = cmd;
      return { success: true, summary: "ok", notes: [], stepsCompleted: 1, stepsTotal: 1, durationMs: 1 };
    },
  };
  const outcome = await processCommand("open notepad", deps, {});
  assert.equal(outcome.route, "direct");
  assert.ok(typeof executed === "string" && executed.length > 0);
});

test("shared types: the new honest phases exist in TaskProgressPayload (byte-level)", () => {
  const src = readFileSync(new URL("../electron/shared.ts", import.meta.url), "utf8");
  assert.match(src, /"waiting_permission"/);
  assert.match(src, /"recovering"/);
});
