// Tests: Interaction wave — Ghost Cursor core, care routines, app watcher.
// Everything here runs on the PURE cores (no Electron required), so what the
// tests verify is exactly what ships.

import test from "node:test";
import assert from "node:assert/strict";

import {
  dipFromPhysical,
  arcControl,
  glideDuration,
  easeInOutCubic,
  bezierPoint,
  captionFor,
} from "../dist-test/electron/engine/ghost-cursor-core.js";

import {
  isQuipTitle,
  appNameFromTitle,
  shouldAsk,
  ASK_COOLDOWN_MS,
  STABILITY_MS,
} from "../dist-test/electron/engine/app-watcher-core.js";

import {
  inQuietHours,
  pickDueCare,
  advanceCare,
  freshCareState,
  careCopy,
  DEFAULT_CARE_CONFIG,
  CARE_COOLDOWN_MS,
} from "../dist-test/electron/engine/care-routines.js";

// ─── Ghost Cursor core ───────────────────────────────────────────────────────

test("ghost cursor: DPI mapping divides physical px by scale factor", () => {
  assert.equal(dipFromPhysical(200, 1.25), 160);
  assert.equal(dipFromPhysical(100, 1), 100);
  assert.equal(dipFromPhysical(150, 1.5), 100);
  // Degenerate scale factors never divide by zero — pass through honestly.
  assert.equal(dipFromPhysical(123, 0), 123);
  assert.equal(dipFromPhysical(123, NaN), 123);
});

test("ghost cursor: arc control bends long trips and stays straight on hops", () => {
  const short = arcControl({ x: 0, y: 0 }, { x: 20, y: 0 });
  assert.deepEqual(short, { x: 10, y: 0 }); // hop → midpoint, no arc
  const long = arcControl({ x: 0, y: 0 }, { x: 600, y: 0 });
  // Perpendicular offset on a horizontal trip pushes the control point in +y
  assert.ok(Math.abs(long.y) > 40, "long trip must arc");
  assert.equal(long.x, 300);
});

test("ghost cursor: glide duration scales with distance and clamps", () => {
  assert.equal(glideDuration({ x: 5, y: 5 }, { x: 5, y: 5 }), 0);
  const near = glideDuration({ x: 0, y: 0 }, { x: 100, y: 0 });
  assert.ok(near >= 260 && near <= 400, `near glide ${near} within bounds`);
  const far = glideDuration({ x: 0, y: 0 }, { x: 2000, y: 0 });
  assert.equal(far, 720, "long hauls cap at 720ms");
});

test("ghost cursor: bezier stays on the arc and eases monotonically", () => {
  const from = { x: 0, y: 0 };
  const to = { x: 300, y: 0 };
  const ctrl = arcControl(from, to);
  const p0 = bezierPoint(from, ctrl, to, 0);
  const p1 = bezierPoint(from, ctrl, to, 1);
  assert.equal(p0.x, 0);
  assert.equal(p1.x, 300);
  // easeInOutCubic: slow start, fast middle, slow end
  assert.ok(easeInOutCubic(0.25) < 0.25);
  assert.ok(easeInOutCubic(0.5) === 0.5);
  assert.ok(easeInOutCubic(0.75) > 0.75);
});

test("ghost cursor: captions name the action in plain words", () => {
  assert.equal(captionFor({ kind: "click" }), "clicking…");
  assert.equal(captionFor({ kind: "drag" }), "dragging…");
  assert.equal(captionFor({ kind: "right" }), "opening options…");
  assert.equal(captionFor({ kind: "type", text: "hello world" }), `typing "hello world"`);
  // Long text is previewed, never dumped whole into the bubble
  const long = captionFor({ kind: "type", text: "x".repeat(60) });
  assert.ok(long.includes("…") && long.length < 40);
});

// ─── Care routines ───────────────────────────────────────────────────────────

test("care: quiet hours 23:00–07:30 are respected", () => {
  assert.equal(inQuietHours(new Date(2026, 8, 23, 23, 0)), true);
  assert.equal(inQuietHours(new Date(2026, 8, 23, 3, 30)), true);
  assert.equal(inQuietHours(new Date(2026, 8, 23, 7, 29)), true);
  assert.equal(inQuietHours(new Date(2026, 8, 23, 7, 30)), false);
  assert.equal(inQuietHours(new Date(2026, 8, 23, 12, 0)), false);
  assert.equal(inQuietHours(new Date(2026, 8, 23, 22, 59)), false);
});

test("care: hydrate fires before others when most overdue", () => {
  const now = Date.now();
  let state = freshCareState(now);
  // Advance way past every interval
  const later = now + DEFAULT_CARE_CONFIG.hydrateMs * 3;
  const due = pickDueCare(state, DEFAULT_CARE_CONFIG, later, new Date(later));
  assert.ok(due, "something must be due");
  // hydrate interval is the shortest → most overdue → fires first
  assert.equal(due.kind, "hydrate");
});

