"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeDesktopAction = executeDesktopAction;
const electron_1 = require("electron");
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const action_verifier_1 = require("./action-verifier");
// ─── PowerShell helpers ──────────────────────────────────────────────────────
function psQuote(s) {
    return `'${s.replace(/'/g, "''")}'`;
}
/** SendKeys escaping: wrap special chars literally. */
function escapeSendKeys(text) {
    return text.replace(/([{}[\]+^%~()])/g, "{$1}");
}
const KEY_MAP = {
    enter: "{ENTER}", tab: "{TAB}", esc: "{ESC}", escape: "{ESC}",
    space: " ", backspace: "{BACKSPACE}", delete: "{DELETE}", del: "{DELETE}",
    up: "{UP}", down: "{DOWN}", left: "{LEFT}", right: "{RIGHT}",
    home: "{HOME}", end: "{END}", pageup: "{PGUP}", pagedown: "{PGDN}",
    f5: "{F5}", f11: "{F11}", f12: "{F12}",
    ctrl: "^", alt: "%", shift: "+", win: "^{ESC}",
};
function buildKeySequence(keys) {
    let seq = "";
    for (const rawKey of keys) {
        const k = rawKey.toLowerCase().trim();
        if (KEY_MAP[k]) {
            seq += KEY_MAP[k];
        }
        else if (k.length === 1) {
            seq += k;
        }
        else {
            return null; // unknown key — refuse rather than guess
        }
    }
    return seq;
}
/** Focus an app window by process name or title substring. */
async function focusWindow(target) {
    const titles = await (0, action_verifier_1.listWindowTitles)();
    const needle = target.toLowerCase();
    const matched = titles.find((t) => t.toLowerCase().includes(needle));
    if (matched) {
        const res = await (0, action_verifier_1.runCapture)(`powershell -NoProfile -Command "$w = Get-Process | Where-Object { $_.MainWindowTitle -like ${psQuote("*" + target + "*")} } | Select-Object -First 1; if ($w) { Add-Type 'using System;using System.Runtime.InteropServices;public class WA{[DllImport(\\"user32.dll\\")]public static extern bool SetForegroundWindow(IntPtr h);[DllImport(\\"user32.dll\\")]public static extern bool ShowWindow(IntPtr h,int c);}'; [WA]::ShowWindow($w.MainWindowHandle,9)|Out-Null; [WA]::SetForegroundWindow($w.MainWindowHandle)|Out-Null; 'focused' } else { 'not-found' }"`, 8000);
        if (res && res.stdout.includes("focused")) {
            const fg = await (0, action_verifier_1.getForegroundWindowTitle)();
            const verified = fg && fg.toLowerCase().includes(needle);
            return verified
                ? (0, action_verifier_1.ok)(`Focused ${matched}.`, [`foreground window now: ${fg}`])
                : (0, action_verifier_1.ok)(`Focused ${matched}.`, ["SetForegroundWindow accepted (foreground probe unavailable)"]);
        }
    }
    // Fallback: AppActivate by process name
    const res2 = await (0, action_verifier_1.runCapture)(`powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $p = Get-Process | Where-Object { $_.MainWindowTitle } | Where-Object { $_.ProcessName -like ${psQuote("*" + target + "*")} } | Select-Object -First 1; if ($p) { $ws.AppActivate($p.Id) | Out-Null; 'focused' } else { 'not-found' }"`, 8000);
    if (res2 && res2.stdout.includes("focused")) {
        return (0, action_verifier_1.ok)(`Focused the window for "${target}".`, ["AppActivate succeeded"]);
    }
    return (0, action_verifier_1.fail)(`I couldn't find a window matching "${target}" to focus.`, matched ? [] : ["no window title matched"], "focus-target-not-found");
}
/** Close an app by title/process substring — ALL matching windows, verified. */
async function closeWindow(target) {
    const before = await (0, action_verifier_1.windowWithTitleExists)(target);
    if (!before) {
        return (0, action_verifier_1.fail)(`I didn't find an open window for "${target}".`, ["no matching window before close"], "close-target-not-found");
    }
    // Close EVERY matching top-level window — Chrome/Edge/Explorer often run
    // several; closing only the first left the rest open.
    const res = await (0, action_verifier_1.runCapture)(`powershell -NoProfile -Command "$procs = @(Get-Process | Where-Object { $_.MainWindowTitle -like ${psQuote("*" + target + "*")} }); if ($procs.Count -gt 0) { $n = 0; foreach ($p in $procs) { try { if ($p.CloseMainWindow()) { $n++ } } catch {} }; Start-Sleep -Milliseconds 800; Write-Output ('closing:' + $n) } else { 'not-found' }"`, 8000);
    if (res && res.stdout.includes("closing:")) {
        const count = res.stdout.split("closing:")[1]?.trim() ?? "0";
        const stillThere = await (0, action_verifier_1.windowWithTitleExists)(target);
        return stillThere
            ? (0, action_verifier_1.ok)(`Sent close to "${target}" (${count} window${count === "1" ? "" : "s"}) — some may still be shutting down.`, [`close sent to ${count} window(s)`])
            : (0, action_verifier_1.ok)(`Closed "${target}".`, [`close sent to ${count} window(s)`, "no matching windows remain"]);
    }
    return (0, action_verifier_1.fail)(`I couldn't close "${target}".`, ["CloseMainWindow failed"], "close-failed");
}
// ─── Mouse primitives (user32 P/Invoke) ──────────────────────────────────────
const MOUSE_ADD_TYPE = `Add-Type 'using System;using System.Runtime.InteropServices;public class M{[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);[DllImport("user32.dll")]public static extern void mouse_event(uint f,uint x,uint y,int d,UIntPtr i);}'`;
async function mouseClick(x, y) {
    const res = await (0, action_verifier_1.runCapture)(`powershell -NoProfile -Command "${MOUSE_ADD_TYPE}; [M]::SetCursorPos(${x},${y})|Out-Null; Start-Sleep -Milliseconds 80; [M]::mouse_event(2,0,0,0,[UIntPtr]::Zero); [M]::mouse_event(4,0,0,0,[UIntPtr]::Zero); 'clicked'"`, 8000);
    if (res && res.stdout.includes("clicked")) {
        return (0, action_verifier_1.ok)(`Clicked at (${x}, ${y}).`, ["SetCursorPos + mouse_event executed"]);
    }
    return (0, action_verifier_1.fail)(`I couldn't perform the click.`, ["mouse_event failed"], "click-failed");
}
/** Current cursor position (System.Windows.Forms.Cursor). */
async function cursorPosition() {
    const res = await (0, action_verifier_1.runCapture)(`powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $p = [System.Windows.Forms.Cursor]::Position; Write-Output \"$($p.X),$($p.Y)\""`, 6000);
    const m = res?.stdout?.trim().match(/^(\d+)\s*,\s*(\d+)$/);
    return m ? { x: parseInt(m[1], 10), y: parseInt(m[2], 10) } : null;
}
/** Resolve click coordinates — undefined coords mean "click where the cursor is". */
async function resolveClickPoint(x, y) {
    if (typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)) {
        return { x, y };
    }
    return cursorPosition();
}
async function mouseScroll(deltaY) {
    const dir = deltaY < 0 ? -1 : 1; // deltaY < 0 = scroll down (natural)
    const amount = Math.min(Math.abs(Math.round(deltaY)), 1000) * dir;
    const res = await (0, action_verifier_1.runCapture)(`powershell -NoProfile -Command "${MOUSE_ADD_TYPE}; [M]::mouse_event(2048,0,0,${amount},[UIntPtr]::Zero); 'scrolled'"`, 8000);
    if (res && res.stdout.includes("scrolled")) {
        return (0, action_verifier_1.ok)(`Scrolled ${amount < 0 ? "down" : "up"}.`, [`mouse_event wheel ${amount}`]);
    }
    return (0, action_verifier_1.fail)("I couldn't scroll.", ["mouse_event wheel failed"], "scroll-failed");
}
async function mouseDrag(from, to) {
    const steps = 12;
    const moveCmds = [];
    for (let i = 1; i <= steps; i++) {
        const ix = Math.round(from.x + ((to.x - from.x) * i) / steps);
        const iy = Math.round(from.y + ((to.y - from.y) * i) / steps);
        moveCmds.push(`[M]::SetCursorPos(${ix},${iy})|Out-Null; Start-Sleep -Milliseconds 30`);
    }
    const res = await (0, action_verifier_1.runCapture)(`powershell -NoProfile -Command "${MOUSE_ADD_TYPE}; [M]::SetCursorPos(${from.x},${from.y})|Out-Null; Start-Sleep -Milliseconds 100; [M]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 100; ${moveCmds.join(" ")} [M]::mouse_event(4,0,0,0,[UIntPtr]::Zero); 'dragged'"`, 15000);
    if (res && res.stdout.includes("dragged")) {
        return (0, action_verifier_1.ok)(`Dragged from (${from.x}, ${from.y}) to (${to.x}, ${to.y}).`, ["button down → interpolate → up"]);
    }
    return (0, action_verifier_1.fail)("I couldn't perform the drag.", ["drag sequence failed"], "drag-failed");
}
async function mouseClickVariant(variant, x, y) {
    const seq = variant === "double"
        ? "[M]::mouse_event(2,0,0,0,[UIntPtr]::Zero); [M]::mouse_event(4,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 40; [M]::mouse_event(2,0,0,0,[UIntPtr]::Zero); [M]::mouse_event(4,0,0,0,[UIntPtr]::Zero)"
        : "[M]::mouse_event(8,0,0,0,[UIntPtr]::Zero); [M]::mouse_event(16,0,0,0,[UIntPtr]::Zero)";
    const res = await (0, action_verifier_1.runCapture)(`powershell -NoProfile -Command "${MOUSE_ADD_TYPE}; [M]::SetCursorPos(${x},${y})|Out-Null; Start-Sleep -Milliseconds 80; ${seq}; '${variant === "double" ? "double-clicked" : "right-clicked"}'"`, 8000);
    if (res && (res.stdout.includes("double-clicked") || res.stdout.includes("right-clicked"))) {
        return (0, action_verifier_1.ok)(variant === "double"
            ? `Double-clicked at (${x}, ${y}).`
            : `Right-clicked at (${x}, ${y}).`, ["SetCursorPos + mouse_event executed"]);
    }
    return (0, action_verifier_1.fail)(`I couldn't perform the ${variant} click.`, ["mouse_event failed"], "click-variant-failed");
}
/** Move the cursor and VERIFY it actually arrived (±2px). */
async function mouseMove(x, y) {
    const res = await (0, action_verifier_1.runCapture)(`powershell -NoProfile -Command "${MOUSE_ADD_TYPE}; [M]::SetCursorPos(${x},${y})|Out-Null; Start-Sleep -Milliseconds 60; Add-Type -AssemblyName System.Windows.Forms; $p = [System.Windows.Forms.Cursor]::Position; Write-Output \"$($p.X),$($p.Y)\""`, 8000);
    const m = res?.stdout?.trim().match(/^(\d+)\s*,\s*(\d+)$/);
    if (m) {
        const gx = parseInt(m[1], 10);
        const gy = parseInt(m[2], 10);
        if (Math.abs(gx - x) <= 2 && Math.abs(gy - y) <= 2) {
            return (0, action_verifier_1.ok)(`Moved the mouse to (${x}, ${y}).`, [`cursor verified at ${gx},${gy}`]);
        }
        return (0, action_verifier_1.fail)(`I moved the mouse but it reported (${gx}, ${gy}) instead of (${x}, ${y}).`, ["position mismatch — the cursor may be clipped by the screen edge"], "move-mismatch");
    }
    return (0, action_verifier_1.fail)("I couldn't move the mouse.", ["SetCursorPos failed"], "move-failed");
}
// ─── Window control (minimize / maximize / restore / move / resize) ─────────
const WINDOW_ADD_TYPE = `Add-Type 'using System;using System.Runtime.InteropServices;public class W{[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int c);[DllImport("user32.dll")]public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int w,int hh,uint f);[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();}'`;
function findWindowCmd(target, then) {
    const selector = target
        ? `Get-Process | Where-Object { $_.MainWindowTitle -like ${psQuote("*" + target + "*")} } | Select-Object -First 1`
        // No target → the CURRENT FOREGROUND window (never "the last created",
        // which used to minimize an unrelated window). If Quip itself is in the
        // foreground, fall back to the most recently created non-Quip window.
        : `$fg = [W]::GetForegroundWindow(); $w = Get-Process | Where-Object { $_.MainWindowHandle -eq $fg -and $_.ProcessName -notlike '${processLLCName()}' } | Select-Object -First 1; if (-not $w) { $w = Get-Process | Where-Object { $_.MainWindowTitle -and $_.ProcessName -notlike '${processLLCName()}' } | Sort-Object MainWindowHandle | Select-Object -Last 1 }`;
    return `powershell -NoProfile -Command "${WINDOW_ADD_TYPE}; ${selector}; if ($w -and $w.MainWindowHandle -ne 0) { ${then} } else { 'not-found' }"`;
}
/** This process's own name (so "minimize" never minimizes Quip by accident). */
function processLLCName() {
    try {
        // electron's app name — lowercase, wildcard-wrapped by the caller
        const { app } = require("electron");
        return (app.getName() || "quip").toLowerCase();
    }
    catch {
        return "quip";
    }
}
async function windowControl(op, target) {
    // ShowWindow codes: 6 = minimize, 3 = maximize, 9 = restore
    const code = op === "minimize" ? 6 : op === "maximize" ? 3 : 9;
    const then = `[W]::ShowWindow($w.MainWindowHandle, ${code})|Out-Null; '${op}-done'`;
    const res = await (0, action_verifier_1.runCapture)(findWindowCmd(target, then), 8000);
    if (res && res.stdout.includes(`${op}-done`)) {
        return (0, action_verifier_1.ok)(`${op[0].toUpperCase() + op.slice(1)}d the window for "${target}".`, ["ShowWindow executed"]);
    }
    return (0, action_verifier_1.fail)(`I couldn't find a window matching "${target}" to ${op}.`, ["no window handle matched"], "window-control-not-found");
}
async function windowMove(target, x, y) {
    // SWP_NOSIZE(0x1) | SWP_NOZORDER(0x4) | SWP_NOACTIVATE(0x10) = 0x15
    const then = `[W]::SetWindowPos($w.MainWindowHandle, [IntPtr]::Zero, ${x}, ${y}, 0, 0, 0x15)|Out-Null; 'moved'`;
    const res = await (0, action_verifier_1.runCapture)(findWindowCmd(target, then), 8000);
    if (res && res.stdout.includes("moved")) {
        return (0, action_verifier_1.ok)(`Moved the "${target}" window to (${x}, ${y}).`, ["SetWindowPos executed"]);
    }
    return (0, action_verifier_1.fail)(`I couldn't find a window matching "${target}" to move.`, ["no window handle"], "window-move-not-found");
}
async function windowResize(target, width, height) {
    // SWP_NOMOVE(0x2) | SWP_NOZORDER(0x4) | SWP_NOACTIVATE(0x10) = 0x16
    const then = `[W]::SetWindowPos($w.MainWindowHandle, [IntPtr]::Zero, 0, 0, ${width}, ${height}, 0x16)|Out-Null; 'resized'`;
    const res = await (0, action_verifier_1.runCapture)(findWindowCmd(target, then), 8000);
    if (res && res.stdout.includes("resized")) {
        return (0, action_verifier_1.ok)(`Resized the "${target}" window to ${width}×${height}.`, ["SetWindowPos executed"]);
    }
    return (0, action_verifier_1.fail)(`I couldn't find a window matching "${target}" to resize.`, ["no window handle"], "window-resize-not-found");
}
// ─── Screen capture + window listing ─────────────────────────────────────────
async function screenCapture() {
    const { app } = await Promise.resolve().then(() => __importStar(require("electron")));
    const dir = node_path_1.default.join(app.getPath("userData"), "screens");
    try {
        node_fs_1.default.mkdirSync(dir, { recursive: true });
    }
    catch {
        /* fallthrough — save will fail and report honestly */
    }
    const file = node_path_1.default.join(dir, `quip-screen-${Date.now()}.png`);
    const psFile = file.replace(/\\/g, "\\\\");
    const res = await (0, action_verifier_1.runCapture)(`powershell -NoProfile -Command "Add-Type -AssemblyName System.Drawing; Add-Type -AssemblyName System.Windows.Forms; $b = [System.Windows.Forms.SystemInformation]::VirtualScreen; $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height; $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size); $bmp.Save('${psFile}'); $g.Dispose(); $bmp.Dispose(); 'saved'"`, 12000);
    if (res && res.stdout.includes("saved")) {
        try {
            const stat = node_fs_1.default.statSync(file);
            if (stat.size > 0) {
                return (0, action_verifier_1.ok)(`Captured the screen.`, [`saved: ${file}`, `size: ${stat.size} bytes`]);
            }
        }
        catch {
            /* stat failed — fall through to failure */
        }
    }
    return (0, action_verifier_1.fail)("I couldn't capture the screen.", ["CopyFromScreen failed or file missing"], "screen-capture-failed");
}
async function windowsList() {
    const titles = await (0, action_verifier_1.listWindowTitles)();
    if (titles.length === 0) {
        return (0, action_verifier_1.fail)("I couldn't list the open windows.", ["no visible windows found"], "windows-list-failed");
    }
    return (0, action_verifier_1.ok)(`There are ${titles.length} open windows:\n${titles.slice(0, 15).map((t) => `• ${t}`).join("\n")}`, [`${titles.length} visible windows`]);
}
// ─── Public API ──────────────────────────────────────────────────────────────
async function executeDesktopAction(action) {
    switch (action.type) {
        case "focus":
            return focusWindow(action.target);
        case "close":
            return closeWindow(action.target);
        case "type": {
            if (!action.text)
                return (0, action_verifier_1.fail)("Nothing to type.", [], "empty-text");
            const seq = escapeSendKeys(action.text);
            const res = await (0, action_verifier_1.runCapture)(`powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $ws.SendKeys(${psQuote(seq)}); 'typed'"`, 10000);
            if (res && res.stdout.includes("typed")) {
                return (0, action_verifier_1.ok)("Typed the text into the focused window.", ["SendKeys executed"]);
            }
            return (0, action_verifier_1.fail)("I couldn't type — make sure the target window is focused.", ["SendKeys failed"], "type-failed");
        }
        case "key": {
            const seq = buildKeySequence(action.keys);
            if (!seq) {
                return (0, action_verifier_1.fail)(`I don't know the key combination: ${action.keys.join("+")}.`, [], "unknown-key");
            }
            const res = await (0, action_verifier_1.runCapture)(`powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $ws.SendKeys(${psQuote(seq)}); 'sent'"`, 8000);
            if (res && res.stdout.includes("sent")) {
                return (0, action_verifier_1.ok)(`Pressed ${action.keys.join("+")}.`, ["SendKeys executed"]);
            }
            return (0, action_verifier_1.fail)("I couldn't send the key press.", ["SendKeys failed"], "key-failed");
        }
        case "click": {
            const point = await resolveClickPoint(action.x, action.y);
            if (!point) {
                return (0, action_verifier_1.fail)("I couldn't get the current cursor position for the click.", ["cursor probe failed"], "cursor-failed");
            }
            return mouseClick(Math.round(point.x), Math.round(point.y));
        }
        case "click.variant": {
            const vPoint = await resolveClickPoint(action.x, action.y);
            if (!vPoint) {
                return (0, action_verifier_1.fail)("I couldn't get the current cursor position for the click.", ["cursor probe failed"], "cursor-failed");
            }
            return mouseClickVariant(action.variant, Math.round(vPoint.x), Math.round(vPoint.y));
        }
        case "mouse.move":
            return mouseMove(Math.round(action.x), Math.round(action.y));
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
            const text = electron_1.clipboard.readText();
            return (0, action_verifier_1.ok)(text ? "Read the clipboard." : "The clipboard is empty.", [`clipboard length: ${text.length}`]);
        }
        case "clipboard.write": {
            electron_1.clipboard.writeText(action.text);
            const roundtrip = electron_1.clipboard.readText();
            return roundtrip === action.text
                ? (0, action_verifier_1.ok)("Copied to the clipboard.", ["round-trip verified"])
                : (0, action_verifier_1.fail)("I couldn't copy that to the clipboard.", ["round-trip mismatch"], "clipboard-write-failed");
        }
        default:
            return (0, action_verifier_1.fail)("Unknown desktop action.", [], "unknown-action");
    }
}
//# sourceMappingURL=desktop-controller.js.map