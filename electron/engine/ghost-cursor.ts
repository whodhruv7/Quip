// Quip Ghost Cursor — the visible magical hand of Quip
// ─────────────────────────────────────────────────────────────────────────────
// When Quip acts on the screen (click / drag / type / scroll), the user SEES
// it happen: a themed glowing cursor glides to the real coordinates, presses,
// bursts into sparkles on contact, and leaves a stardust trail behind — with
// a small caption naming what Quip is doing ("opening YouTube…").
//
// Architecture:
//  • Pure helpers (unit-tested): DPI mapping, bezier arcs, glide timing,
//    caption mapping. No Electron imports in that layer.
//  • Overlay controller: ONE transparent, click-through, always-on-top
//    BrowserWindow per primary display. The overlay NEVER intercepts input
//    (setIgnoreMouseEvents) and NEVER takes focus. Fails soft everywhere —
//    a broken overlay must never break the real action it is decorating.
//  • Sync model: for clicks, the VISUAL glide runs first (~380–650ms), then
//    the real SetCursorPos + mouse_event fires — cause and effect stay
//    honest and visible. For pure moves the visual simply tracks the target.
//
// This module imports NOTHING from other engine modules (leaf) — it can be
// safely imported by desktop-controller without creating cycles.
// ─────────────────────────────────────────────────────────────────────────────

import { BrowserWindow, screen } from "electron";
import {
  arcControl,
  bezierPoint,
  captionFor,
  dipFromPhysical,
  easeInOutCubic,
  glideDuration,
  keyCaption,
  openCaption,
  physicalFromDip,
  type CursorActionLabel,
} from "./ghost-cursor-core";

// Re-export the pure core so consumers (and tests) have a single surface.
export {
  arcControl,
  bezierPoint,
  captionFor,
  dipFromPhysical,
  easeInOutCubic,
  glideDuration,
  keyCaption,
  openCaption,
  physicalFromDip,
  type CursorActionLabel,
} from "./ghost-cursor-core";

// ─── Overlay window controller ───────────────────────────────────────────────

const OVERLAY_MARGIN = 4;

interface GhostStyle {
  accent: string;
  accent2: string;
  companion?: string;
}

let overlay: BrowserWindow | null = null;
let style: GhostStyle = { accent: "167, 139, 250", accent2: "196, 181, 253", companion: "pix" };
let lastPoint = { x: 0, y: 0 };
let haveLastPoint = false;
let activeUntil = 0; // app-watcher suppression window
// Honesty gate: the cursor visualizes REAL Windows input (SetCursorPos /
// mouse_event). On platforms where those primitives can't run, a performing
// cursor would be theater over nothing — so it stays off there.
let enabled = process.platform === "win32";

export function setGhostCursorEnabled(v: boolean): void {
  enabled = v;
  if (!v) hideNow();
}

export function ghostCursorEnabled(): boolean {
  return enabled;
}

/** Timestamp until which Quip's own input is considered "acting" (watcher suppress). */
export function ghostActiveUntil(): number {
  return activeUntil;
}

function markActive(ms: number): void {
  activeUntil = Math.max(activeUntil, Date.now() + ms);
}

function send(op: string, data?: Record<string, unknown>): void {
  try {
    if (!overlay || overlay.isDestroyed()) return;
    overlay.webContents.send("ghost-cursor-event", { op, ...data });
  } catch {
    /* the overlay is decoration — never let it break the real action */
  }
}

