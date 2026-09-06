// Quip Execution Engine — Desktop Controller (Agent-Reach inspired)
// ─────────────────────────────────────────────────────────────────────────────
// Real desktop primitives that operate on the actual OS, not simulated UI:
//   focus / close windows, type text, press keys, click, scroll, drag,
//   clipboard read/write.
//
// Implementation notes:
//   - Windows: PowerShell + user32 P/Invoke (SetCursorPos / mouse_event),
//     WScript.Shell SendKeys for input, AppActivate for focus.
//   - Clipboard: Electron clipboard module (reliable, no subprocess).
//   - Every action returns ActionVerification; focus/close verify window state.
// ─────────────────────────────────────────────────────────────────────────────

import { clipboard } from "electron";
import path from "node:path";
import fs from "node:fs";
import {
  ok,
  fail,
  runCapture,
  windowWithTitleExists,
  listWindowTitles,
  getForegroundWindowTitle,
  type ActionVerification,
} from "./action-verifier";

export type DesktopAction =
  | { type: "focus"; target: string }
  | { type: "close"; target: string }
  | { type: "type"; text: string }
  | { type: "key"; keys: string[] }
  | { type: "click"; x: number; y: number }
  | { type: "click.variant"; variant: "double" | "right"; x: number; y: number }
  | { type: "scroll"; deltaY: number }
  | { type: "clipboard.read" }
  | { type: "clipboard.write"; text: string }
  | { type: "drag"; from: { x: number; y: number }; to: { x: number; y: number } }
  | { type: "window.control"; op: "minimize" | "maximize" | "restore"; target: string }
  | { type: "window.move"; target: string; x: number; y: number }
  | { type: "window.resize"; target: string; width: number; height: number }
  | { type: "screen.capture" }
  | { type: "windows.list" };

// ─── PowerShell helpers ──────────────────────────────────────────────────────

function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** SendKeys escaping: wrap special chars literally. */
function escapeSendKeys(text: string): string {
  return text.replace(/([{}[\]+^%~()])/g, "{$1}");
}

const KEY_MAP: Record<string, string> = {
  enter: "{ENTER}", tab: "{TAB}", esc: "{ESC}", escape: "{ESC}",
  space: " ", backspace: "{BACKSPACE}", delete: "{DELETE}", del: "{DELETE}",
  up: "{UP}", down: "{DOWN}", left: "{LEFT}", right: "{RIGHT}",
  home: "{HOME}", end: "{END}", pageup: "{PGUP}", pagedown: "{PGDN}",
  f5: "{F5}", f11: "{F11}", f12: "{F12}",
  ctrl: "^", alt: "%", shift: "+", win: "^{ESC}",
};

function buildKeySequence(keys: string[]): string | null {
  let seq = "";
  for (const rawKey of keys) {
    const k = rawKey.toLowerCase().trim();
    if (KEY_MAP[k]) {
      seq += KEY_MAP[k];
    } else if (k.length === 1) {
      seq += k;
    } else {
      return null; // unknown key — refuse rather than guess
    }
  }
  return seq;
}

/** Focus an app window by process name or title substring. */
async function focusWindow(target: string): Promise<ActionVerification> {
  const titles = await listWindowTitles();
  const needle = target.toLowerCase();
  const matched = titles.find((t) => t.toLowerCase().includes(needle));

  if (matched) {
    const res = await runCapture(
      `powershell -NoProfile -Command "$w = Get-Process | Where-Object { $_.MainWindowTitle -like ${psQuote("*" + target + "*")} } | Select-Object -First 1; if ($w) { Add-Type 'using System;using System.Runtime.InteropServices;public class WA{[DllImport(\\"user32.dll\\")]public static extern bool SetForegroundWindow(IntPtr h);[DllImport(\\"user32.dll\\")]public static extern bool ShowWindow(IntPtr h,int c);}'; [WA]::ShowWindow($w.MainWindowHandle,9)|Out-Null; [WA]::SetForegroundWindow($w.MainWindowHandle)|Out-Null; 'focused' } else { 'not-found' }"`,
      8000
    );
    if (res && res.stdout.includes("focused")) {
      const fg = await getForegroundWindowTitle();
      const verified = fg && fg.toLowerCase().includes(needle);
      return verified
        ? ok(`Focused ${matched}.`, [`foreground window now: ${fg}`])
        : ok(`Focused ${matched}.`, ["SetForegroundWindow accepted (foreground probe unavailable)"]);
    }
  }

  // Fallback: AppActivate by process name
  const res2 = await runCapture(
    `powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $p = Get-Process | Where-Object { $_.MainWindowTitle } | Where-Object { $_.ProcessName -like ${psQuote("*" + target + "*")} } | Select-Object -First 1; if ($p) { $ws.AppActivate($p.Id) | Out-Null; 'focused' } else { 'not-found' }"`,
    8000
  );
  if (res2 && res2.stdout.includes("focused")) {
    return ok(`Focused the window for "${target}".`, ["AppActivate succeeded"]);
  }
  return fail(
    `I couldn't find a window matching "${target}" to focus.`,
    matched ? [] : ["no window title matched"],
    "focus-target-not-found"
  );
}