test("care: nothing fires inside the first interval or during cooldown", () => {
  const now = Date.now();
  const state = freshCareState(now);
  assert.equal(pickDueCare(state, DEFAULT_CARE_CONFIG, now + 1000, new Date(now + 1000)), null);
  // Right after a reminder, the cooldown blocks the next one
  const advanced = advanceCare(freshCareState(now - 10 * 60_000), "hydrate", now - 1000);
  assert.equal(
    pickDueCare(advanced, DEFAULT_CARE_CONFIG, now + 1000, new Date(now + 1000)),
    null,
    "cooldown keeps reminders from stacking"
  );
});

test("care: after hydrate, the next most overdue kind takes its turn", () => {
  const now = Date.now();
  let state = freshCareState(now);
  const t1 = now + DEFAULT_CARE_CONFIG.hydrateMs * 3;
  state = advanceCare(state, "hydrate", t1);
  const t2 = t1 + DEFAULT_CARE_CONFIG.eyeRestMs * 2;
  const due = pickDueCare(state, DEFAULT_CARE_CONFIG, t2, new Date(t2));
  assert.ok(due, "eye_rest or posture must be due next");
  assert.notEqual(due.kind, "hydrate", "hydrate just fired — someone else's turn");
});

test("care: copy banks vary and never repeat the same line consecutively", () => {
  const a = careCopy("hydrate", 0);
  const b = careCopy("hydrate", 1);
  assert.notEqual(a.body, b.body, "occurrence counter rotates the lines");
  assert.equal(a.sound, "hydrate");
  assert.ok(a.title.length > 0 && a.body.length > 0);
});

// ─── App watcher core ────────────────────────────────────────────────────────

test("app-watcher: titles reduce to stable app names", () => {
  assert.equal(appNameFromTitle("Visual Studio Code"), "Visual Studio Code");
  assert.equal(appNameFromTitle("Figma - Draft v2"), "Figma");
  assert.equal(appNameFromTitle("Inbox — user@gmail.com - Gmail"), "Inbox");
  assert.equal(appNameFromTitle(""), "");
});

test("app-watcher: never asks about Quip itself or empty titles", () => {
  const base = { prevAppName: "", lastAppName: "", lastAskAt: 0, lastChangeAt: 0, actingNow: false, enabled: true };
  assert.equal(shouldAsk({ ...base, newTitle: "Quip", now: 1e12 }).ask, false);
  assert.equal(shouldAsk({ ...base, newTitle: "", now: 1e12 }).ask, false);
});

test("app-watcher: asks once for a stable new app, then goes quiet", () => {
  const now = 1_000_000_000_000;
  const base = { prevAppName: "Desktop", newTitle: "Spotify - Home", lastAppName: "", lastAskAt: 0, actingNow: false, enabled: true };
  // Too soon after the change — wait for stability
  assert.equal(
    shouldAsk({ ...base, lastChangeAt: now - 1000, now }).ask,
    false,
    "must hold the foreground before speaking"
  );
  // Stable → ask
  const verdict = shouldAsk({ ...base, lastChangeAt: now - STABILITY_MS * 2, now });
  assert.equal(verdict.ask, true);
  assert.equal(verdict.appName, "Spotify");
  // Just asked → cooldown
  assert.equal(
    shouldAsk({ ...base, lastAppName: "Spotify", lastChangeAt: now - STABILITY_MS * 2, lastAskAt: now - 1000, now }).ask,
    false,
    "one ask per 5 minutes"
  );
  // Cooldown passed but SAME app as last time → still quiet
  assert.equal(
    shouldAsk({ ...base, lastAppName: "Spotify", lastChangeAt: now - STABILITY_MS * 2, lastAskAt: now - ASK_COOLDOWN_MS - 1, now }).ask,
    false
  );
});

test("app-watcher: never interrupts while Quip is acting or disabled", () => {
  const now = 1_000_000_000_000;
  const base = { prevAppName: "Desktop", newTitle: "Steam", lastAppName: "", lastAskAt: 0, lastChangeAt: now - 60_000, now };
  assert.equal(shouldAsk({ ...base, actingNow: true }).ask, false, "Quip is mid-task");
  assert.equal(shouldAsk({ ...base, enabled: false }).ask, false, "user turned the watcher off");
});

test("app-watcher: cooldown constant is gentle but useful", () => {
  assert.equal(ASK_COOLDOWN_MS, 5 * 60_000);
  assert.equal(STABILITY_MS, 9_000);
  assert.ok(CARE_COOLDOWN_MS >= 5 * 60_000, "care reminders never stack tighter than 5 min");
});
