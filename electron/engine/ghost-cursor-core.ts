// Quip Ghost Cursor — pure core (no Electron imports; unit-tested directly).
// The overlay controller in ghost-cursor.ts builds on these helpers; keeping
// them import-free lets node --test exercise the math and copy exactly as
// shipped.

export type CursorActionLabel =
  | { kind: "click"; x?: number; y?: number }
  | { kind: "double" | "right"; x?: number; y?: number }
  | { kind: "move"; x: number; y: number }
  | { kind: "drag" }
  | { kind: "scroll" }
  | { kind: "type"; text?: string };

/** Physical pixels → DIP for the display with the given scale factor. */
export function dipFromPhysical(px: number, scaleFactor: number): number {
  if (!Number.isFinite(px) || !Number.isFinite(scaleFactor) || scaleFactor <= 0) return px;
  return Math.round(px / scaleFactor);
}

/**
 * Control point for a gentle arced path (quadratic bezier): offset
 * perpendicular to the travel direction, ~14% of the distance, capped so
 * short hops stay straight-ish. Gives the cursor its signature "comet arc".
 */
export function arcControl(
  from: { x: number; y: number },
  to: { x: number; y: number }
): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 40) return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const strength = Math.min(dist * 0.14, 90);
  const px = -dy / dist;
  const py = dx / dist;
  return { x: (from.x + to.x) / 2 + px * strength, y: (from.y + to.y) / 2 + py * strength };
}

/**
 * Glide duration heuristic: fast for hops, graceful for long journeys.
 * distance 0 → 0ms; ~300px → ~370ms; long hauls cap at 720ms.
 */
export function glideDuration(from: { x: number; y: number }, to: { x: number; y: number }): number {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  if (dist <= 1) return 0;
  return Math.round(Math.min(720, Math.max(260, 160 + dist * 0.7)));
}

/** Cubic ease-in-out shared contract between the main process and the overlay. */
export function easeInOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

/** Point on the quadratic bezier at parameter t. */
export function bezierPoint(
  from: { x: number; y: number },
  ctrl: { x: number; y: number },
  to: { x: number; y: number },
  t: number
): { x: number; y: number } {
  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * ctrl.x + t * t * to.x,
    y: u * u * from.y + 2 * u * t * ctrl.y + t * t * to.y,
  };
}

/** Small human caption for the action bubble (pure, tested). */
export function captionFor(action: CursorActionLabel): string {
  switch (action.kind) {
    case "click": return "clicking…";
    case "double": return "double-clicking…";
    case "right": return "opening options…";
    case "move": return "moving…";
    case "drag": return "dragging…";
    case "scroll": return "scrolling…";
    case "type": {
      const t = (action.text ?? "").trim();
      if (!t) return "typing…";
      const preview = t.slice(0, 24).replace(/\s+/g, " ");
      return `typing "${preview}${t.length > 24 ? "…" : ""}"`;
    }
  }
}

/** Caption for shell-launched opens (apps / sites / files) — pure, tested. */
export function openCaption(label: string): string {
  const l = String(label ?? "").trim().replace(/\s+/g, " ").slice(0, 30);
  return l ? `opening ${l}…` : "opening…";
}

/** Caption for key presses ("pressing Ctrl + Enter…") — pure, tested. */
export function keyCaption(keys: string[]): string {
  const k = (keys ?? []).filter(Boolean).join(" + ").slice(0, 30);
  return k ? `pressing ${k}…` : "pressing keys…";
}

/** DIP → physical pixels for a display's scale factor (pure, tested). */
export function physicalFromDip(dipX: number, dipY: number, scaleFactor: number): { x: number; y: number } {
  if (!Number.isFinite(dipX) || !Number.isFinite(dipY) || !Number.isFinite(scaleFactor) || scaleFactor <= 0) {
    return { x: Math.round(dipX) || 0, y: Math.round(dipY) || 0 };
  }
  return { x: Math.round(dipX * scaleFactor), y: Math.round(dipY * scaleFactor) };
}
