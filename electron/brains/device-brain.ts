// Quip V2 — DEVICE BRAIN
// -----------------------------------------------------------------------------
// Discovers everything about the device Quip is running on: OS, hardware,
// displays, installed apps, default handlers, locale, taskbar geometry.
//
// NO assumptions. NO hardcoding. The profile this produces drives every
// other brain — capability registry, world model, spatial brain, task brain.
//
// Design goals:
//   - Fast: target 1-3s total. Heavy probes (registry, whereis) run in
//     parallel and time out quickly.
//   - Portable: per-platform probes live behind a single scan() entry.
//   - Resilient: any single probe failing must never break the whole scan.
//   - Cacheable: profile is persisted to device-profile.json and re-scanned
//     only on demand or when stale.
// -----------------------------------------------------------------------------

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { screen } from "electron";
import type {
  DeviceProfile,
  Platform,
  DisplayInfo,
  InstalledApp,
  AppCategory,
} from "../../src/types";

const SCHEMA_VERSION = 1;
const PROFILE_FILENAME = "device-profile.json";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Promisify exec with a timeout (ms). Never throws — resolves to string|"". */
function run(
  cmd: string,
  timeoutMs = 2500
): Promise<string> {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      resolve("");
    }, timeoutMs);
    try {
      exec(cmd, { windowsHide: true }, (err, stdout) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(err ? "" : (stdout ?? "").toString());
      });
    } catch {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve("");
    }
  });
}

/** Run several probes in parallel, tolerate failures. */
async function parallel<T extends Record<string, Promise<unknown>>>(
  map: T
): Promise<{ [K in keyof T]: Awaited<T[K]> | null }> {
  const keys = Object.keys(map) as (keyof T)[];
  const results = await Promise.allSettled(keys.map((k) => map[k]));
  const out = {} as { [K in keyof T]: Awaited<T[K]> | null };
  keys.forEach((k, i) => {
    const r = results[i];
    out[k] = r.status === "fulfilled" ? (r.value as any) : null;
  });
  return out;
}

function gb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024 / 1024) * 10) / 10;
}

function platformLabel(p: string): string {
  if (p === "win32") return "Windows";
  if (p === "darwin") return "macOS";
  return "Linux";
}

// ---------------------------------------------------------------------------
// Display discovery
// ---------------------------------------------------------------------------

function discoverDisplays(): {
  displays: DisplayInfo[];
  primary: DisplayInfo;
} {
  const all = screen.getAllDisplays();
  const displays: DisplayInfo[] = all.map((d, i) => ({
    id: i,
    bounds: { ...d.bounds },
    workArea: { ...d.workArea },
    scaleFactor: d.scaleFactor,
    isPrimary: d.id === screen.getPrimaryDisplay().id || i === 0,
    rotation: d.rotation,
  }));

  // Ensure exactly one primary.
  let primaryIdx = displays.findIndex((d) => d.isPrimary);
  if (primaryIdx === -1) primaryIdx = 0;
  displays.forEach((d, i) => (d.isPrimary = i === primaryIdx));

  return { displays, primary: displays[primaryIdx] };
}

// ---------------------------------------------------------------------------
// Windows-specific probes
// ---------------------------------------------------------------------------

function classifyWindowsApp(name: string, appId: string): AppCategory {
  const text = `${name} ${appId}`.toLowerCase();
  if (
    text.includes("chrome") ||
    text.includes("edge") ||
    text.includes("brave") ||
    text.includes("firefox") ||
    text.includes("opera") ||
    text.includes("browser")
  ) return "browser";
  if (
    text.includes("code") ||
    text.includes("vscode") ||
    text.includes("visual studio") ||
    text.includes("cursor") ||
    text.includes("sublime") ||
    text.includes("notepad++")
  ) return "editor";
  if (text.includes("spotify") || text.includes("music") || text.includes("itunes")) return "music";
  if (text.includes("outlook") || text.includes("mail") || text.includes("thunderbird")) return "mail";
  if (text.includes("terminal") || text.includes("powershell") || text.includes("cmd") || text.includes("wt")) return "terminal";
  if (text.includes("calculator") || text.includes("calc")) return "system";
  return "notes";
}

