"use strict";
// Quip Execution Engine — Action Verifier
// ─────────────────────────────────────────────────────────────────────────────
// Ported philosophy from Agent-Reach: never trust "the command didn't throw".
// Success = observed system state (process exists, window title matches,
// URL loaded). Every executor returns an ActionVerification with evidence.
// ─────────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.ok = ok;
exports.fail = fail;
exports.runCapture = runCapture;
exports.runFire = runFire;
exports.pollUntil = pollUntil;
exports.processExists = processExists;
exports.listWindowTitles = listWindowTitles;
exports.windowWithTitleExists = windowWithTitleExists;
exports.getForegroundWindowTitle = getForegroundWindowTitle;
exports.verifyLaunched = verifyLaunched;
const node_child_process_1 = require("node:child_process");
function ok(summary, evidence = []) {
    return { ok: true, summary, evidence };
}
function fail(summary, evidence = [], error) {
    return { ok: false, summary, evidence, error };
}
/** Run a command, capture stdout. Never throws — returns null on failure. */
function runCapture(cmd, timeoutMs = 8000) {
    return new Promise((resolve) => {
        let settled = false;
        const child = (0, node_child_process_1.exec)(cmd, { windowsHide: true, timeout: timeoutMs }, (err, stdout, stderr) => {
            if (settled)
                return;
            settled = true;
            resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout: stdout ?? "", stderr: stderr ?? "" });
        });
        child.on("error", () => {
            if (!settled) {
                settled = true;
                resolve(null);
            }
        });
    });
}
/** Fire-and-forget command execution (fire=true for launchers). */
function runFire(cmd, timeoutMs = 8000) {
    return new Promise((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                resolve({ launched: true }); // command still running = likely launched a GUI app
            }
        }, timeoutMs);
        try {
            (0, node_child_process_1.exec)(cmd, { windowsHide: true }, (err) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                if (err)
                    resolve({ launched: false, err: String(err.message ?? err) });
                else
                    resolve({ launched: true });
            });
        }
        catch (e) {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                resolve({ launched: false, err: String(e?.message ?? e) });
            }
        }
    });
}
/** Poll until predicate passes or timeout. */
async function pollUntil(fn, timeoutMs, intervalMs = 600) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await fn())
            return true;
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    return await fn();
}
/** Does a process with this name exist? (name without .exe) */
async function processExists(procName) {
    const safe = procName.replace(/[^a-zA-Z0-9._-]/g, "");
    if (!safe)
        return false;
    const res = await runCapture(`powershell -NoProfile -Command "(Get-Process -Name '${safe}' -ErrorAction SilentlyContinue | Measure-Object).Count"`, 8000);
    if (!res)
        return false;
    const count = parseInt(res.stdout.trim(), 10);
    return Number.isFinite(count) && count > 0;
}
/** Get titles of top-level visible windows (one per line). */
async function listWindowTitles() {
    const res = await runCapture(`powershell -NoProfile -Command "Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object -ExpandProperty MainWindowTitle"`, 8000);
    if (!res || res.code !== 0)
        return [];
    return res.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}
/** Does any visible window title contain the substring (case-insensitive)? */
async function windowWithTitleExists(titleSubstring) {
    const needle = titleSubstring.toLowerCase().trim();
    if (!needle)
        return false;
    const titles = await listWindowTitles();
    return titles.some((t) => t.toLowerCase().includes(needle));
}
/** Title of the current foreground window (best effort, Windows). */
async function getForegroundWindowTitle() {
    const res = await runCapture(`powershell -NoProfile -Command "Add-Type 'using System;using System.Runtime.InteropServices;public class FG{[DllImport(\\"user32.dll\\")]public static extern IntPtr GetForegroundWindow();[DllImport(\\"user32.dll\\")]public static extern int GetWindowText(IntPtr h,System.Text.StringBuilder t,int c);}';$b=New-Object System.Text.StringBuilder 512;[FG]::GetWindowText([FG]::GetForegroundWindow(),$b,512)|Out-Null;$b.ToString()"`, 8000);
    const title = res?.stdout?.trim();
    return title ? title : null;
}
/** Wait until a process or window title appears — proves a launch worked. */
async function verifyLaunched(opts) {
    const { procNames, titleHints, timeoutMs = 8000 } = opts;
    const started = await pollUntil(async () => {
        for (const p of procNames) {
            if (p && (await processExists(p)))
                return true;
        }
        for (const t of titleHints) {
            if (t && (await windowWithTitleExists(t)))
                return true;
        }
        return false;
    }, timeoutMs);
    if (started) {
        const evidence = [];
        for (const p of procNames) {
            if (p && (await processExists(p)))
                evidence.push(`process '${p}' is running`);
        }
        for (const t of titleHints) {
            if (t && (await windowWithTitleExists(t)))
                evidence.push(`window title matched '${t}'`);
        }
        return ok("Launched and verified on the system.", evidence);
    }
    return fail("The app did not appear after launch.", ["no matching process", "no matching window title"], "launch-not-verified");
}
//# sourceMappingURL=action-verifier.js.map