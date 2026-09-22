// Quip GhostHands — Deep System Control (roadmap E)
// ─────────────────────────────────────────────────────────────────────────────
// The hands beyond keyboard/mouse: screenshot-to-file, wallpaper, brightness,
// OS notifications, PC lock, clipboard history ring, snap presets and winget
// install proposals. Windows PowerShell builders are PURE string functions —
// unit-tested without a shell; execution degrades honestly off-Windows.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { Notification, desktopCapturer, screen as electronScreen, shell } from "electron";
import { ok, fail, runCapture, type ActionVerification } from "./action-verifier";

// ─── Pure PowerShell builders (unit-tested) ─────────────────────────────────

export function buildWallpaperPs(imagePath: string): string {
  const quoted = psq(imagePath);
  return [
    `Add-Type 'using System;using System.Runtime.InteropServices;public class WP{[DllImport("user32.dll", CharSet=CharSet.Auto)]public static extern int SystemParametersInfo(int uAction,int uParam,string lpvParam,int fuWinIni);}'`,
    `[WP]::SystemParametersInfo(20, 0, ${quoted}, 3) | Out-Null`,
    `'wallpaper-set'`,
  ].join("; ");
}

export function buildBrightnessPs(level: number): string {
  const v = Math.max(1, Math.min(100, Math.round(level)));
  return [
    `$b = Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop`,
    `$b.WmiSetBrightness(1, ${v}) | Out-Null`,
    `'brightness-set'`,
  ].join("; ");
}

export function buildGetBrightnessPs(): string {
  return `Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightness | Select-Object -ExpandProperty CurrentBrightness`;
}

export function buildLockPs(): string {
  return `Add-Type 'using System;using System.Runtime.InteropServices;public class LK{[DllImport("user32.dll")]public static extern void LockWorkStation();}'; [LK]::LockWorkStation(); 'locked'`;
}

export function buildBatteryPs(): string {
  return [
    `$b = Get-CimInstance Win32_Battery | Select-Object -First 1`,
    `if ($b) { ('battery:' + [int]$b.EstimatedChargeRemaining + '%,' + $b.BatteryStatus) } else { 'battery:none' }`,
  ].join("; ");
}

function psq(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** Windows veriy honestly reports as unsupported — never a fake success. */
function unsupported(): ActionVerification {
  return fail(
    "That one is Windows-only on your setup right now — I'm not going to pretend it worked.",
    ["platform does not support this control"],
    "unsupported-platform"
  );
}

// ─── Screenshot → file ───────────────────────────────────────────────────────

export interface ScreenshotResult {
  ok: boolean;
  path?: string;
  bytes?: number;
  error?: string;
}

export async function screenshotToFile(targetDir?: string): Promise<ScreenshotResult> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: electronScreen.getPrimaryDisplay().size,
    });
    const source = sources[0];
    if (!source) return { ok: false, error: "no screen was capturable" };
    const base = targetDir || (process.platform === "win32"
      ? path.join(process.env.USERPROFILE ?? "C:", "Pictures")
      : path.join(process.env.HOME ?? "/tmp", "Pictures"));
    fs.mkdirSync(base, { recursive: true });
    const file = path.join(base, `Quip-Screenshot-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.png`);
    fs.writeFileSync(file, source.thumbnail.toPNG());
    const bytes = fs.statSync(file).size;
    if (bytes < 1000) {
      try { fs.unlinkSync(file); } catch { /* already gone */ }
      return { ok: false, error: "the capture came out empty — screen recording may be blocked" };
    }
    try {
      shell.showItemInFolder(file);
    } catch {
      /* reveal is cosmetic — the file is real */
    }
    return { ok: true, path: file, bytes };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 160) };
  }
}

// ─── Wallpaper ───────────────────────────────────────────────────────────────

