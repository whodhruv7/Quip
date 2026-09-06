// Tests: window layering policy (pure geometry)
import test from "node:test";
import assert from "node:assert/strict";
import {
  computeOverlayRect,
  computeBrowserBoundsForWorkArea,
  rectsIntersect,
} from "../dist-test/electron/engine/window-policy.js";

const WORKAREA = { x: 0, y: 0, width: 1920, height: 1040 };

test("overlay sits on the right edge", () => {
  const overlay = computeOverlayRect(WORKAREA);
  assert.equal(overlay.x + overlay.width, WORKAREA.width);
  assert.equal(overlay.height, WORKAREA.height);
});

test("browser avoids the chat overlay region on wide screens", () => {
  const overlay = computeOverlayRect(WORKAREA, 440);
  const browser = computeBrowserBoundsForWorkArea(WORKAREA, overlay);
  assert.equal(rectsIntersect(browser, overlay), false, "browser must not cover the chat overlay");
  assert.ok(browser.width >= 600);
});

test("browser uses full area when the screen is too narrow", () => {
  const narrow = { x: 0, y: 0, width: 800, height: 600 };
  const browser = computeBrowserBoundsForWorkArea(narrow);
  assert.equal(browser.width, 800);
});

test("rectsIntersect detects overlap and separation", () => {
  const a = { x: 0, y: 0, width: 100, height: 100 };
  const b = { x: 50, y: 50, width: 100, height: 100 };
  const c = { x: 200, y: 200, width: 50, height: 50 };
  assert.equal(rectsIntersect(a, b), true);
  assert.equal(rectsIntersect(a, c), false);
});
