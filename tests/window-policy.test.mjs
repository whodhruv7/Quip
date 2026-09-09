// Tests: window policy (pure geometry)
// The embedded-browser bounds helpers were removed with the Phase 26 change
// (Quip opens the user's REAL browser via the OS shell — no Electron browser
// window exists to place anymore), so only the overlay geometry is tested.
import test from "node:test";
import assert from "node:assert/strict";
import {
  computeOverlayRect,
  rectsIntersect,
} from "../dist-test/electron/engine/window-policy.js";

const WORKAREA = { x: 0, y: 0, width: 1920, height: 1040 };

test("overlay sits on the right edge", () => {
  const overlay = computeOverlayRect(WORKAREA);
  assert.equal(overlay.x + overlay.width, WORKAREA.width);
  assert.equal(overlay.height, WORKAREA.height);
});

test("overlay width is capped at 35% of the work area", () => {
  const overlay = computeOverlayRect(WORKAREA, 440);
  assert.ok(overlay.width <= Math.round(WORKAREA.width * 0.35));
});

test("overlay respects a custom panel width", () => {
  const overlay = computeOverlayRect(WORKAREA, 320);
  assert.equal(overlay.width, 320);
});

test("rectsIntersect detects overlap and separation", () => {
  const a = { x: 0, y: 0, width: 100, height: 100 };
  const b = { x: 50, y: 50, width: 100, height: 100 };
  const c = { x: 200, y: 200, width: 50, height: 50 };
  assert.equal(rectsIntersect(a, b), true);
  assert.equal(rectsIntersect(a, c), false);
});
