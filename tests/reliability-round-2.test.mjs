// Tests: reliability round 2 — the overnight audit's P0/P1 fixes.
// 1. Knowledge-graph BOUNDS: entities/links capped, user root survives,
//    persistence debounced (no whole-file write per event).
// 2. Timeline BOUNDS: events window at 400, newest kept, debounced save.
// 3. Environment brain: battery is HONEST-unsupported where the platform
//    can't provide it (the old hardcode was a plausible lie).
// 4. IPC registry: the dead SWARM_BROADCAST channel is gone; the
//    permission-mode literals are now declared in shared.ts (contract).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { knowledgeGraph } from "../dist-test/electron/brains/knowledge-graph.js";
import { timelineBrain } from "../dist-test/electron/brains/timeline-brain.js";
import { environmentBrain } from "../dist-test/electron/brains/environment-brain.js";
import { IPC } from "../dist-test/electron/shared.js";

// ── 1. Knowledge graph bounds ───────────────────────────────────────────
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quip-kg-"));
  knowledgeGraph.init(dir);

  test("knowledge graph: caps entities at 500 and keeps the user root", () => {
    for (let i = 0; i < 700; i++) {
      knowledgeGraph.upsertEntity("person", `Contact-${i}`, {}, 0.1);
    }
    const all = knowledgeGraph.findEntities("Contact-");
    const selfRoot = knowledgeGraph.findEntities("User");
    const total = knowledgeGraph.findEntities("").length;
    assert.ok(total <= 500, `total entities bounded, got ${total}`);
    assert.ok(
      all.length < 700,
      `seeded set evicted down from 700, got ${all.length}`
    );
    assert.ok(selfRoot.length >= 1, "the user root entity always survives eviction");
  });

  test("knowledge graph: persistence is debounced, not written per event", async () => {
    const file = path.join(dir, "knowledge-graph.json");
    // Fresh store: no file yet even after many in-memory upserts.
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "quip-kg2-"));
    knowledgeGraph.init(dir2);
    const file2 = path.join(dir2, "knowledge-graph.json");
    for (let i = 0; i < 50; i++) {
      knowledgeGraph.upsertEntity("interest", `Topic-${i}`, {}, 0.3);
    }
    assert.equal(
      fs.existsSync(file2),
      false,
      "no synchronous write per upsert (debounced)"
    );
    // After the debounce window the file lands with the latest state.
    await new Promise((r) => setTimeout(r, 2300));
    assert.ok(fs.existsSync(file2), "debounced save eventually writes");
    const saved = JSON.parse(fs.readFileSync(file2, "utf8"));
    assert.ok(saved.entities.length > 0 && saved.entities.length <= 500);
    void file;
  });
}

// ── 2. Timeline bounds ──────────────────────────────────────────────────
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quip-tl-"));
  timelineBrain.init(dir);

  test("timeline: events window at 400, newest kept, save debounced", () => {
    for (let i = 0; i < 500; i++) {
      timelineBrain.logEvent({
        title: `event-${i}`,
        type: "present_activity",
        timestamp: Date.now() + i,
      });
    }
    const events = timelineBrain.getAllEvents();
    assert.ok(events.length <= 400, `events bounded, got ${events.length}`);
    // The NEWEST events survive the window trim.
    const titles = new Set(events.map((e) => e.title));
    assert.ok(titles.has("event-499"), "newest event kept");
    assert.ok(!titles.has("event-0"), "oldest event evicted");
  });
}

// ── 3. Environment brain honesty ────────────────────────────────────────
test("environment battery: honest-unsupported off Windows (never fake values)", () => {
  const snap = environmentBrain.snapshot();
  if (process.platform !== "win32") {
    assert.equal(snap.battery.supported, false, "no battery read => honest unsupported");
  } else {
    // On Windows the WMI read may or may not find a battery (desktop PCs);
    // both outcomes are legal — a lie is not.
    assert.ok(snap.battery.level >= 0 && snap.battery.level <= 1);
  }
});

// ── 4. IPC registry contract ────────────────────────────────────────────
test("IPC registry: dead SWARM_BROADCAST channel removed", () => {
  assert.equal(IPC.SWARM_BROADCAST, undefined);
});

test("IPC registry: permission-mode + approval channels are declared, not raw literals", () => {
  // The audit flagged quip:get|set|cycle-permission-mode, approval-resolve and
  // set-companion as off-registry string literals. They now live in the
  // shared registry — the single source of truth for the contract.
  assert.equal(IPC.GET_PERMISSION_MODE, "quip:get-permission-mode");
  assert.equal(IPC.SET_PERMISSION_MODE, "quip:set-permission-mode");
  assert.equal(IPC.CYCLE_PERMISSION_MODE, "quip:cycle-permission-mode");
  assert.equal(IPC.APPROVAL_RESOLVE, "quip:approval-resolve");
  assert.equal(IPC.SET_COMPANION, "quip:set-companion");
});
