// Quip Execution Engine — Window Policy
// ─────────────────────────────────────────────────────────────────────────────
// Pure layering geometry (testable in plain Node). With the embedded browser
// removed (Phase 26 — Quip uses the user's REAL browser via the OS shell),
// the browser-bounds helpers are gone; what remains is the overlay geometry
// used by window placement decisions.
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

/** Pure (testable): does rect A intersect rect B? */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}