function fallbackWindowsAppName(appId: string): string {
  const trimmed = appId.trim();
  if (!trimmed) return "App";
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const host = new URL(trimmed).hostname.replace(/^www\./, "");
      return host || "Web app";
    } catch {
      return "Web app";
    }
  }
  if (/^[a-z]:[\\/]/i.test(trimmed)) {
    const base = path.basename(trimmed);
    return base.replace(/\.[^.]+$/, "") || base || "App";
  }
  const parts = trimmed.split(".");
  return (parts[parts.length - 1] || trimmed).replace(/^[a-z]/, (c) => c.toUpperCase());
}

// Default-handler queries (Windows). The registry UserChoice key tells us
// the user's actual default browser / mail client.
const WIN_DEFAULT_BROWSER_CMD =
  "powershell -NoProfile -Command \"$p = (Get-ItemProperty 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice' -ErrorAction SilentlyContinue).ProgId; if ($p) { $p }\"";
const WIN_DEFAULT_MAIL_CMD =
  "powershell -NoProfile -Command \"$p = (Get-ItemProperty 'HKCU:\\SOFTWARE\\Clients\\Mail' -ErrorAction SilentlyContinue).'(default)'; if ($p) { $p }\"";

function decodeWindowsBrowser(progId: string): string | null {
  if (!progId) return null;
  const p = progId.toLowerCase();
  if (p.includes("edge")) return "Microsoft Edge";
  if (p.includes("chrome")) return "Google Chrome";
  if (p.includes("brave")) return "Brave";
  if (p.includes("firefox")) return "Mozilla Firefox";
  if (p.includes("opera")) return "Opera";
  if (p.includes("vivaldi")) return "Vivaldi";
  return progId;
}

function decodeWindowsMail(progId: string): string | null {
  if (!progId) return null;
  const p = progId.toLowerCase();
  if (p.includes("outlook")) return "Microsoft Outlook";
  if (p.includes("mail") || p.includes("windows")) return "Windows Mail";
  if (p.includes("thunderbird")) return "Mozilla Thunderbird";
  return progId;
}

// Windows taskbar is at the bottom by default but can be moved. We infer the
// edge by comparing the primary display's bounds vs workArea.
function inferWindowsTaskbar(primary: DisplayInfo): {
  edge: "bottom" | "top" | "left" | "right";
  height: number;
} {
  const { bounds, workArea } = primary;
  const bottomGap = bounds.height - workArea.height - (workArea.y - bounds.y);
  const topGap = workArea.y - bounds.y;
  const leftGap = workArea.x - bounds.x;
  const rightGap = bounds.width - workArea.width - leftGap;

  const max = Math.max(bottomGap, topGap, leftGap, rightGap);
  if (max <= 0) return { edge: "bottom", height: 48 };
  if (max === bottomGap) return { edge: "bottom", height: bottomGap };
  if (max === topGap) return { edge: "top", height: topGap };
  if (max === leftGap) return { edge: "left", height: leftGap };
  return { edge: "right", height: rightGap };
}

