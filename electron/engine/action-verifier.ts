// Quip Execution Engine — Action Verifier
// ─────────────────────────────────────────────────────────────────────────────
// Ported philosophy from Agent-Reach: never trust "the command didn't throw".
// Success = observed system state (process exists, window title matches,
// URL loaded). Every executor returns an ActionVerification with evidence.
// ─────────────────────────────────────────────────────────────────────────────

import { exec } from "node:child_process";

export interface ActionVerification {
  ok: boolean;
  summary: string;
  evidence: string[];
  error?: string;
}

export function ok(summary: string, evidence: string[] = []): ActionVerification {
  return { ok: true, summary, evidence };
}

export function fail(summary: string, evidence: string[] = [], error?: string): ActionVerification {
  return { ok: false, summary, evidence, error };
}

/** Run a command, capture stdout. Never throws — returns null on failure. */
export function runCapture(
  cmd: string,
  timeoutMs = 8000
): Promise<{ code: number; stdout: string; stderr: string } | null> {
  return new Promise((resolve) => {
    let settled = false;
    const child = exec(cmd, { windowsHide: true, timeout: timeoutMs }, (err, stdout, stderr) => {
      if (settled) return;
      settled = true;
      resolve({ code: err ? (typeof (err as any).code === "number" ? (err as any).code : 1) : 0, stdout: stdout ?? "", stderr: stderr ?? "" });
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
export function runFire(cmd: string, timeoutMs = 8000): Promise<{ launched: boolean; err?: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({ launched: true }); // command still running = likely launched a GUI app
      }
    }, timeoutMs);
    try {
      exec(cmd, { windowsHide: true }, (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) resolve({ launched: false, err: String(err.message ?? err) });
        else resolve({ launched: true });
      });
    } catch (e: any) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ launched: false, err: String(e?.message ?? e) });
      }
    }
  });
}

/** Poll until predicate passes or timeout. */
export async function pollUntil(
  fn: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 600
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return await fn();
}

/** Does a process with this name exist? (name without .exe) */
export async function processExists(procName: string): Promise<boolean> {
  const safe = procName.replace(/[^a-zA-Z0-9._-]/g, "");
  if (!safe) return false;
  const res = await runCapture(
    `powershell -NoProfile -Command "(Get-Process -Name '${safe}' -ErrorAction SilentlyContinue | Measure-Object).Count"`,
    8000
  );
  if (!res) return false;
  const count = parseInt(res.stdout.trim(), 10);
  return Number.isFinite(count) && count > 0;
}

/** Get titles of top-level visible windows (one per line). */
export async function listWindowTitles(): Promise<string[]> {
  const res = await runCapture(
    `powershell -NoProfile -Command "Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object -ExpandProperty MainWindowTitle"`,
    8000
  );
  if (!res || res.code !== 0) return [];
  return res.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

/** Does any visible window title contain the substring (case-insensitive)? */
export async function windowWithTitleExists(titleSubstring: string): Promise<boolean> {
  const needle = titleSubstring.toLowerCase().trim();
  if (!needle) return false;
  const titles = await listWindowTitles();
  return titles.some((t) => t.toLowerCase().includes(needle));
}

/** Title of the current foreground window (best effort, Windows). */
export async function getForegroundWindowTitle(): Promise<string | null> {
  const res = await runCapture(
    `powershell -NoProfile -Command "Add-Type 'using System;using System.Runtime.InteropServices;public class FG{[DllImport(\\"user32.dll\\")]public static extern IntPtr GetForegroundWindow();[DllImport(\\"user32.dll\\")]public static extern int GetWindowText(IntPtr h,System.Text.StringBuilder t,int c);}';$b=New-Object System.Text.StringBuilder 512;[FG]::GetWindowText([FG]::GetForegroundWindow(),$b,512)|Out-Null;$b.ToString()"`,
    8000
  );
  const title = res?.stdout?.trim();
  return title ? title : null;
}

/** Wait until a process or window title appears — proves a launch worked. */
export async function verifyLaunched(opts: {
  procNames: string[];
  titleHints: string[];
  timeoutMs?: number;
}): Promise<ActionVerification> {
  const { procNames, titleHints, timeoutMs = 8000 } = opts;
  const started = await pollUntil(async () => {
    for (const p of procNames) {
      if (p && (await processExists(p))) return true;
    }
    for (const t of titleHints) {
      if (t && (await windowWithTitleExists(t))) return true;
    }
    return false;
  }, timeoutMs);

  if (started) {
    const evidence: string[] = [];
    for (const p of procNames) {
      if (p && (await processExists(p))) evidence.push(`process '${p}' is running`);
    }
    for (const t of titleHints) {
      if (t && (await windowWithTitleExists(t))) evidence.push(`window title matched '${t}'`);
    }
    return ok("Launched and verified on the system.", evidence);
  }
  return fail(
    "The app did not appear after launch.",
    ["no matching process", "no matching window title"],
    "launch-not-verified"
  );
}
