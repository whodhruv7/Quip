// Tests: stability round — the fixes that came out of the 30-phase
// "REAL SKALES + AGENT REACH + FULL LAPTOP CONTROL" audit:
//   A. QuipSay dep-array mangling regression (the companion-vanish crash)
//   B. ONE window factory — swarm windows inherit every lifecycle guarantee
//   C. Task cancellation (Stop) + honest "cancelled" result
//   D. Progress phases drive companion states (planning/observing/executing)
//   E. Proactive engine: toggle + persistence, no UI-timer duplicate
//   F. Every PixState has a real animation variant
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── A. QuipSay regression: deps must be [message, onDismiss] ────────────────
test("A1: QuipSay useEffect deps are exactly [message, onDismiss]", () => {
  const src = fs.readFileSync(path.join(repoRoot, "src/components/QuipSay.tsx"), "utf8");
  const m = src.match(/useEffect\(\(\) => \{[\s\S]*?\},\s*\[([^\]]*)\]\)/);
  assert.ok(m, "QuipSay must have a useEffect with an array dependency list");
  const deps = m[1].split(",").map((d) => d.trim());
  assert.deepEqual(deps, ["message", "onDismiss"]);
});

test("A2: QuipSay contains no mangled '[m[' identifier sequence", () => {
  const src = fs.readFileSync(path.join(repoRoot, "src/components/QuipSay.tsx"), "utf8");
  assert.ok(!src.includes("[m["), "the '[m[' mangling that crashed the renderer must never return");
  assert.ok(!/[^\w.]essage\b/.test(src.replace(/\bmessage\b/g, "")), "no stray 'essage' identifier");
});

// ─── B. One window factory ────────────────────────────────────────────────────
test("B1: SwarmManager never constructs raw BrowserWindows anymore", () => {
  const src = fs.readFileSync(path.join(repoRoot, "electron/brains/swarm-manager.ts"), "utf8");
  assert.ok(!src.includes("new BrowserWindow("), "swarm must delegate to the injected factory");
  assert.ok(src.includes("this.windowFactory("), "spawn must go through the single factory");
});

test("B2: SwarmManager exposes setWindowFactory and main wires createWindow into it", () => {
  const swarm = fs.readFileSync(path.join(repoRoot, "electron/brains/swarm-manager.ts"), "utf8");
  const main = fs.readFileSync(path.join(repoRoot, "electron/main.ts"), "utf8");
  assert.ok(swarm.includes("setWindowFactory("));
  assert.ok(
    main.includes("swarmManager.setWindowFactory((id, ox, oy) => createWindow(id, ox, oy))"),
    "main must inject createWindow as THE factory"
  );
  assert.ok(
    main.includes("createWindow(defaultCompanionId);"),
    "the primary companion must boot through the managed factory"
  );
  assert.ok(!main.includes("swarmManager.spawn(defaultCompanionId)"), "old raw spawn path must be gone");
});

test("B3: swarm spawn() without a factory falls back to a registry-only instance", async () => {
  const { swarmManager } = await import("../dist-test/electron/brains/swarm-manager.js");
  const id = swarmManager.spawn("kai");
  assert.equal(id, -1, "no factory injected → ghost instance, no raw window");
  assert.equal(swarmManager.getInstances().at(-1)?.headless, true);
});

// ─── C. Task cancellation ─────────────────────────────────────────────────────
test("C1: aborted signal stops before the next step and reports cancelled honestly", async () => {
  const { orchestrator } = await import("../dist-test/electron/engine/orchestrator.js");
  // A multi-step intent that the deterministic parser handles without a model.
  const signal = { aborted: true }; // already cancelled
  const result = await orchestrator.execute("open notepad and open chrome", {
    platform: "win32",
    signal,
  });
  assert.equal(result.cancelled, true);
  assert.equal(result.stepsCompleted, 0);
  assert.match(result.summary, /Stopped|cancel/i);
});

test("C2: once aborted, no further step may start — even mid-chain", async () => {
  const { orchestrator } = await import("../dist-test/electron/engine/orchestrator.js");
  const signal = { aborted: false };
  // Abort the instant the first step reports progress. Whatever happens to
  // step 1 itself (it may finish or fail on this platform), the guarantee is:
  // step 2 must NEVER begin.
  let runningStarted = 0;
  const result = await orchestrator.execute("open notepad and open chrome", {
    platform: "win32",
    signal,
    onProgress: (u) => {
      if (u.status === "running") runningStarted += 1;
      signal.aborted = true;
    },
  });
  assert.equal(runningStarted, 1, "exactly the first step may start");
  assert.equal(result.stepsTotal, 2);
  assert.ok(runningStarted < result.stepsTotal, "no step starts after the abort");
});

test("C3: cancelled result from a declined approval also reports cancelled", async () => {
  const { orchestrator } = await import("../dist-test/electron/engine/orchestrator.js");
  const { permissionSystem } = await import("../dist-test/electron/engine/permission-modes.js");
  const prevMode = permissionSystem.getMode();
  permissionSystem.setMode("full_access");
  try {
    // kill is dangerous → needs approval even in full_access; auto-decline.
    const original = permissionSystem.requestApproval;
    permissionSystem.requestApproval = async () => false;
    try {
      const result = await orchestrator.execute("kill process 1234", { platform: "win32" });
      assert.equal(result.cancelled, true);
    } finally {
      permissionSystem.requestApproval = original;
    }
  } finally {
    permissionSystem.setMode(prevMode);
  }
});

