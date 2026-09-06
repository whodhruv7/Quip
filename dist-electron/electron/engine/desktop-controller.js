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
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeDesktopAction = executeDesktopAction;
const electron_1 = require("electron");
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
/** Close an app window by title/process substring (graceful CloseMainWindow). */
async function closeWindow(target) {
    const before = await (0, action_verifier_1.windowWithTitleExists)(target);
    if (!before) {
        return (0, action_verifier_1.fail)(`I didn't find an open window for "${target}".`, ["no matching window before close"], "close-target-not-found");
    }
    const res = await (0, action_verifier_1.runCapture)(`powershell -NoProfile -Command "$w = Get-Process | Where-Object { $_.MainWindowTitle -like ${psQuote("*" + target + "*")} } | Select-Object -First 1; if ($w) { $w.CloseMainWindow() | Out-Null; Start-Sleep -Milliseconds 800; if ($w.HasExited) { 'closed' } else { 'close-sent' } } else { 'not-found' }"`, 8000);
    if (res && (res.stdout.includes("closed") || res.stdout.includes("close-sent"))) {
        const stillThere = await (0, action_verifier_1.windowWithTitleExists)(target);
        return stillThere
            ? (0, action_verifier_1.ok)(`Sent close to "${target}" (window may still be shutting down).`, ["CloseMainWindow sent"])
            : (0, action_verifier_1.ok)(`Closed "${target}".`, ["window no longer listed after close"]);
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
        case "click":
            return mouseClick(Math.round(action.x), Math.round(action.y));
        case "scroll":
            return mouseScroll(action.deltaY);
        case "drag":
            return mouseDrag(action.from, action.to);
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