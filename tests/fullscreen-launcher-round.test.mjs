// Tests: launcher reliability, TRUE full screen mode (mode 3), opaque themed
// chatbox, TopBar logo, screen-mode surfaces. Pure source-contract scans +
// compiled pure helpers — no Electron, no Windows, no filesystem outside repo.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

// ─── 1. LAUNCHER — the app must open, every time, fast ───────────────────────

test("run-quip.cmd installs deps ALWAYS (stale node_modules broke boot before)", async () => {
  const src = read("../run-quip.cmd");
  assert.ok(src.includes("npm install"), "runs npm install");
  // The old bug: install only when node_modules missing. The gate must be the
  // build stamp + timestamps, not "node_modules exists".
  assert.ok(!/if not exist "node_modules" \(\s*[^)]*npm install/.test(src), "install is NOT gated on node_modules existence");
  assert.ok(src.includes("--no-audit"), "quiet install");
});

test("run-quip.cmd builds only when sources changed (fast warm launch)", async () => {
  const src = read("../run-quip.cmd");
  assert.ok(src.includes(".quip-build-stamp"), "stamp file drives rebuilds");
  assert.ok(src.includes("LastWriteTime"), "timestamp comparison via PowerShell");
  assert.ok(src.includes("npm run build"), "still builds when needed");
});

test("run-quip.cmd logs everything + pops a visible error box (hidden console)", async () => {
  const src = read("../run-quip.cmd");
  assert.ok(src.includes("quip-launch.log"), "every step lands in a log file");
  assert.ok(src.includes("MessageBox"), "failures are VISIBLE even from the hidden shortcut");
  assert.ok(src.includes("QUIP_FAILMSG"), "failure reason is passed to the box");
  // No bare `pause` — it hangs an invisible console forever.
  assert.ok(!src.includes("pause"), "no invisible pause in a hidden console");
});

// ─── 2. TRUE FULL SCREEN — the third screen mode ─────────────────────────────

test("shared: WindowMode has four modes incl. fullscreen", async () => {
  const { } = await import("../dist-test/electron/shared.js");
  const src = read("../electron/shared.ts");
  assert.ok(/export type WindowMode = "companion" \| "panel" \| "full" \| "fullscreen";/.test(src), "fullscreen added to the union");
});

test("main: fullscreen takes the ENTIRE display, edge to edge", async () => {
  const src = read("../electron/main.ts");
  assert.ok(src.includes('mode === "fullscreen"'), "fullscreen branch in setWindowMode");
  assert.ok(src.includes("display.bounds"), "uses the display's full bounds");
  assert.ok(src.includes("isFullLayout"), "full + fullscreen share app-layout treatment");
  assert.ok(src.includes("isWindowMode"), "IPC validation accepts the new mode");
});

test("renderer: fullscreen layout renders edge-to-edge + Esc exits", async () => {
  const app = read("../src/App.tsx");
  assert.ok(app.includes('viewMode === "fullscreen"'), "fullscreen layout exists");
  assert.ok(app.includes('"fullscreen-app"'), "distinct fullscreen tree");
  const fsIdx = app.indexOf('viewMode === "fullscreen"');
  const block = app.slice(fsIdx, fsIdx + 6000);
  assert.ok(block.includes("inset: 0") && block.includes("rgb(var(--quip-bg))"), "opaque themed, zero inset");
  assert.ok(app.includes('e.key === "Escape"'), "Esc leaves fullscreen (not the app)");
  assert.ok(app.includes('enterMode("full")'), "Esc returns to the full app");
});

test("TopBar: fullscreen button present + mode-aware", async () => {
  const tb = read("../src/components/TopBar.tsx");
  assert.ok(tb.includes("onToggleFullscreen"), "fullscreen toggle prop");
  assert.ok(tb.includes("Exit full screen"), "title flips with the mode");
  assert.ok(tb.includes('mode === "fullscreen"'), "button reflects the current mode");
});

test("Settings: screen mode card offers all four modes", async () => {
  const sp = read("../src/components/SettingsPanel.tsx");
  assert.ok(sp.includes("Screen mode"), "card present");
  for (const label of ["Companion", "Panel", "Full App", "Full Screen"]) {
    assert.ok(sp.includes(`label: "${label}"`), `mode chip: ${label}`);
  }
  assert.ok(sp.includes("setWindowMode"), "applies via the real IPC");
});

// ─── 3. OPAQUE THEMED CHATBOX — the desktop must never show through ──────────

test("panel + full surfaces are OPAQUE and theme-driven", async () => {
  const app = read("../src/App.tsx");
  assert.ok(!app.includes("rgba(255,255,255,0.72)"), "the old 28%-see-through panel is gone");
  assert.ok(!app.includes("rgba(252,252,253,0.88)"), "the old 12%-see-through full app is gone");
  assert.ok(app.includes("rgb(var(--quip-bg))"), "surfaces use the theme background");
  const ci = read("../src/components/ChatInput.tsx");
  assert.ok(!ci.includes("rgba(var(--quip-bg), 0.72)"), "composer bar is opaque too");
});

test("chat surfaces follow the theme — no light-only hardcoded inks", async () => {
  const files = [
    "../src/App.tsx",
    "../src/components/ChatMessage.tsx",
    "../src/components/ChatWelcome.tsx",
    "../src/components/ChatLayout.tsx",
    "../src/components/ActionApprovalPanel.tsx",
    "../src/components/ConfirmModal.tsx",
    "../src/components/CompanionSwitch.tsx",
    "../src/components/ScanOverlay.tsx",
  ];
  const banned = ["#374151", "#9ca3af", "#10131f", '#111111"', '"#111"', '"#6b7280"', '"white"', "rgba(255,255,255,0.98)"];
  for (const f of files) {
    const src = read(f);
    for (const b of banned) {
      assert.ok(!src.includes(b), `${f} still hardcodes ${b}`);
    }
  }
});

test("assistant bubbles use theme ink (readable in dark + light palettes)", async () => {
  const cm = read("../src/components/ChatMessage.tsx");
  assert.ok(cm.includes("rgb(var(--quip-text))"), "bubble text = theme text");
  assert.ok(cm.includes("rgb(var(--quip-bg-soft))") || cm.includes("rgba(var(--quip-line), 0.05)"), "bubble surface = theme surface");
});

// ─── 4. LOGO — top-left of the chatbox ──────────────────────────────────────

test("TopBar: the Quip logo mark sits at the top-left", async () => {
  const tb = read("../src/components/TopBar.tsx");
  const logoIdx = tb.indexOf('src={quipMark}');
  assert.ok(logoIdx > -1, "logo image present");
  assert.ok(tb.indexOf("Companion dots") > logoIdx || tb.indexOf('alt="Quip"') < tb.indexOf("companionId) => {"), "logo renders before the companion dots");
  assert.ok(tb.includes('alt="Quip"'), "accessible name");
});

// ─── 5. SHORTCUT — normal window style ──────────────────────────────────────

test("desktop shortcut opens a normal window (not minimized)", async () => {
  const { buildShortcutPs } = await import("../dist-test/electron/system/desktop-shortcut.js");
  const ps = buildShortcutPs("C:\\Q", "C:\\D");
  assert.ok(ps.includes("WindowStyle = 1"), "normal window style");
  assert.ok(!ps.includes("WindowStyle = 7"), "no minimized style");
});