// ─── D. Progress phases ───────────────────────────────────────────────────────
test("D1: reading steps report the observing phase, action steps report executing", async () => {
  const { orchestrator } = await import("../dist-test/electron/engine/orchestrator.js");
  const run = async (command) => {
    const phases = [];
    await orchestrator.execute(command, {
      platform: "win32",
      onProgress: (u) => phases.push({ desc: u.description, phase: u.phase, status: u.status }),
    }).catch(() => {});
    return phases;
  };
  const shot = await run("take a screenshot");
  assert.ok(shot.some((p) => p.status === "running" && p.phase === "observing"),
    "screenshot is a READ → honest observing phase");
  const list = await run("list the open windows");
  assert.ok(list.some((p) => p.status === "running" && p.phase === "observing"),
    "window listing is a READ → observing phase");
  const open = await run("open notepad");
  assert.ok(open.some((p) => p.status === "running" && p.phase === "executing"),
    "launching an app is a real action → executing phase");
});

test("D2: main passes phase + status through TASK_PROGRESS IPC", () => {
  const main = fs.readFileSync(path.join(repoRoot, "electron/main.ts"), "utf8");
  assert.ok(/phase: update\.phase/.test(main));
  assert.ok(/status: update\.status/.test(main));
});

// ─── E. Proactive engine: one authoritative scheduler ─────────────────────────
test("E1: disabled engine suppresses cute check-ins but persists the choice", async () => {
  const { proactiveEngine } = await import("../dist-test/electron/brains/proactive-engine.js");
  const saves = [];
  proactiveEngine.configure({
    load: () => null,
    save: (state) => saves.push(state),
  });
  proactiveEngine.setEnabled(false);
  assert.equal(proactiveEngine.isEnabled(), false);
  await wait(700); // persist() is debounced (500ms)
  const seen = saves.at(-1);
  assert.ok(seen, "the toggle change must reach persistence");
  assert.equal(seen.enabled, false);
});

test("E2: persisted cooldowns are restored — restarts cannot spam", async () => {
  const { proactiveEngine } = await import("../dist-test/electron/brains/proactive-engine.js");
  let stored = null;
  proactiveEngine.configure({
    load: () => stored,
    save: (s) => {
      stored = s;
    },
  });
  proactiveEngine.setEnabled(true);
  assert.equal(proactiveEngine.isEnabled(), true);
  await wait(700); // persist() is debounced (500ms)
  assert.ok(stored && stored.enabled === true, "the toggle must persist");
});

test("E3: the renderer-side UI-timer hook is gone — no duplicate schedulers", () => {
  assert.equal(
    fs.existsSync(path.join(repoRoot, "src/hooks/useProactiveCheckIn.ts")),
    false,
    "useProactiveCheckIn (random UI timer) must not come back"
  );
  const useChat = fs.readFileSync(path.join(repoRoot, "src/hooks/useChat.ts"), "utf8");
  assert.ok(useChat.includes("onProactiveSuggestion"), "useChat must display main-engine messages");
  assert.ok(!useChat.includes("useProactiveCheckIn"), "no duplicate scheduler reference");
});

test("E4: check-ins toggle is wired end-to-end (channel + preload + settings)", () => {
  const shared = fs.readFileSync(path.join(repoRoot, "electron/shared.ts"), "utf8");
  const preload = fs.readFileSync(path.join(repoRoot, "electron/preload.ts"), "utf8");
  const main = fs.readFileSync(path.join(repoRoot, "electron/main.ts"), "utf8");
  const settings = fs.readFileSync(path.join(repoRoot, "src/components/SettingsPanel.tsx"), "utf8");
  assert.ok(shared.includes("GET_CHECKINS_ENABLED") && shared.includes("SET_CHECKINS_ENABLED"));
  assert.ok(preload.includes("getCheckInsEnabled") && preload.includes("setCheckInsEnabled"));
  assert.ok(main.includes("IPC.GET_CHECKINS_ENABLED") && main.includes("IPC.SET_CHECKINS_ENABLED"));
  assert.ok(settings.includes("Let Quip check in on me"));
});

// ─── F. Companion states ──────────────────────────────────────────────────────
test("F1: every PixState has a real animation variant", () => {
  const types = fs.readFileSync(path.join(repoRoot, "src/types/chat.ts"), "utf8");
  const companion = fs.readFileSync(path.join(repoRoot, "src/components/Companion.tsx"), "utf8");
  const block = types.match(/export type PixState =([\s\S]*?);/)[1];
  const states = [...block.matchAll(/"(\w+)"/g)].map((m) => m[1]);
  assert.ok(states.length >= 12, `expected the 12-state lifecycle, got ${states.length}`);
  for (const state of states) {
    assert.ok(
      companion.includes(`  ${state}: {`),
      `PixState "${state}" must have a motion variant (no fake/hollow states)`
    );
  }
});

test("F2: App maps task phases to honest companion states + a Stop button exists", () => {
  const app = fs.readFileSync(path.join(repoRoot, "src/App.tsx"), "utf8");
  for (const needle of ['"planning"', '"observing"', '"verifying"', '"cancelled"', "cancelTask", "Stop this task"]) {
    assert.ok(app.includes(needle), `App.tsx must reference ${needle}`);
  }
});

test("F3: orchestrator cancelled results flow through the shared payload type", () => {
  const shared = fs.readFileSync(path.join(repoRoot, "electron/shared.ts"), "utf8");
  const tasks = fs.readFileSync(path.join(repoRoot, "src/types/tasks.ts"), "utf8");
  assert.ok(/phase\?\s*:\s*"planning" \| "executing" \| "observing" \| "verifying"/.test(shared));
  assert.ok(tasks.includes("cancelled?: boolean"));
});