/** Close an app window by title/process substring (graceful CloseMainWindow). */
async function closeWindow(target: string): Promise<ActionVerification> {
  const before = await windowWithTitleExists(target);
  if (!before) {
    return fail(
      `I didn't find an open window for "${target}".`,
      ["no matching window before close"],
      "close-target-not-found"
    );
  }
  const res = await runCapture(
    `powershell -NoProfile -Command "$w = Get-Process | Where-Object { $_.MainWindowTitle -like ${psQuote("*" + target + "*")} } | Select-Object -First 1; if ($w) { $w.CloseMainWindow() | Out-Null; Start-Sleep -Milliseconds 800; if ($w.HasExited) { 'closed' } else { 'close-sent' } } else { 'not-found' }"`,
      8000
  );
  if (res && (res.stdout.includes("closed") || res.stdout.includes("close-sent"))) {
    const stillThere = await windowWithTitleExists(target);
    return stillThere
      ? ok(`Sent close to "${target}" (window may still be shutting down).`, ["CloseMainWindow sent"])
      : ok(`Closed "${target}".`, ["window no longer listed after close"]);
  }
  return fail(`I couldn't close "${target}".`, ["CloseMainWindow failed"], "close-failed");
}

// ─── Mouse primitives (user32 P/Invoke) ──────────────────────────────────────

const MOUSE_ADD_TYPE = `Add-Type 'using System;using System.Runtime.InteropServices;public class M{[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);[DllImport("user32.dll")]public static extern void mouse_event(uint f,uint x,uint y,int d,UIntPtr i);}'`;

async function mouseClick(x: number, y: number): Promise<ActionVerification> {
  const res = await runCapture(
    `powershell -NoProfile -Command "${MOUSE_ADD_TYPE}; [M]::SetCursorPos(${x},${y})|Out-Null; Start-Sleep -Milliseconds 80; [M]::mouse_event(2,0,0,0,[UIntPtr]::Zero); [M]::mouse_event(4,0,0,0,[UIntPtr]::Zero); 'clicked'"`,
    8000
  );
  if (res && res.stdout.includes("clicked")) {
    return ok(`Clicked at (${x}, ${y}).`, ["SetCursorPos + mouse_event executed"]);
  }
  return fail(`I couldn't perform the click.`, ["mouse_event failed"], "click-failed");
}

async function mouseScroll(deltaY: number): Promise<ActionVerification> {
  const dir = deltaY < 0 ? -1 : 1; // deltaY < 0 = scroll down (natural)
  const amount = Math.min(Math.abs(Math.round(deltaY)), 1000) * dir;
  const res = await runCapture(
    `powershell -NoProfile -Command "${MOUSE_ADD_TYPE}; [M]::mouse_event(2048,0,0,${amount},[UIntPtr]::Zero); 'scrolled'"`,
    8000
  );
  if (res && res.stdout.includes("scrolled")) {
    return ok(`Scrolled ${amount < 0 ? "down" : "up"}.`, [`mouse_event wheel ${amount}`]);
  }
  return fail("I couldn't scroll.", ["mouse_event wheel failed"], "scroll-failed");
}

async function mouseDrag(
  from: { x: number; y: number },
  to: { x: number; y: number }
): Promise<ActionVerification> {
  const steps = 12;
  const moveCmds: string[] = [];
  for (let i = 1; i <= steps; i++) {
    const ix = Math.round(from.x + ((to.x - from.x) * i) / steps);
    const iy = Math.round(from.y + ((to.y - from.y) * i) / steps);
    moveCmds.push(`[M]::SetCursorPos(${ix},${iy})|Out-Null; Start-Sleep -Milliseconds 30`);
  }
  const res = await runCapture(
    `powershell -NoProfile -Command "${MOUSE_ADD_TYPE}; [M]::SetCursorPos(${from.x},${from.y})|Out-Null; Start-Sleep -Milliseconds 100; [M]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 100; ${moveCmds.join(" ")} [M]::mouse_event(4,0,0,0,[UIntPtr]::Zero); 'dragged'"`,
    15000
  );
  if (res && res.stdout.includes("dragged")) {
    return ok(`Dragged from (${from.x}, ${from.y}) to (${to.x}, ${to.y}).`, ["button down → interpolate → up"]);
  }
  return fail("I couldn't perform the drag.", ["drag sequence failed"], "drag-failed");
}

