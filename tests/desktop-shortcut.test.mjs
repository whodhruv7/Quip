// Tests: desktop shortcut (real .lnk), cross-button behavior, theme system
// integrity. Pure checks: no PowerShell runs here, no filesystem outside the
// repo, everything else is source/asset contract scanning.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { buildShortcutPs } = await import("../dist-test/electron/system/desktop-shortcut.js");

// ─── buildShortcutPs (pure) ──────────────────────────────────────────────────

test("buildShortcutPs writes a real WScript.Shell .lnk", () => {
  const ps = buildShortcutPs("C:\\Users\\dhruv\\Quip", "C:\\Users\\dhruv\\Desktop");
  assert.ok(ps.includes("New-Object -ComObject WScript.Shell"), "uses the same COM object Windows uses");
  assert.ok(ps.includes("CreateShortcut("), "creates a shortcut");
  assert.ok(ps.includes("Quip.lnk"), "names it Quip.lnk");
  assert.ok(ps.includes("wscript.exe"), "targets the script host (no console window)");
  assert.ok(ps.includes("launch-quip.vbs"), "runs the silent launcher");
  assert.ok(ps.includes("quip.ico"), "wears the mascot icon");
  assert.ok(ps.includes("$sc.Save()"), "actually saves");
});

test("buildShortcutPs escapes single quotes in paths", () => {
  const ps = buildShortcutPs("C:\\Users\\o'brien\\Quip", "C:\\Users\\o'brien\\Desktop");
  assert.ok(ps.includes("o''brien"), "doubled quotes escape correctly");
  assert.ok(!ps.includes("o'brien"), "raw quote would break the PS string");
});

// ─── Repo assets ────────────────────────────────────────────────────────────

test("launch-quip.vbs exists and runs the launcher hidden", async () => {
  const src = fs.readFileSync(new URL("../launch-quip.vbs", import.meta.url), "utf8");
  assert.ok(src.includes("run-quip.cmd"), "points at the real launcher");
  assert.ok(/shell\.Run\s+\w+,\s*0,/.test(src), "window style 0 = hidden console");
  assert.ok(src.includes("ScriptFullName"), "portable — locates the repo itself");
});

test("build/quip.ico is a real multi-size icon", async () => {
  const buf = fs.readFileSync(new URL("../build/quip.ico", import.meta.url));
  assert.ok(buf.length > 1000, "not empty");
  // ICO header: reserved=0, type=1, count>=2
  assert.equal(buf.readUInt16LE(0), 0);
  assert.equal(buf.readUInt16LE(2), 1);
  assert.ok(buf.readUInt16LE(4) >= 2, "multiple sizes embedded");
});

// ─── Wiring: IPC, boot auto-ensure, Settings surface ────────────────────────

test("main: shortcut IPC registered + auto-ensured at boot", async () => {
  const src = fs.readFileSync(new URL("../electron/main.ts", import.meta.url), "utf8");
  assert.ok(src.includes("IPC.ADD_DESKTOP_SHORTCUT"), "handler registered");
  assert.ok(src.includes("ensureQuipShortcut"), "module is wired in");
  assert.ok(/ensureQuipShortcut\(app\.getAppPath\(\)\)\.catch/.test(src), "auto-runs at boot, best-effort");
});

test("main: the cross button NEVER removes Quip from the screen", async () => {
  const src = fs.readFileSync(new URL("../electron/main.ts", import.meta.url), "utf8");
  assert.ok(src.includes("the cross button NEVER removes Quip"), "close interception documents the rule");
  const closeBlock = src.slice(src.indexOf('win.on("close"'));
  const blockEnd = closeBlock.indexOf("});");
  const body = closeBlock.slice(0, blockEnd);
  assert.ok(body.includes("e.preventDefault()"), "close is always intercepted (quit only via Settings)");
  assert.ok(body.includes('setWindowMode(win, "companion")'), "X on the app screen shrinks back to the mascot");
  assert.ok(!body.includes("win.hide()"), "X must not hide the whole window — the mascot stays visible");
});

test("preload + shared: addDesktopShortcut binding exists", async () => {
  const { IPC } = await import("../dist-test/electron/shared.js");
  assert.equal(IPC.ADD_DESKTOP_SHORTCUT, "quip:add-desktop-shortcut");
  const preload = fs.readFileSync(new URL("../electron/preload.ts", import.meta.url), "utf8");
  assert.ok(preload.includes("addDesktopShortcut"), "preload binds the call");
});

test("settings: shortcut card exists with honest feedback", async () => {
  const src = fs.readFileSync(new URL("../src/components/SettingsPanel.tsx", import.meta.url), "utf8");
  assert.ok(src.includes("Quip icon on my desktop"), "card present");
  assert.ok(src.includes("addDesktopShortcut"), "calls the real IPC");
  assert.ok(src.includes("Create shortcut"), "button present");
});

// ─── Theme system integrity (the chatbar-readability regression) ───────────

test("css: no duplicate theme blocks (violet was defined twice — the chatbar bug)", async () => {
  const css = fs.readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  for (const id of ["violet", "light", "aqua", "pink", "mint", "sunset", "ocean", "forest", "midnight", "black"]) {
    // Count PALETTE blocks (they carry --quip-accent) — chrome-brand
    // one-liners exist too and are fine.
    const re = new RegExp(`\\[data-theme="${id}"\\]\\s*\\{([^}]*)\\}`, "g");
    const paletteBlocks = [...css.matchAll(re)].filter((m) => m[1].includes("--quip-accent"));
    assert.equal(paletteBlocks.length, 1, `palette ${id} must be defined exactly once, found ${paletteBlocks.length}`);
  }
});

test("css: every theme defines the complete variable set (guaranteed contrast)", async () => {
  const css = fs.readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  const required = ["--quip-bg", "--quip-bg-soft", "--quip-text", "--quip-text-soft", "--quip-line", "--quip-accent", "--quip-accent-2", "--quip-accent-3", "--quip-accent-deep", "--quip-glow"];
  for (const id of ["violet", "light", "aqua", "pink", "mint", "sunset", "ocean", "forest", "midnight", "black"]) {
    const re = new RegExp(`\\[data-theme="${id}"\\]\\s*\\{([^}]*)\\}`, "g");
    const palette = [...css.matchAll(re)].find((m) => m[1].includes("--quip-accent"));
    assert.ok(palette, `theme ${id} palette block missing`);
    for (const v of required) {
      assert.ok(palette[1].includes(v), `theme ${id} missing ${v}`);
    }
  }
});

test("css: chatbar text is theme-driven, never hardcoded white", async () => {
  const chatInput = fs.readFileSync(new URL("../src/components/ChatInput.tsx", import.meta.url), "utf8");
  assert.ok(!chatInput.includes("bg-white/80"), "hardcoded white surface removed");
  assert.ok(!chatInput.includes("text-quip-ink"), "static ink text removed (theme-driven now)");
  assert.ok(chatInput.includes("quip-composer-input"), "uses the theme-aware class");
  const css = fs.readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  const cls = css.slice(css.indexOf(".quip-composer-input {"), css.indexOf("}", css.indexOf(".quip-composer-input {")));
  assert.ok(cls.includes("rgb(var(--quip-text))"), "input text follows the theme");
});