export async function setWallpaper(source: string): Promise<ActionVerification> {
  if (process.platform !== "win32") return unsupported();
  let imagePath = source;
  // URL source: download to a temp file first (SSRF-gated).
  if (/^https?:\/\//i.test(source)) {
    const { isSafePublicUrl } = await import("./browser-automation");
    const gate = isSafePublicUrl(source);
    if (!gate.safe) return fail(`I won't fetch that URL — ${gate.reason}.`, [], "unsafe-url");
    try {
      const res = await fetch(gate.url!, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) return fail(`The image download failed (HTTP ${res.status}).`, [], "wallpaper-download-failed");
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 10_000) return fail("That download is suspiciously small for an image.", [], "wallpaper-too-small");
      imagePath = path.join(process.env.TEMP ?? process.env.HOME ?? ".", `quip-wallpaper-${Date.now()}`);
      fs.writeFileSync(imagePath, buf);
    } catch (e: any) {
      return fail(`I couldn't download the image — ${String(e?.message ?? e).slice(0, 120)}`, [], "wallpaper-download-failed");
    }
  }
  if (!fs.existsSync(imagePath)) {
    return fail(`I couldn't find an image at "${source}".`, [], "wallpaper-file-missing");
  }
  const res = await runCapture(`powershell -NoProfile -Command "${buildWallpaperPs(imagePath)}"`, 8000);
  if (res && res.stdout.includes("wallpaper-set")) {
    return ok(`Wallpaper set.`, [`image: ${path.basename(imagePath)}`]);
  }
  return fail("Windows refused the wallpaper change.", [res?.stderr?.slice(0, 120) ?? "no output"], "wallpaper-failed");
}

// ─── Brightness ──────────────────────────────────────────────────────────────

export async function setBrightness(level: number): Promise<ActionVerification> {
  if (process.platform !== "win32") return unsupported();
  const res = await runCapture(`powershell -NoProfile -Command "${buildBrightnessPs(level)}"`, 8000);
  if (res && res.stdout.includes("brightness-set")) {
    return ok(`Brightness set to ${Math.round(level)}%.`, ["WmiSetBrightness accepted"]);
  }
  return fail(
    "This laptop didn't accept a brightness change (desktop PC or blocked WMI?).",
    [res?.stderr?.slice(0, 120) ?? "WMI refused"],
    "brightness-unsupported"
  );
}

export async function getBrightness(): Promise<ActionVerification> {
  if (process.platform !== "win32") return unsupported();
  const res = await runCapture(`powershell -NoProfile -Command "${buildGetBrightnessPs()}"`, 8000);
  const level = parseInt((res?.stdout ?? "").trim(), 10);
  if (Number.isFinite(level)) {
    return ok(`Screen brightness is ${level}%.`, ["WmiMonitorBrightness"]);
  }
  return fail("I couldn't read the brightness (desktop PC or blocked WMI?).", [], "brightness-unsupported");
}

// ─── Lock PC (DESTRUCTIVE — executor confirms first) ─────────────────────────

export async function lockPc(): Promise<ActionVerification> {
  if (process.platform !== "win32") return unsupported();
  const res = await runCapture(`powershell -NoProfile -Command "${buildLockPs()}"`, 6000);
  if (res && res.stdout.includes("locked")) {
    return ok("Locked the PC. See you soon.", ["LockWorkStation accepted"]);
  }
  return fail("I couldn't lock the PC — Windows refused.", [], "lock-failed");
}

// ─── Battery (first-class, honest) ───────────────────────────────────────────

export async function batteryStatus(): Promise<ActionVerification> {
  if (process.platform !== "win32") {
    // Non-Windows: report what Node itself knows.
    return fail("Battery status is wired for Windows laptops right now.", ["platform: " + process.platform], "battery-unsupported");
  }
  const res = await runCapture(`powershell -NoProfile -Command "${buildBatteryPs()}"`, 8000);
  const m = (res?.stdout ?? "").match(/battery:(\d+)%,(\d+)/);
  if (m) {
    const pct = parseInt(m[1], 10);
    const status = parseInt(m[2], 10);
    const charging = status === 2;
    return ok(
      charging ? `Charging — battery at ${pct}%.` : `Battery at ${pct}%.`,
      [`Win32_Battery: ${pct}%, status ${status}`]
    );
  }
  if ((res?.stdout ?? "").includes("battery:none")) {
    return ok("No battery detected — this is a desktop / always-plugged machine.", ["Win32_Battery absent"]);
  }
  return fail("I couldn't read the battery status.", [], "battery-unknown");
}