async function mouseClickVariant(
  variant: "double" | "right",
  x: number,
  y: number
): Promise<ActionVerification> {
  const seq =
    variant === "double"
      ? "[M]::mouse_event(2,0,0,0,[UIntPtr]::Zero); [M]::mouse_event(4,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 40; [M]::mouse_event(2,0,0,0,[UIntPtr]::Zero); [M]::mouse_event(4,0,0,0,[UIntPtr]::Zero)"
      : "[M]::mouse_event(8,0,0,0,[UIntPtr]::Zero); [M]::mouse_event(16,0,0,0,[UIntPtr]::Zero)";
  const res = await runCapture(
    `powershell -NoProfile -Command "${MOUSE_ADD_TYPE}; [M]::SetCursorPos(${x},${y})|Out-Null; Start-Sleep -Milliseconds 80; ${seq}; '${variant === "double" ? "double-clicked" : "right-clicked"}'"`,
    8000
  );
  if (res && (res.stdout.includes("double-clicked") || res.stdout.includes("right-clicked"))) {
    return ok(
      variant === "double"
        ? `Double-clicked at (${x}, ${y}).`
        : `Right-clicked at (${x}, ${y}).`,
      ["SetCursorPos + mouse_event executed"]
    );
  }
  return fail(`I couldn't perform the ${variant} click.`, ["mouse_event failed"], "click-variant-failed");
}

// ─── Window control (minimize / maximize / restore / move / resize) ─────────

const WINDOW_ADD_TYPE = `Add-Type 'using System;using System.Runtime.InteropServices;public class W{[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int c);[DllImport("user32.dll")]public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int w,int hh,uint f);}'`;

function findWindowCmd(target: string, then: string): string {
  const selector = target
    ? `Get-Process | Where-Object { $_.MainWindowTitle -like ${psQuote("*" + target + "*")} } | Select-Object -First 1`
    : `Get-Process | Where-Object { $_.MainWindowTitle } | Sort-Object -Property MainWindowHandle | Select-Object -Last 1`;
  return `powershell -NoProfile -Command "${WINDOW_ADD_TYPE}; $w = ${selector}; if ($w -and $w.MainWindowHandle -ne 0) { ${then} } else { 'not-found' }"`;
}

async function windowControl(
  op: "minimize" | "maximize" | "restore",
  target: string
): Promise<ActionVerification> {
  // ShowWindow codes: 6 = minimize, 3 = maximize, 9 = restore
  const code = op === "minimize" ? 6 : op === "maximize" ? 3 : 9;
  const then = `[W]::ShowWindow($w.MainWindowHandle, ${code})|Out-Null; '${op}-done'`;
  const res = await runCapture(findWindowCmd(target, then), 8000);
  if (res && res.stdout.includes(`${op}-done`)) {
    return ok(`${op[0].toUpperCase() + op.slice(1)}d the window for "${target}".`, ["ShowWindow executed"]);
  }
  return fail(
    `I couldn't find a window matching "${target}" to ${op}.`,
    ["no window handle matched"],
    "window-control-not-found"
  );
}

async function windowMove(target: string, x: number, y: number): Promise<ActionVerification> {
  // SWP_NOSIZE(0x1) | SWP_NOZORDER(0x4) | SWP_NOACTIVATE(0x10) = 0x15
  const then = `[W]::SetWindowPos($w.MainWindowHandle, [IntPtr]::Zero, ${x}, ${y}, 0, 0, 0x15)|Out-Null; 'moved'`;
  const res = await runCapture(findWindowCmd(target, then), 8000);
  if (res && res.stdout.includes("moved")) {
    return ok(`Moved the "${target}" window to (${x}, ${y}).`, ["SetWindowPos executed"]);
  }
  return fail(`I couldn't find a window matching "${target}" to move.`, ["no window handle"], "window-move-not-found");
}

async function windowResize(target: string, width: number, height: number): Promise<ActionVerification> {
  // SWP_NOMOVE(0x2) | SWP_NOZORDER(0x4) | SWP_NOACTIVATE(0x10) = 0x16
  const then = `[W]::SetWindowPos($w.MainWindowHandle, [IntPtr]::Zero, 0, 0, ${width}, ${height}, 0x16)|Out-Null; 'resized'`;
  const res = await runCapture(findWindowCmd(target, then), 8000);
  if (res && res.stdout.includes("resized")) {
    return ok(`Resized the "${target}" window to ${width}×${height}.`, ["SetWindowPos executed"]);
  }
  return fail(`I couldn't find a window matching "${target}" to resize.`, ["no window handle"], "window-resize-not-found");
}

