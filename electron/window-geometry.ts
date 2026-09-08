// Quip V2 — window geometry (pure helpers, no Electron imports).
// ─────────────────────────────────────────────────────────────────────────────
// Keeps windows inside the visible work area. The companion previously could
// end up off-screen after a display change or bad saved position (it looked
// like it "disappeared"); every placement path now funnels through here.
// ─────────────────────────────────────────────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Clamp a rect so it stays fully inside the area (and handles absurd values). */
export function clampRect(rect: Rect, area: Area): { x: number; y: number } {
  const maxX = area.x + Math.max(0, area.width - rect.width);
  const maxY = area.y + Math.max(0, area.height - rect.height);
  const x = Number.isFinite(rect.x) ? Math.min(Math.max(rect.x, area.x), maxX) : area.x;
  const y = Number.isFinite(rect.y) ? Math.min(Math.max(rect.y, area.y), maxY) : area.y;
  return { x, y };
}

/** Bottom-right anchor: keep the same corner fixed when the size changes. */
export function anchorBottomRight(
  cur: Rect,
  nextW: number,
  nextH: number,
  area: Area
): { x: number; y: number } {
  return clampRect(
    { x: cur.x + cur.width - nextW, y: cur.y + cur.height - nextH, width: nextW, height: nextH },
    area
  );
}
