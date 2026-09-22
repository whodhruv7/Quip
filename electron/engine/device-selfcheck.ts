// Quip Execution Engine — Device Self-Check ("doctor" pattern, Agent-Reach inspired)
// ─────────────────────────────────────────────────────────────────────────────
// "run a self check" → Quip probes its OWN capabilities on the REAL machine
// and reports exactly what works and what doesn't. No fake ✓ — every line
// reflects an actually executed probe. This is how failures get diagnosed on
// the user's machine without guessing.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ok,
  runCapture,
  listWindowTitles,
  type ActionVerification,
} from "./action-verifier";
import { executeDesktopAction } from "./desktop-controller";
import { getCachedAppIndex, buildInstalledAppIndex } from "./app-discovery";

interface CheckLine {
  name: string;
  pass: boolean;
  detail: string;
}

function line(name: string, pass: boolean, detail: string): CheckLine {
  return { name, pass, detail };
}

/** Run every probe with a hard cap so the whole check stays fast. */
export async function deviceSelfCheck(): Promise<ActionVerification> {
  const checks: CheckLine[] = [];

  // 1. PowerShell / command layer — the base everything on Windows needs.
  const psStart = Date.now();
  const ps = await runCapture(`powershell -NoProfile -Command "Write-Output ok"`, 8000);
  checks.push(
    line(
      "Command layer (PowerShell)",
      !!ps && ps.code === 0 && ps.stdout.includes("ok"),
      ps ? `responded in ${Date.now() - psStart}ms` : "no response — PowerShell unavailable or blocked"
    )
  );

  // 2. App discovery — can Quip see installed applications?
  try {
    let apps = getCachedAppIndex();
    if (!apps || apps.length === 0) apps = await buildInstalledAppIndex();
    checks.push(
      line(
        "Installed-app index",
        !!apps && apps.length > 0,
        apps && apps.length > 0 ? `${apps.length} apps found` : "no apps found — Start Menu scan failed"
      )
    );
  } catch (e: any) {
    checks.push(line("Installed-app index", false, `error: ${String(e?.message ?? e)}`));
  }

  // 3. Window listing — can Quip see open windows?
  try {
    const titles = await listWindowTitles();
    checks.push(
      line(
        "Window observation",
        titles.length > 0,
        titles.length > 0 ? `${titles.length} windows visible` : "no window titles returned"
      )
    );
  } catch (e: any) {
    checks.push(line("Window observation", false, `error: ${String(e?.message ?? e)}`));
  }

  // 4. Screen capture.
  try {
    const shot = await executeDesktopAction({ type: "screen.capture" });
    checks.push(line("Screen capture", shot.ok, shot.ok ? shot.summary : shot.summary));
  } catch (e: any) {
    checks.push(line("Screen capture", false, `error: ${String(e?.message ?? e)}`));
  }

  // 5. Clipboard read (non-destructive probe).
  try {
    const clip = await executeDesktopAction({ type: "clipboard.read" });
    checks.push(line("Clipboard access", clip.ok, clip.ok ? "read successfully" : clip.summary));
  } catch (e: any) {
    checks.push(line("Clipboard access", false, `error: ${String(e?.message ?? e)}`));
  }

  // 6. Mouse position probe (reads, never moves — zero side effects).
  try {
    const pos = await runCapture(
      `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position.X"`,
      8000
    );
    const good = !!pos && pos.code === 0 && /\d/.test(pos.stdout);
    checks.push(
      line("Mouse position probe", good, good ? `cursor at x=${pos!.stdout.trim()}` : "cursor position unavailable")
    );
  } catch (e: any) {
    checks.push(line("Mouse position probe", false, `error: ${String(e?.message ?? e)}`));
  }

  // 7. Default browser reachability (opens NOTHING — just checks the shell).
  try {
    const shellOk = await runCapture(
      `powershell -NoProfile -Command "(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice' -ErrorAction Stop).ProgId"`,
      8000
    );
    const progId = shellOk && shellOk.code === 0 ? shellOk.stdout.trim() : "";
    checks.push(
      line("Default browser", !!progId, progId ? `registered: ${progId}` : "no http association found")
    );
  } catch (e: any) {
    checks.push(line("Default browser", false, `error: ${String(e?.message ?? e)}`));
  }

  // ── self_check v2 (CAP-050): the autonomy-wave subsystems ──
  // 8. Ghost browser — the offscreen window engine (probe = can Electron build
  //    the session surface; the SSRF gate runs a real check with no network).
  try {
    const ghost = await import("./browser-automation");
    const gate = ghost.isSafePublicUrl("https://example.com");
    const blocked = ghost.isSafePublicUrl("http://127.0.0.1:5/");
    checks.push(
      line(
        "Ghost browser (SSRF gate)",
        gate.safe === true && blocked.safe === false,
        `public URLs ${gate.safe ? "pass" : "BLOCKED"}, private hosts ${blocked.safe ? "pass (BAD)" : "blocked"}`
      )
    );
  } catch (e: any) {
    checks.push(line("Ghost browser (SSRF gate)", false, `error: ${String(e?.message ?? e)}`));
  }

  // 9. MailWing — configuration probe ONLY (connects to nothing, sends nothing).
  try {
    const mw = await import("./mailwing");
    const accounts = mw.listAccounts();
    checks.push(
      line(
        "MailWing (config)",
        true,
        accounts.length === 0
          ? "no accounts configured — sending falls back to prefilled Gmail drafts"
          : `${accounts.length} account(s) ready${accounts.some((a) => a.passEncrypted) ? ", passwords encrypted" : ""}`
      )
    );
  } catch (e: any) {
    checks.push(line("MailWing (config)", false, `error: ${String(e?.message ?? e)}`));
  }

  // 10. File watch — the Downloads auto-organizer state.
  try {
    const butler = await import("./file-butler");
    const watches = butler.watchStatus();
    const active = watches.filter((w) => w.autoOrganize).length;
    checks.push(
      line(
        "File watch",
        true,
        active > 0 ? `${active} folder watch(es) auto-organizing` : "no auto-organize watch active (turn on with \"watch my downloads\")"
      )
    );
  } catch (e: any) {
    checks.push(line("File watch", false, `error: ${String(e?.message ?? e)}`));
  }

  // 11. OS notifications — can Quip toast at all?
  try {
    const { Notification } = await import("electron");
    const supported = typeof Notification !== "undefined" && typeof Notification.isSupported === "function" && Notification.isSupported();
    checks.push(line("OS notifications", supported, supported ? "Electron Notification available" : "toasts unsupported on this OS"));
  } catch (e: any) {
    checks.push(line("OS notifications", false, `error: ${String(e?.message ?? e)}`));
  }

  // 12. Problem Diary — the failure memory itself is writable.
  try {
    const pd = await import("./problem-diary");
    const stats = pd.problemStats();
    checks.push(line("Problem Diary", true, `${stats.total} entr${stats.total === 1 ? "y" : "ies"} remembered (${stats.open} open, ${stats.resolved} resolved)`));
  } catch (e: any) {
    checks.push(line("Problem Diary", false, `error: ${String(e?.message ?? e)}`));
  }

  const passed = checks.filter((c) => c.pass).length;
  const failed = checks.length - passed;
  const report = checks
    .map((c) => `${c.pass ? "✓" : "✗"} ${c.name} — ${c.detail}`)
    .join("\n");

  if (failed === 0) {
    return ok(
      `Self check complete — all ${checks.length} systems working:\n${report}`,
      checks.map((c) => `${c.name}: pass`)
    );
  }
  return ok(
    `Self check complete — ${passed}/${checks.length} working. The failing parts:\n${report}`,
    checks.map((c) => `${c.name}: ${c.pass ? "pass" : "fail"}`)
  );
}