// ─── Notifications (real OS toast) ───────────────────────────────────────────

export function notify(title: string, body: string): ActionVerification {
  try {
    if (!Notification.isSupported()) {
      return fail("This system doesn't support notifications.", [], "notify-unsupported");
    }
    const n = new Notification({ title: title.slice(0, 80) || "Quip", body: body.slice(0, 240), silent: false });
    n.show();
    return ok(`Notified: ${title.slice(0, 60)}`, ["Electron Notification shown"]);
  } catch (e: any) {
    return fail(`Notification failed — ${String(e?.message ?? e).slice(0, 120)}`, [], "notify-failed");
  }
}

// ─── Clipboard history ring (session-scoped, honest about scope) ─────────────

export interface ClipEntry {
  ts: number;
  text: string;
  origin: "write" | "read";
}

const RING_CAP = 25; // CAP-081
const ring: ClipEntry[] = [];

export function pushClipboard(text: string, origin: ClipEntry["origin"]): void {
  if (!text) return;
  ring.unshift({ ts: Date.now(), text: text.slice(0, 4000), origin });
  if (ring.length > RING_CAP) ring.length = RING_CAP;
}

export function clipboardHistory(): ClipEntry[] {
  return [...ring];
}

// ─── Window snap presets ─────────────────────────────────────────────────────

export type SnapPreset = "left" | "right" | "maximize" | "restore";

export function snapRect(preset: SnapPreset, workArea: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number } {
  switch (preset) {
    case "left":
      return { x: workArea.x, y: workArea.y, width: Math.floor(workArea.width / 2), height: workArea.height };
    case "right":
      return { x: workArea.x + Math.floor(workArea.width / 2), y: workArea.y, width: Math.floor(workArea.width / 2), height: workArea.height };
    case "maximize":
    case "restore":
      return workArea;
  }
}

// ─── Winget install proposal (approval-gated run happens via run_command) ────

export interface InstallProposal {
  ok: boolean;
  command?: string;
  note: string;
}

const KNOWN_IDS: [RegExp, string][] = [
  [/notepad\s*\+?\+/i, "Notepad++.Notepad++"],
  [/vs ?code|visual studio code/i, "Microsoft.VisualStudioCode"],
  [/chrome/i, "Google.Chrome"],
  [/firefox/i, "Mozilla.Firefox"],
  [/edge/i, "Microsoft.Edge"],
  [/whatsapp/i, "WhatsApp.WhatsApp"],
  [/telegram/i, "Telegram.TelegramDesktop"],
  [/spotify/i, "Spotify.Spotify"],
  [/discord/i, "Discord.Discord"],
  [/zoom/i, "Zoom.Zoom"],
  [/vlc/i, "VideoLAN.VLC"],
  [/7-?zip/i, "7zip.7zip"],
  [/git\b/i, "Git.Git"],
  [/node\.?js|nodejs/i, "OpenJS.NodeJS.LTS"],
  [/python/i, "Python.Python.3.12"],
  [/obs/i, "OBSProject.OBSStudio"],
  [/steam/i, "Valve.Steam"],
  [/postman/i, "Postman.Postman"],
  [/power ?toys/i, "Microsoft.PowerToys"],
  [/everything search|voidtools/i, "voidtools.Everything"],
];

/** Propose the exact winget command — execution is approval-gated elsewhere. */
export function proposeInstall(appQuery: string): InstallProposal {
  const q = (appQuery ?? "").trim();
  if (!q) return { ok: false, note: "no app name given" };
  for (const [re, id] of KNOWN_IDS) {
    if (re.test(q)) {
      return { ok: true, command: `winget install --id ${id} -e --accept-source-agreements`, note: `matched ${id} from the known-apps table` };
    }
  }
  const slug = q.replace(/\s+/g, "-");
  return {
    ok: true,
    command: `winget install --name "${q.replace(/"/g, "")}" -e --accept-source-agreements`,
    note: `exact-name install for "${q}" (id "${slug}" not in the known table — winget will confirm)`,
  };
}
