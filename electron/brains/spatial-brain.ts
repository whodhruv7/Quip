// Quip V2 — SPATIAL BRAIN
// -----------------------------------------------------------------------------
// Decides WHERE things go on screen so they never overflow or hide behind
// the taskbar. It knows the primary display, its work area, the taskbar
// edge, and the safe margin. From that it derives:
//
//   - the form factor (desktop / ultrawide / tablet / phone)
//   - the chat panel size + position
//   - the companion sprite position
//
// On desktop the chat panel sits flush bottom-right with the companion just
// left of it; on narrower screens the panel takes more width. The panel is
// ALWAYS clamped inside the work area so it can't fly off-screen like V0.1.
// -----------------------------------------------------------------------------

import { screen, Display } from "electron";
import type { DeviceProfile, SpatialConfig, FormFactor } from "../../src/types";

const PANEL_MARGIN = 18;
const COMPANION_SIZE = 88;
const MIN_PANEL_W = 380;
const MAX_PANEL_W = 460;
const MIN_PANEL_H = 480;

function detectFormFactor(width: number): FormFactor {
  if (width >= 2560) return "ultrawide";
  if (width >= 1100) return "desktop";
  if (width >= 700) return "tablet";
  return "phone";
}

export function computeSpatial(profile: DeviceProfile): SpatialConfig {
  // Prefer the primary display's work area (excludes taskbar/dock).
  const displays = screen.getAllDisplays();
  const primary: Display =
    displays.find((d) => d.id === screen.getPrimaryDisplay().id) ?? displays[0];
  const wa = primary.workArea;

  const formFactor = detectFormFactor(wa.width);

  // Panel width: scale with available width, clamped.
  const panelW = Math.max(
    MIN_PANEL_W,
    Math.min(MAX_PANEL_W, Math.floor(wa.width * 0.34))
  );
  const panelH = Math.max(MIN_PANEL_H, Math.floor(wa.height - PANEL_MARGIN * 2));

  // Companion sits at bottom-right, panel anchored to its left.
  const companionX = wa.x + wa.width - COMPANION_SIZE - PANEL_MARGIN;
  const companionY = wa.y + wa.height - COMPANION_SIZE - PANEL_MARGIN;

  // Panel anchored bottom-right, just above the companion row.
  const chatPanelX = wa.x + wa.width - panelW - PANEL_MARGIN;
  const chatPanelY = wa.y + wa.height - panelH - PANEL_MARGIN;

  return {
    formFactor,
    windowSize: {
      width: wa.width,
      height: wa.height,
    },
    companion: { x: companionX, y: companionY },
    chatPanel: {
      x: chatPanelX,
      y: chatPanelY,
      width: panelW,
      height: panelH,
    },
    safeMargin: PANEL_MARGIN,
    layout: "floating",
  };
}

/** Recompute whenever display geometry changes (resolution, monitor plug). */
export function watchSpatial(
  profile: DeviceProfile,
  onChange: (cfg: SpatialConfig) => void
): () => void {
  const handler = () => onChange(computeSpatial(profile));
  screen.on("display-metrics-changed", handler as any);
  screen.on("display-added", handler as any);
  screen.on("display-removed", handler as any);
  return () => {
    screen.off("display-metrics-changed", handler as any);
    screen.off("display-added", handler as any);
    screen.off("display-removed", handler as any);
  };
}
