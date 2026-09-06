// Quip Execution Engine — Window Policy
// ─────────────────────────────────────────────────────────────────────────────
// Centralizes layering + focus rules so browser/task windows NEVER open
// confusingly behind the Quip chat panel.
//
// Rules:
//   - Quip chat/companion is an always-on-top overlay on the right edge.
//   - Browser surfaces open FOCUSED (bring to front) but never always-on-top,
//     positioned to avoid the chat overlay's region when space allows.
//   - Focus is re-asserted after navigation.
//
// The core geometry is PURE (testable in plain Node); the Electron screen
// dependency is isolated in thin wrappers.
// ─────────────────────────────────────────────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Pure (testable): overlay region the Quip chat panel occupies (right edge). */
export function computeOverlayRect(workArea: Rect, panelWidth = 440): Rect {
  const width = Math.min(panelWidth, Math.round(workArea.width * 0.35));
  return {
    x: workArea.x + workArea.width - width,
    y: workArea.y,
    width,
    height: workArea.height,
  };
}

/**
 * Pure (testable): browser window bounds that avoid covering the Quip overlay.
 * If the remaining space is too narrow (< 600px), the browser uses the full
 * work area (the Quip overlay is compact + semi-transparent, acceptable).
 */
export function computeBrowserBoundsForWorkArea(workArea: Rect, chat?: Rect): Rect {
  const overlay = chat ?? computeOverlayRect(workArea);
  const spaceLeft = overlay.x - workArea.x;
  if (spaceLeft >= 600) {
    return { x: workArea.x, y: workArea.y, width: spaceLeft, height: workArea.height };
  }
  return { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height };
}

/** Pure (testable): does rect A intersect rect B? */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

// ─── Electron wrappers (only usable inside Electron main) ───────────────────

/** The overlay region using the real primary display. */
export function quipOverlayRect(panelWidth = 440): Rect {
  const { screen } = require("electron") as typeof import("electron");
  const area = screen.getPrimaryDisplay().workArea;
  return computeOverlayRect(area as Rect, panelWidth);
}

/** Browser bounds using the real primary display. */
export function computeBrowserWindowBounds(overlay?: Rect): Rect {
  const { screen } = require("electron") as typeof import("electron");
  const area = screen.getPrimaryDisplay().workArea;
  return computeBrowserBoundsForWorkArea(area as Rect, overlay);
}
