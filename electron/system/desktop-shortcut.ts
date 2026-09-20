// Quip — real Windows desktop shortcut ("one button on my home screen").
// ─────────────────────────────────────────────────────────────────────────────
// The user wants a REAL shortcut on the Windows desktop — same place as every
// other app's icon — that launches Quip with NO terminal window, ever.
//
// How it works, for real:
//   • launch-quip.vbs (checked into the repo root) runs run-quip.cmd with the
//     console hidden (WScript.Shell.Run window style 0).
//   • We create Quip.lnk on the ACTUAL user desktop via the WScript.Shell COM
//     object (the same thing Windows' "Create shortcut" uses).
//   • Icon: build/quip.ico (multi-size, generated from the mascot artwork).
//
// Everything is HONEST (§42): the desktop path is resolved the way Windows
// resolves it (including OneDrive-redirected desktops), every failure comes
// back with a plain-language reason, and "created" is only true when the .lnk
// file actually exists on disk afterwards.
// ─────────────────────────────────────────────────────────────────────────────

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface ShortcutResult {
  ok: boolean;
  /** True only when a NEW .lnk was written by this call. */
  created: boolean;
  /** True when the .lnk exists after the call (new or already there). */
  present: boolean;
  /** Absolute path of the shortcut when present. */
  shortcutPath?: string;
  message: string;
}

function ps(script: string, timeoutMs = 20_000): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    // -NoProfile: skip user profile scripts (fast + no side effects).
    // -ExecutionPolicy Bypass: script comes from our own process, not disk.
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          out: String(stdout ?? "").trim(),
          err: String((error as any)?.message ?? stderr ?? "").split("\n")[0] ?? "",
        });
      }
    );
  });
}

/** Resolve the REAL desktop folder the way Windows does (handles OneDrive
 *  redirection). Falls back to %USERPROFILE%\Desktop when PowerShell can't. */
export async function getDesktopDir(userProfile?: string): Promise<string> {
  const r = await ps("(New-Object -ComObject Shell.NameSpace(0x00)).Self.Path; if (-not $_) { [Environment]::GetFolderPath('Desktop') }", 8_000)
    .catch(() => ({ ok: false, out: "", err: "powershell unavailable" }));
  const out = r.out.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? "";
  if (r.ok && out && /[a-zA-Z]:\\/.test(out)) return out;
  if (userProfile) return path.join(userProfile, "Desktop");
  return "";
}

/** Pure: the PowerShell that writes Quip.lnk via WScript.Shell (what Windows
 *  itself uses). Exported for tests — the real call runs on the laptop. */
export function buildShortcutPs(repoRoot: string, desktopDir: string): string {
  const vbs = path.join(repoRoot, "launch-quip.vbs").replace(/'/g, "''");
  const ico = path.join(repoRoot, "build", "quip.ico").replace(/'/g, "''");
  const lnk = path.join(desktopDir, "Quip.lnk").replace(/'/g, "''");
  const work = repoRoot.replace(/'/g, "''");
  return [
    "$ws = New-Object -ComObject WScript.Shell",
    `$sc = $ws.CreateShortcut('${lnk}')`,
    "$sc.TargetPath = 'C:\\Windows\\System32\\wscript.exe'",
    `$sc.Arguments = '"${vbs}"'`,
    `$sc.IconLocation = '${ico},0'`,
    `$sc.WorkingDirectory = '${work}'`,
    "$sc.Description = 'Quip — your desktop companion'",
    // WindowStyle 1 = normal (7 = minimized — pointless for a hidden console
    // launcher, and it made some shells flash the taskbar).
    "$sc.WindowStyle = 1",
    "$sc.Save()",
  ].join("; ");
}

/** Ensure Quip.lnk exists on the real desktop. Never throws — every outcome
 *  comes back as an honest ShortcutResult. */
export async function ensureQuipShortcut(repoRoot: string, opts: { force?: boolean } = {}): Promise<ShortcutResult> {
  // Sanity: the launcher must exist — otherwise the shortcut would 404.
  const vbsPath = path.join(repoRoot, "launch-quip.vbs");
  if (!fs.existsSync(vbsPath)) {
    return {
      ok: false,
      created: false,
      present: false,
      message: "The launcher file (launch-quip.vbs) is missing from the Quip folder — re-download the project, then try again.",
    };
  }

  const desktopDir = await getDesktopDir(process.env.USERPROFILE);
  if (!desktopDir) {
    return {
      ok: false,
      created: false,
      present: false,
      message: "I couldn't find your Desktop folder (it may be redirected) — tell me where, or run Quip from the project folder.",
    };
  }
  const lnkPath = path.join(desktopDir, "Quip.lnk");

  if (!opts.force && fs.existsSync(lnkPath)) {
    return {
      ok: true,
      created: false,
      present: true,
      shortcutPath: lnkPath,
      message: "The Quip shortcut is already on your desktop — double-click it any time.",
    };
  }

  const create = await ps(buildShortcutPs(repoRoot, desktopDir));
  if (!create.ok || !fs.existsSync(lnkPath)) {
    return {
      ok: false,
      created: false,
      present: fs.existsSync(lnkPath),
      shortcutPath: fs.existsSync(lnkPath) ? lnkPath : undefined,
      message: `Windows refused to create the shortcut — ${create.err.slice(0, 140) || "the shell script failed"}.`,
    };
  }
  return {
    ok: true,
    created: true,
    present: true,
    shortcutPath: lnkPath,
    message: "Done — the Quip icon is on your desktop now. Double-click it and I appear. No terminal, ever.",
  };
}