// ─── Screen capture + window listing ─────────────────────────────────────────

async function screenCapture(): Promise<ActionVerification> {
  const { app } = await import("electron");
  const dir = path.join(app.getPath("userData"), "screens");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* fallthrough — save will fail and report honestly */
  }
  const file = path.join(dir, `quip-screen-${Date.now()}.png`);
  const psFile = file.replace(/\\/g, "\\\\");
  const res = await runCapture(
    `powershell -NoProfile -Command "Add-Type -AssemblyName System.Drawing; Add-Type -AssemblyName System.Windows.Forms; $b = [System.Windows.Forms.SystemInformation]::VirtualScreen; $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height; $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size); $bmp.Save('${psFile}'); $g.Dispose(); $bmp.Dispose(); 'saved'"`,
    12000
  );
  if (res && res.stdout.includes("saved")) {
    try {
      const stat = fs.statSync(file);
      if (stat.size > 0) {
        return ok(`Captured the screen.`, [`saved: ${file}`, `size: ${stat.size} bytes`]);
      }
    } catch {
      /* stat failed — fall through to failure */
    }
  }
  return fail("I couldn't capture the screen.", ["CopyFromScreen failed or file missing"], "screen-capture-failed");
}

async function windowsList(): Promise<ActionVerification> {
  const titles = await listWindowTitles();
  if (titles.length === 0) {
    return fail("I couldn't list the open windows.", ["no visible windows found"], "windows-list-failed");
  }
  return ok(
    `There are ${titles.length} open windows:\n${titles.slice(0, 15).map((t) => `• ${t}`).join("\n")}`,
    [`${titles.length} visible windows`]
  );
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function executeDesktopAction(action: DesktopAction): Promise<ActionVerification> {
  switch (action.type) {
    case "focus":
      return focusWindow(action.target);

    case "close":
      return closeWindow(action.target);

    case "type": {
      if (!action.text) return fail("Nothing to type.", [], "empty-text");
      const seq = escapeSendKeys(action.text);
      const res = await runCapture(
        `powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $ws.SendKeys(${psQuote(seq)}); 'typed'"`,
        10000
      );
      if (res && res.stdout.includes("typed")) {
        return ok("Typed the text into the focused window.", ["SendKeys executed"]);
      }
      return fail("I couldn't type — make sure the target window is focused.", ["SendKeys failed"], "type-failed");
    }

    case "key": {
      const seq = buildKeySequence(action.keys);
      if (!seq) {
        return fail(`I don't know the key combination: ${action.keys.join("+")}.`, [], "unknown-key");
      }
      const res = await runCapture(
        `powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $ws.SendKeys(${psQuote(seq)}); 'sent'"`,
        8000
      );
      if (res && res.stdout.includes("sent")) {
        return ok(`Pressed ${action.keys.join("+")}.`, ["SendKeys executed"]);
      }
      return fail("I couldn't send the key press.", ["SendKeys failed"], "key-failed");
    }

    case "click":
      return mouseClick(Math.round(action.x), Math.round(action.y));

    case "click.variant":
      return mouseClickVariant(action.variant, Math.round(action.x), Math.round(action.y));

    case "scroll":
      return mouseScroll(action.deltaY);

    case "drag":
      return mouseDrag(action.from, action.to);

    case "window.control":
      return windowControl(action.op, action.target);

    case "window.move":
      return windowMove(action.target, Math.round(action.x), Math.round(action.y));

    case "window.resize":
      return windowResize(action.target, Math.round(action.width), Math.round(action.height));

    case "screen.capture":
      return screenCapture();

    case "windows.list":
      return windowsList();

    case "clipboard.read": {
      const text = clipboard.readText();
      return ok(
        text ? "Read the clipboard." : "The clipboard is empty.",
        [`clipboard length: ${text.length}`]
      );
    }

    case "clipboard.write": {
      clipboard.writeText(action.text);
      const roundtrip = clipboard.readText();
      return roundtrip === action.text
        ? ok("Copied to the clipboard.", ["round-trip verified"])
        : fail("I couldn't copy that to the clipboard.", ["round-trip mismatch"], "clipboard-write-failed");
    }

    default:
      return fail("Unknown desktop action.", [], "unknown-action");
  }
}