async function scanWindows(): Promise<Partial<DeviceProfile>> {
  const probed = await parallel({
    // Installed apps — Start Menu scan is the broadest and most reliable.
    startApps: run(
      "powershell -NoProfile -Command \"Get-StartApps | Select-Object DisplayName,AppID | ConvertTo-Json -Compress\"",
      6000
    ),
    defaultBrowser: run(WIN_DEFAULT_BROWSER_CMD, 3000),
    defaultMailApp: run(WIN_DEFAULT_MAIL_CMD, 3000),
    storage: run(
      "powershell -NoProfile -Command \"$d = Get-CimInstance Win32_LogicalDisk -Filter \\\"DriveType=3\\\" | Sort-Object Size -Descending | Select -First 1; if ($d) { '{0},{1}' -f $d.Size, $d.FreeSpace }\"",
      4000
    ),
  });

  let startApps: Array<{ DisplayName?: string; AppID?: string }> = [];
  const rawStartApps = (probed.startApps ?? "").trim();
  if (rawStartApps) {
    try {
      const parsed = JSON.parse(rawStartApps);
      startApps = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      startApps = [];
    }
  }

  const apps: InstalledApp[] = startApps
    .map((app) => {
      const appId = (app.AppID ?? "").trim();
      if (/^https?:\/\//i.test(appId)) return null;
      const name = (app.DisplayName ?? "").trim() || fallbackWindowsAppName(appId);
      if (!appId && !name) return null;
      return {
        id: appId || name.toLowerCase().replace(/\s+/g, "-"),
        name,
        category: classifyWindowsApp(name, appId),
        launchId: appId || undefined,
      };
    })
    .filter(Boolean) as InstalledApp[];

  const defaultBrowser =
    decodeWindowsBrowser((probed.defaultBrowser ?? "").trim()) || null;
  const defaultMailApp =
    decodeWindowsMail((probed.defaultMailApp ?? "").trim()) || null;

  let storage: DeviceProfile["storage"] | undefined;
  const s = (probed.storage ?? "").trim();
  if (s.includes(",")) {
    const [totalB, freeB] = s.split(",").map((n) => Number(n.trim()));
    if (totalB > 0) {
      storage = {
        totalGB: gb(totalB),
        freeGB: gb(freeB),
        usedGB: gb(totalB - freeB),
      };
    }
  }

  return { apps, defaultBrowser, defaultMailApp, storage };
}

// ---------------------------------------------------------------------------
// macOS probes
// ---------------------------------------------------------------------------

const MAC_APP_PROBES: { id: string; name: string; category: AppCategory; bundle: string }[] = [
  { id: "safari", name: "Safari", category: "browser", bundle: "com.apple.Safari" },
  { id: "chrome", name: "Google Chrome", category: "browser", bundle: "com.google.Chrome" },
  { id: "edge", name: "Microsoft Edge", category: "browser", bundle: "com.microsoft.edgemac" },
  { id: "brave", name: "Brave", category: "browser", bundle: "com.brave.Browser" },
  { id: "firefox", name: "Mozilla Firefox", category: "browser", bundle: "org.mozilla.firefox" },
  { id: "vscode", name: "Visual Studio Code", category: "editor", bundle: "com.microsoft.VSCode" },
  { id: "cursor", name: "Cursor", category: "editor", bundle: "com.todesktop.230313mzl4w4u92" },
  { id: "sublime", name: "Sublime Text", category: "editor", bundle: "com.sublimetext.4" },
  { id: "spotify", name: "Spotify", category: "music", bundle: "com.spotify.client" },
  { id: "music", name: "Apple Music", category: "music", bundle: "com.apple.Music" },
  { id: "mail", name: "Apple Mail", category: "mail", bundle: "com.apple.mail" },
  { id: "outlook", name: "Microsoft Outlook", category: "mail", bundle: "com.microsoft.Outlook" },
  { id: "terminal", name: "Terminal", category: "terminal", bundle: "com.apple.Terminal" },
  { id: "iterm", name: "iTerm", category: "terminal", bundle: "com.googlecode.iterm2" },
];

async function scanMac(): Promise<Partial<DeviceProfile>> {
  const probed = await parallel({
    appResults: (async () => {
      const results = await Promise.all(
        MAC_APP_PROBES.map(async (probe) => ({
          probe,
          present: (
            await run(
              `test -d "/Applications/${probe.name}.app" && echo yes`,
              800
            )
          )
            .trim()
            .endsWith("yes"),
        }))
      );
      return results.filter((r) => r.present);
    })(),
    defaultBrowser: run(
      'defaults read com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers 2>/dev/null | grep -B1 "https" | grep -o \'\\"[A-Za-z .]*\\"$\' | head -1 | tr -d \'"\'',
      2500
    ),
    defaultMailApp: run(
      "defaults read com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers 2>/dev/null | true",
      2500
    ),
    storage: run("df -k / | tail -1 | awk '{print $2\",\"$4}'", 2500),
  });

  const apps: InstalledApp[] = (probed.appResults ?? []).map(
    ({ probe }) => ({
      id: probe.id,
      name: probe.name,
      category: probe.category,
      launchId: probe.bundle,
    })
  );

  const storageRaw = (probed.storage ?? "").trim();
  let storage: DeviceProfile["storage"] | undefined;
  if (storageRaw.includes(",")) {
    const [totalKB, freeKB] = storageRaw.split(",").map((n) => Number(n.trim()));
    if (totalKB > 0) {
      storage = {
        totalGB: gb(totalKB * 1024),
        freeGB: gb(freeKB * 1024),
        usedGB: gb((totalKB - freeKB) * 1024),
      };
    }
  }

  return {
    apps,
    defaultBrowser: (probed.defaultBrowser ?? "").trim() || null,
    defaultMailApp: null,
    storage,
  };
}

// ---------------------------------------------------------------------------
// Linux probes
// ---------------------------------------------------------------------------

async function scanLinux(): Promise<Partial<DeviceProfile>> {
  const probed = await parallel({
    apps: (async () => {
      const checks: { id: string; name: string; category: AppCategory; cmd: string }[] = [
        { id: "firefox", name: "Firefox", category: "browser", cmd: "which firefox" },
        { id: "chrome", name: "Google Chrome", category: "browser", cmd: "which google-chrome google-chrome-stable 2>/dev/null" },
        { id: "brave", name: "Brave", category: "browser", cmd: "which brave-browser brave 2>/dev/null" },
        { id: "edge", name: "Microsoft Edge", category: "browser", cmd: "which microsoft-edge 2>/dev/null" },
        { id: "vscode", name: "Visual Studio Code", category: "editor", cmd: "which code" },
        { id: "cursor", name: "Cursor", category: "editor", cmd: "which cursor" },
        { id: "spotify", name: "Spotify", category: "music", cmd: "which spotify" },
        { id: "gnome-terminal", name: "GNOME Terminal", category: "terminal", cmd: "which gnome-terminal" },
        { id: "konsole", name: "Konsole", category: "terminal", cmd: "which konsole" },
        { id: "thunderbird", name: "Thunderbird", category: "mail", cmd: "which thunderbird" },
      ];
      const results = await Promise.all(
        checks.map(async (c) => ({
          c,
          present: (await run(c.cmd, 1000)).trim().length > 0,
        }))
      );
      return results.filter((r) => r.present).map(({ c }) => ({
        id: c.id,
        name: c.name,
        category: c.category,
      }));
    })(),
    defaultBrowser: run("xdg-settings get default-web-browser 2>/dev/null", 1500),
    storage: run("df -k / | tail -1 | awk '{print $2\",\"$4}'", 2000),
  });

  const storageRaw = (probed.storage ?? "").trim();
  let storage: DeviceProfile["storage"] | undefined;
  if (storageRaw.includes(",")) {
    const [totalKB, freeKB] = storageRaw.split(",").map((n) => Number(n.trim()));
    if (totalKB > 0) {
      storage = {
        totalGB: gb(totalKB * 1024),
        freeGB: gb(freeKB * 1024),
        usedGB: gb((totalKB - freeKB) * 1024),
      };
    }
  }

  const rawBrowser = (probed.defaultBrowser ?? "").trim().toLowerCase();
  let defaultBrowser: string | null = null;
  if (rawBrowser.includes("firefox")) defaultBrowser = "Mozilla Firefox";
  else if (rawBrowser.includes("chrome")) defaultBrowser = "Google Chrome";
  else if (rawBrowser.includes("brave")) defaultBrowser = "Brave";
  else if (rawBrowser.includes("edge")) defaultBrowser = "Microsoft Edge";

  return {
    apps: probed.apps ?? [],
    defaultBrowser,
    defaultMailApp: null,
    storage,
  };
}

// ---------------------------------------------------------------------------
// Main scan entry
// ---------------------------------------------------------------------------

export async function scanDevice(): Promise<DeviceProfile> {
  const t0 = Date.now();
  const platform = process.platform as Platform;

  // OS / hardware (cheap, synchronous) ---
  const cpus = os.cpus();
  const totalMem = os.totalmem();

  // Displays (Electron API, synchronous) ---
  const { displays, primary } = discoverDisplays();

  // Per-platform app + defaults discovery ---
  let platformSlice: Partial<DeviceProfile> = {
    apps: [],
    defaultBrowser: null,
    defaultMailApp: null,
    storage: {
      totalGB: 0,
      freeGB: 0,
      usedGB: 0,
    },
  };
  try {
    if (platform === "win32") platformSlice = await scanWindows();
    else if (platform === "darwin") platformSlice = await scanMac();
    else platformSlice = await scanLinux();
  } catch {
    /* keep defaults */
  }

  const apps = platformSlice.apps ?? [];

  // Derive grouped lists from discovered apps.
  const pick = (cat: AppCategory) =>
    apps
      .filter((a) => a.category === cat)
      .map((a) => ({ name: a.name, id: a.id }));

  const browsers = pick("browser");
  const editors = pick("editor");
  const musicApps = pick("music");
  const mailApps = pick("mail");
  const terminals = pick("terminal");

  // If we couldn't read the default browser, fall back to first detected.
  const defaultBrowser =
    platformSlice.defaultBrowser ?? (browsers[0]?.name ?? null);

  // Editor default: prefer VS Code, then Cursor, then any.
  const defaultEditor =
    editors.find((e) => e.id === "vscode")?.name ??
    editors.find((e) => e.id === "cursor")?.name ??
    editors[0]?.name ??
    null;

  const defaultMailApp =
    platformSlice.defaultMailApp ?? mailApps[0]?.name ?? null;
  const defaultTerminal =
    terminals.find((t) => t.id === "wt" || t.id === "terminal" || t.id === "iterm")?.name ??
    terminals[0]?.name ??
    null;

  // Taskbar geometry.
  let taskbar: DeviceProfile["taskbar"] = { edge: "bottom", height: 48 };
  if (platform === "win32") taskbar = inferWindowsTaskbar(primary);
  else if (platform === "darwin") taskbar = { edge: "bottom", height: 70 };
  else taskbar = { edge: "left", height: 48 };

  // Theme — best effort.
  let theme: DeviceProfile["theme"] = "unknown";
  if (typeof (nativeTheme as any)?.shouldUseDarkColors === "boolean") {
    theme = (nativeTheme as any).shouldUseDarkColors ? "dark" : "light";
  }

  const profile: DeviceProfile = {
    schemaVersion: SCHEMA_VERSION,
    scannedAt: Date.now(),
    scanDurationMs: Date.now() - t0,

    platform,
    platformLabel: platformLabel(platform),
    osVersion: os.release(),
    osRelease: os.version?.() ?? "",
    hostname: os.hostname(),
    arch: process.arch,

    cpuModel: cpus[0]?.model ?? "Unknown",
    cpuCores: cpus.length,
    totalMemoryGB: gb(totalMem),
    freeMemoryGB: gb(os.freemem()),

    storage: platformSlice.storage ?? {
      totalGB: 0,
      freeGB: 0,
      usedGB: 0,
    },

    displays,
    primaryDisplay: primary,
    monitorCount: displays.length,
    primaryResolution: {
      width: primary.bounds.width,
      height: primary.bounds.height,
    },
    scaleFactor: primary.scaleFactor,

    locale: Intl.DateTimeFormat().resolvedOptions().locale || "en-US",
    language:
      (process.env.LANG || process.env.LC_ALL || "en").split(".")[0] || "en",
    theme,

    apps,
    defaultBrowser,
    defaultMailApp,
    defaultEditor,
    defaultTerminal,

    browsers,
    editors,
    musicApps,
    mailApps,
    terminals,

    taskbar,
  };

  return profile;
}

// Lazy import of nativeTheme so this file loads cleanly in any context.
let nativeTheme: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  nativeTheme = require("electron").nativeTheme;
} catch {
  /* not in electron context */
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export function profilePath(userDataDir: string): string {
  return path.join(userDataDir, PROFILE_FILENAME);
}

export function loadProfile(userDataDir: string): DeviceProfile | null {
  try {
    const p = profilePath(userDataDir);
    if (!fs.existsSync(p)) return null;
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!data || data.schemaVersion !== SCHEMA_VERSION) return null;
    return data as DeviceProfile;
  } catch {
    return null;
  }
}

export function saveProfile(userDataDir: string, profile: DeviceProfile): void {
  try {
    fs.writeFileSync(profilePath(userDataDir), JSON.stringify(profile, null, 2));
  } catch {
    /* best effort */
  }
}

/** Re-scan only if missing or older than maxAgeMs. */
export async function ensureProfile(
  userDataDir: string,
  maxAgeMs = 24 * 60 * 60 * 1000
): Promise<DeviceProfile> {
  const existing = loadProfile(userDataDir);
  if (existing && Date.now() - existing.scannedAt < maxAgeMs) {
    return existing;
  }
  const fresh = await scanDevice();
  saveProfile(userDataDir, fresh);
  return fresh;
}