function ensureOverlay(): BrowserWindow | null {
  try {
    if (overlay && !overlay.isDestroyed()) return overlay;
    const display = screen.getPrimaryDisplay();
    const b = display.bounds;
    overlay = new BrowserWindow({
      x: b.x + OVERLAY_MARGIN,
      y: b.y + OVERLAY_MARGIN,
      width: b.width - OVERLAY_MARGIN * 2,
      height: b.height - OVERLAY_MARGIN * 2,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      hasShadow: false,
      skipTaskbar: true,
      show: false,
      backgroundColor: "#00000000",
      webPreferences: {
        preload: pathJoinOverlayPreload(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    overlay.setIgnoreMouseEvents(true); // NEVER intercepts the user's real input
    overlay.setAlwaysOnTop(true, "screen-saver");
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    const html = overlayHtml();
    overlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return overlay;
  } catch {
    overlay = null;
    return null;
  }
}

/** Resolves the compiled overlay-preload.js next to main.js. */
function pathJoinOverlayPreload(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require("node:path") as typeof import("node:path");
  return path.join(__dirname, "overlay-preload.js");
}

function showOverlay(): void {
  try {
    const win = ensureOverlay();
    if (!win || win.isDestroyed()) return;
    if (!win.isVisible()) win.showInactive();
    win.moveTop();
  } catch {
    /* decoration only */
  }
}

function hideNow(): void {
  try {
    if (overlay && !overlay.isDestroyed() && overlay.isVisible()) overlay.hide();
  } catch {
    /* decoration only */
  }
}

/** Physical px → overlay-local DIP coordinates (manual, per-display aware). */
function toLocal(physX: number, physY: number): { x: number; y: number } {
  try {
    const primary = screen.getPrimaryDisplay();
    const displays = screen.getAllDisplays().length > 0 ? screen.getAllDisplays() : [primary];
    // Find the display whose PHYSICAL extent contains the point (bounds are
    // DIP; each display multiplies by its own scale factor on Windows).
    let display = primary;
    for (const d of displays) {
      const sf = d.scaleFactor || 1;
      const px0 = d.bounds.x * sf;
      const py0 = d.bounds.y * sf;
      const px1 = px0 + d.bounds.width * sf;
      const py1 = py0 + d.bounds.height * sf;
      if (physX >= px0 && physX <= px1 && physY >= py0 && physY <= py1) {
        display = d;
        break;
      }
    }
    const sf = display.scaleFactor || 1;
    const dipX = dipFromPhysical(physX, sf);
    const dipY = dipFromPhysical(physY, sf);
    return {
      x: Math.max(0, Math.min(display.bounds.width - OVERLAY_MARGIN * 2, dipX - display.bounds.x - OVERLAY_MARGIN)),
      y: Math.max(0, Math.min(display.bounds.height - OVERLAY_MARGIN * 2, dipY - display.bounds.y - OVERLAY_MARGIN)),
    };
  } catch {
    return { x: physX, y: physY };
  }
}

// ─── Public action API (all fail-soft, all no-op when disabled) ─────────────

export function ghostSetStyle(next: Partial<GhostStyle>): void {
  style = { ...style, ...next };
  send("style", { ...style });
}

/**
 * Glide the visual cursor to a physical point, resolve after the visual
 * lands (so callers execute the real click right at that moment).
 */
export async function ghostGlide(
  physX: number,
  physY: number,
  opts?: { label?: string; mode?: "normal" | "grab" }
): Promise<void> {
  if (!enabled) return;
  try {
    const from = haveLastPoint ? lastPoint : { x: physX - 60, y: physY - 60 };
    const dur = glideDuration(from, { x: physX, y: physY });
    showOverlay();
    markActive(dur + 2500);
    const fromLocal = toLocal(from.x, from.y);
    const toLocalPt = toLocal(physX, physY);
    send("move", {
      from: fromLocal,
      to: toLocalPt,
      durMs: dur,
      label: opts?.label ?? "",
      mode: opts?.mode ?? "normal",
    });
    lastPoint = { x: physX, y: physY };
    haveLastPoint = true;
    if (dur > 0) await new Promise((r) => setTimeout(r, dur));
  } catch {
    /* decoration only */
  }
}

/** Press the visual cursor down (before a real click / start of a drag). */
export function ghostPress(): void {
  if (!enabled) return;
  send("press");
}

/** Release the press + sparkle burst at the current point. */
export function ghostReleaseBurst(): void {
  if (!enabled) return;
  const local = toLocal(lastPoint.x, lastPoint.y);
  send("burst", { ...local });
  markActive(2200);
}

/** Typing gesture — the cursor morphs into a tapping keycap. */
export function ghostType(label?: string): void {
  if (!enabled) return;
  showOverlay();
  send("mode", { mode: "typing", label: label ?? captionFor({ kind: "type" }) });
  markActive(2600);
}

/** Scroll gesture — soft arrows pulse around the cursor. */
export function ghostScroll(label?: string): void {
  if (!enabled) return;
  showOverlay();
  send("mode", { mode: "scrolling", label: label ?? captionFor({ kind: "scroll" }) });
  markActive(2200);
}

// ─── The OPEN performance (apps / websites / files) ─────────────────────────

let anchorRect: { x: number; y: number; width: number; height: number } | null = null;

/** Main binds the companion's bounds so the cursor appears FROM the mascot. */
export function setGhostAnchor(rect: { x: number; y: number; width: number; height: number } | null): void {
  anchorRect = rect;
}

/** Physical cast point: just above-left of the companion (or a fallback). */
function castPointPhysical(): { x: number; y: number } {
  try {
    const display = screen.getPrimaryDisplay();
    const sf = display.scaleFactor || 1;
    let dip: { x: number; y: number };
    if (anchorRect) {
      dip = {
        x: anchorRect.x + anchorRect.width / 2 - 70,
        y: Math.max(display.workArea.y + 40, anchorRect.y - 70),
      };
    } else {
      const wa = display.workArea;
      dip = { x: wa.x + wa.width - 160, y: wa.y + wa.height - 240 };
    }
    const b = display.bounds;
    dip.x = Math.max(b.x + 30, Math.min(b.x + b.width - 30, dip.x));
    dip.y = Math.max(b.y + 30, Math.min(b.y + b.height - 30, dip.y));
    return physicalFromDip(dip.x, dip.y, sf);
  } catch {
    return { x: 900, y: 500 };
  }
}

const sleepMs = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * The OPEN performance — for shell-launched things (apps, websites, files)
 * there is no real click coordinate to visit. The cursor appears near the
 * companion, glides to the cast point with a caption ("opening YouTube…"),
 * presses and bursts exactly while `act` fires the REAL launch, then hides.
 * Fails soft: disabled or broken overlay → `act` runs immediately — the
 * performance is a layer on top of execution, never a dependency of it.
 */
export async function ghostPerformOpen(opts: { label: string; act?: () => void }): Promise<void> {
  if (!enabled) {
    opts.act?.();
    return;
  }
  try {
    const cast = castPointPhysical();
    await ghostGlide(cast.x, cast.y, { label: openCaption(opts.label) });
    ghostPress();
    await sleepMs(130);
    opts.act?.(); // the REAL launch fires at the burst moment
    ghostReleaseBurst();
    ghostHideSoon(1700);
  } catch {
    opts.act?.(); // decoration never blocks reality
  }
}

/** Schedule the auto-hide after a quiet period (no more actions). */
export function ghostHideSoon(ms = 2000): void {
  if (!enabled) return;
  setTimeout(() => {
    try {
      if (Date.now() >= activeUntil) hideNow();
    } catch {
      /* decoration only */
    }
  }, ms);
}

/** Where the visual cursor currently rests (physical px; null if unknown). */
export function ghostPosition(): { x: number; y: number } | null {
  return haveLastPoint ? { ...lastPoint } : null;
}

/** Test/teardown hook. */
export function destroyGhostCursor(): void {
  try {
    if (overlay && !overlay.isDestroyed()) overlay.destroy();
  } catch {
    /* ignore */
  }
  overlay = null;
}

// ─── Overlay page (self-contained HTML — no build step, no assets) ──────────

export function overlayHtml(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root { --ac: ${style.accent}; --ac2: ${style.accent2}; }
  html, body { margin: 0; padding: 0; background: transparent; overflow: hidden;
    width: 100vw; height: 100vh; cursor: none; user-select: none; }
  #stage { position: fixed; inset: 0; }

  /* ── the orb ── */
  #cursor { position: fixed; left: 0; top: 0; width: 26px; height: 26px;
    margin: -13px 0 0 -13px; border-radius: 50%; z-index: 50;
    background: radial-gradient(circle at 34% 30%,
      rgba(255,255,255,0.98) 0%,
      rgba(var(--ac2), 0.95) 38%,
      rgba(var(--ac), 0.92) 72%,
      rgba(var(--ac), 0.35) 100%);
    box-shadow:
      0 0 14px 3px rgba(var(--ac), 0.55),
      0 0 34px 10px rgba(var(--ac), 0.22),
      inset 0 -3px 6px rgba(255,255,255,0.35),
      inset 0 2px 4px rgba(255,255,255,0.6);
    opacity: 0; transform: scale(0.4);
    transition: opacity .18s ease, transform .18s cubic-bezier(.34,1.56,.64,1);
    will-change: transform; }
  #cursor.on { opacity: 1; transform: scale(1); }
  #cursor.press { transform: scale(0.78); filter: brightness(1.18); }
  #cursor.grab { transform: scale(0.9); }

  /* orbiting satellite sparkle */
  #orbit { position: fixed; width: 7px; height: 7px; margin: -3.5px 0 0 -3.5px;
    border-radius: 50%; background: radial-gradient(circle, #fff 0%, rgba(var(--ac2),.9) 55%, transparent 100%);
    filter: drop-shadow(0 0 4px rgba(var(--ac), .8)); z-index: 51; opacity: 0; }
  #orbit.on { opacity: 1; animation: orbitSpin 1.6s linear infinite; }
  @keyframes orbitSpin { 0% { transform: rotate(0deg) translateX(21px) scale(1); }
    50% { transform: rotate(180deg) translateX(21px) scale(0.55); }
    100% { transform: rotate(360deg) translateX(21px) scale(1); } }

  /* soft breathing halo */
  #halo { position: fixed; width: 54px; height: 54px; margin: -27px 0 0 -27px;
    border-radius: 50%; border: 1.5px solid rgba(var(--ac), 0.4); z-index: 40;
    opacity: 0; transition: opacity .25s ease; }
  #halo.on { opacity: 1; animation: haloBreath 1.9s ease-in-out infinite; }
  @keyframes haloBreath { 0%,100% { transform: scale(0.85); opacity: .55; }
    50% { transform: scale(1.12); opacity: .15; } }

  /* stardust trail */
  .trail { position: fixed; border-radius: 50%; pointer-events: none; z-index: 30;
    background: radial-gradient(circle, rgba(255,255,255,.95) 0%, rgba(var(--ac2),.8) 45%, rgba(var(--ac),0) 100%);
    animation: trailFade .72s ease-out forwards; }
  @keyframes trailFade { 0% { opacity: .95; transform: scale(1); }
    100% { opacity: 0; transform: scale(0.25) translateY(5px); } }

  /* click burst */
  .burst-ring { position: fixed; border-radius: 50%; pointer-events: none; z-index: 45;
    border: 2px solid rgba(var(--ac), .8);
    animation: ringOut .5s cubic-bezier(.22,.68,.4,1) forwards; }
  @keyframes ringOut { 0% { opacity: .9; transform: translate(-50%,-50%) scale(0.15); }
    100% { opacity: 0; transform: translate(-50%,-50%) scale(1); } }
  .spark { position: fixed; width: 8px; height: 8px; pointer-events: none; z-index: 46;
    background: radial-gradient(circle, #fff 0%, rgba(var(--ac2), .95) 50%, transparent 100%);
    clip-path: polygon(50% 0, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0 50%, 38% 38%);
    animation: sparkFly .62s cubic-bezier(.16,.84,.44,1) forwards; }
  @keyframes sparkFly {
    0% { opacity: 1; transform: translate(-50%,-50%) rotate(var(--r)) translateX(0) scale(1); }
    100% { opacity: 0; transform: translate(-50%,-50%) rotate(var(--r)) translateX(var(--d)) scale(0.2); } }

  /* caption bubble */
  #cap { position: fixed; z-index: 60; transform: translate(-50%, -100%);
    padding: 5px 12px; border-radius: 999px; opacity: 0; white-space: nowrap;
    font: 600 12px/1.35 "Segoe UI", system-ui, sans-serif; letter-spacing: .01em;
    color: rgba(var(--ac), 1);
    background: rgba(22, 20, 34, 0.82);
    border: 1px solid rgba(var(--ac), .5);
    box-shadow: 0 6px 22px rgba(0,0,0,.35), 0 0 12px rgba(var(--ac), .18);
    backdrop-filter: blur(10px); transition: opacity .2s ease, translate .2s ease; }
  #cap.on { opacity: 1; }
  #cap::after { content: ""; position: absolute; left: 50%; bottom: -5px; width: 8px; height: 8px;
    transform: translateX(-50%) rotate(45deg); background: rgba(22, 20, 34, 0.82);
    border-right: 1px solid rgba(var(--ac), .5); border-bottom: 1px solid rgba(var(--ac), .5); }

  /* typing keycap + scroll arrows */
  #keycap { position: fixed; z-index: 52; width: 22px; height: 22px; margin: -30px 0 0 -11px;
    border-radius: 6px; opacity: 0; background: rgba(255,255,255,.92);
    box-shadow: 0 2px 0 rgba(var(--ac), .8), 0 0 14px rgba(var(--ac), .4);
    transition: opacity .15s ease; }
  #keycap.on { opacity: 1; animation: keyTap .42s ease-in-out infinite; }
  @keyframes keyTap { 0%,100% { transform: translateY(0) scale(1); }
    50% { transform: translateY(2.5px) scale(0.94); } }
  .scrollArrow { position: fixed; z-index: 52; left: 0; opacity: 0; color: rgba(var(--ac), .95);
    font-size: 13px; text-shadow: 0 0 8px rgba(var(--ac), .7); transition: opacity .15s ease; }
  .scrollArrow.on { animation: arrowPulse .7s ease-in-out infinite; }
  @keyframes arrowPulse { 0%,100% { opacity: .25; transform: translateY(0); }
    50% { opacity: 1; transform: translateY(var(--adir, -4px)); } }

  @media (prefers-reduced-motion: reduce) {
    #orbit.on, #halo.on, #keycap.on { animation: none; }
    .trail { animation-duration: .3s; }
  }
</style>
</head>
<body>
<div id="stage"></div>
<div id="halo"></div>
<div id="orbit"></div>
<div id="cursor"></div>
<div id="keycap">⌨</div>
<div id="up" class="scrollArrow" style="--adir:-4px">▲</div>
<div id="down" class="scrollArrow" style="--adir:4px">▼</div>
<div id="cap"></div>
<script>
  const stage = document.getElementById("stage");
  const cursor = document.getElementById("cursor");
  const orbit = document.getElementById("orbit");
  const halo = document.getElementById("halo");
  const cap = document.getElementById("cap");
  const keycap = document.getElementById("keycap");
  const up = document.getElementById("up");
  const down = document.getElementById("down");

  let cx = -100, cy = -100;      // current DIP position
  let trailBudget = 0;
  let lastTrail = 0;
  let hideTimer = null;
  let capTimer = null;

  function showSelf() {
    cursor.classList.add("on"); orbit.classList.add("on"); halo.classList.add("on");
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  }
  function softHide(after) {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      cursor.classList.remove("on"); orbit.classList.remove("on");
      halo.classList.remove("on"); keycap.classList.remove("on");
      up.classList.remove("on"); down.classList.remove("on");
      cap.classList.remove("on");
    }, after);
  }
  function place(x, y) {
    cx = x; cy = y;
    cursor.style.left = x + "px"; cursor.style.top = y + "px";
    orbit.style.left = x + "px"; orbit.style.top = y + "px";
    halo.style.left = x + "px"; halo.style.top = y + "px";
    keycap.style.left = x + "px"; keycap.style.top = y + "px";
    up.style.left = (x - 5) + "px"; up.style.top = (y - 34) + "px";
    down.style.left = (x - 5) + "px"; down.style.top = (y + 22) + "px";
    cap.style.left = x + "px"; cap.style.top = (y - 40) + "px";
  }
  function say(text) {
    if (!text) { cap.classList.remove("on"); return; }
    cap.textContent = text;
    cap.classList.add("on");
    if (capTimer) clearTimeout(capTimer);
    capTimer = setTimeout(() => cap.classList.remove("on"), 2600);
  }
  function trail(x, y, dense) {
    const now = performance.now();
    const gap = dense ? 14 : 26;
    if (now - lastTrail < gap) return;
    lastTrail = now;
    const d = document.createElement("div");
    d.className = "trail";
    const s = dense ? 9 : 6.5;
    d.style.width = s + "px"; d.style.height = s + "px";
    d.style.left = (x - s / 2 + (Math.random() * 4 - 2)) + "px";
    d.style.top = (y - s / 2 + (Math.random() * 4 - 2)) + "px";
    stage.appendChild(d);
    setTimeout(() => d.remove(), 740);
  }
  function burst(x, y) {
    const ring = document.createElement("div");
    ring.className = "burst-ring";
    ring.style.left = x + "px"; ring.style.top = y + "px";
    ring.style.width = "64px"; ring.style.height = "64px";
    stage.appendChild(ring);
    setTimeout(() => ring.remove(), 540);
    for (let i = 0; i < 10; i++) {
      const s = document.createElement("div");
      s.className = "spark";
      s.style.left = x + "px"; s.style.top = y + "px";
      s.style.setProperty("--r", Math.round((i / 10) * 360 + Math.random() * 18) + "deg");
      s.style.setProperty("--d", (26 + Math.random() * 22) + "px");
      stage.appendChild(s);
      setTimeout(() => s.remove(), 660);
    }
  }
  function setMode(mode) {
    keycap.classList.toggle("on", mode === "typing");
    up.classList.toggle("on", mode === "scrolling");
    down.classList.toggle("on", mode === "scrolling");
    if (mode === "normal") { cursor.classList.remove("grab"); }
    if (mode === "grab") cursor.classList.add("grab");
  }

  // ── glide loop (quadratic bezier, easeInOutCubic — mirrors main-process math) ──
  let anim = null;
  function glide(from, to, durMs, label, mode) {
    showSelf(); setMode(mode || "normal"); if (label) say(label);
    const ctrlX = (from.x + to.x) / 2 + -(to.y - from.y) * 0.14;
    const ctrlY = (from.y + to.y) / 2 + (to.x - from.x) * 0.14;
    if (anim) cancelAnimationFrame(anim.raf);
    const t0 = performance.now();
    anim = { raf: 0 };
    const step = (now) => {
      const t = Math.min(1, (now - t0) / Math.max(1, durMs));
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const u = 1 - e;
      const x = u * u * from.x + 2 * u * e * ctrlX + e * e * to.x;
      const y = u * u * from.y + 2 * u * e * ctrlY + e * e * to.y;
      place(x, y);
      trail(x, y, mode === "grab");
      if (t < 1) anim.raf = requestAnimationFrame(step);
      else anim = null;
    };
    anim.raf = requestAnimationFrame(step);
  }

  window.quipCursor?.onEvent((ev) => {
    switch (ev.op) {
      case "style": {
        document.documentElement.style.setProperty("--ac", ev.accent);
        document.documentElement.style.setProperty("--ac2", ev.accent2);
        break;
      }
      case "move": glide(ev.from, ev.to, ev.durMs ?? 400, ev.label, ev.mode); break;
      case "press": cursor.classList.add("press"); break;
      case "burst": {
        cursor.classList.remove("press");
        place(cx, cy); burst(cx, cy);
        setTimeout(() => cursor.classList.remove("press"), 120);
        break;
      }
      case "mode": { showSelf(); setMode(ev.mode); if (ev.label) say(ev.label); break; }
      case "hide": softHide(0); break;
      default: break;
    }
  });
  softHide(100);
</script>
</body>
</html>`;
}
