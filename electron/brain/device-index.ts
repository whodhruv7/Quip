// Quip Head Brain — Device Knowledge Layer (Phase 2 of the spec)
// ─────────────────────────────────────────────────────────────────────────────
// Quip must KNOW the user's computer — learned once, refreshed as a diff,
// never rescanned on every command. "Open VS Code" resolves from THIS index
// in microseconds; no filesystem walk, no registry query, no model call.
//
//   • apps        — reused from engine/app-discovery.ts (single source of truth)
//   • browsers    — Chrome / Edge / Firefox / Brave detection
//   • userFolders — Desktop / Documents / Downloads / Music / Pictures / Videos
//   • devTools    — node / python / git / docker / adb availability
//
// Persistence: userData/quip-device-index.json. On refresh ONLY differences
// are merged (spec STEP 5: "never recreate everything, only update changes").
// Lookups are in-memory Maps → far below the 50 ms budget.
// The scanner is injectable so tests run pure (no process spawns).
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { buildInstalledAppIndex, normalizeAppName, type InstalledApp } from "../engine/app-discovery";

export interface DeviceIndexData {
  version: 1;
  updatedAt: number;
  /** Normalized app-name → launchable entry (subset of fields kept light). */
  apps: Array<InstalledApp & { aliases: string[] }>;
  browsers: string[];
  userFolders: Record<string, string>;
  devTools: Record<string, boolean>;
}

export type ExecLike = (cmd: string, args: string[]) => Promise<string>;

const INDEX_FILE = "quip-device-index.json";
const BROWSER_KEYS = ["chrome", "edge", "firefox", "brave"] as const;
const DEV_TOOL_KEYS = ["node", "python", "git", "docker", "adb"] as const;

// ─── In-memory fast lookup ───────────────────────────────────────────────────

let cache: DeviceIndexData | null = null;
let aliasMap: Map<string, InstalledApp> | null = null;

function rebuildAliasMap(data: DeviceIndexData): void {
  aliasMap = new Map();
  for (const app of data.apps) {
    const keys = new Set<string>([normalizeAppName(app.name)]);
    for (const a of app.aliases) keys.add(normalizeAppName(a));
    keys.add(normalizeAppName(app.executable ?? ""));
    for (const k of keys) {
      if (k && !aliasMap.has(k)) aliasMap.set(k, app);
    }
  }
}

/** Microsecond app lookup from the in-memory alias map. Never throws. */
export function lookupDeviceApp(query: string): { name: string; via: string } | null {
  if (!aliasMap) return null;
  const q = normalizeAppName(query);
  if (!q) return null;
  const direct = aliasMap.get(q);
  if (direct) return { name: direct.name, via: "exact alias" };
  // containment fallback: "vs code ide" → "visual studio code"
  for (const [alias, app] of aliasMap) {
    if (alias.length >= 4 && (q.includes(alias) || alias.includes(q))) {
      return { name: app.name, via: "alias containment" };
    }
  }
  return null;
}

/** The Head Brain's lookup adapter — returns null until the index is loaded. */
export function deviceLookup() {
  return {
    findApp(name: string): { name: string; via: string } | null {
      return lookupDeviceApp(name);
    },
  };
}

// ─── Scanner (injectable) ────────────────────────────────────────────────────

function run(execImpl: ExecLike, cmd: string, args: string[]): Promise<string> {
  return execImpl(cmd, args).catch(() => "");
}

function makeNodeExec(): ExecLike {
  return (cmd, args) =>
    new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: 8000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
        if (err) reject(err);
        else resolve(String(stdout ?? ""));
      });
    });
}

/**
 * Build a fresh DeviceIndexData. On Windows real probes run (where/registry);
 * on other platforms the static parts degrade gracefully so the module is
 * importable everywhere (tests inject their own scanner anyway).
 */
export async function buildDeviceIndexData(opts: {
  execImpl?: ExecLike;
  apps?: InstalledApp[];
  platform?: string;
  home?: string;
} = {}): Promise<DeviceIndexData> {
  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? (process.env.USERPROFILE || process.env.HOME || "");
  const execImpl = opts.execImpl ?? makeNodeExec();

  // Apps: reuse the existing discovery layer (already cached + persisted).
  const apps = opts.apps ?? (platform === "win32" ? await safeAppIndex() : []);

  // Browsers + dev tools via `where` (Windows) — one spawn per key.
  const browsers: string[] = [];
  const devTools: Record<string, boolean> = {};
  if (platform === "win32") {
    for (const b of BROWSER_KEYS) {
      const hit = await run(execImpl, "where", [b === "chrome" ? "chrome.exe" : `${b}.exe`]);
      if (hit.trim()) browsers.push(b);
    }
    for (const t of DEV_TOOL_KEYS) {
      const hit = await run(execImpl, "where", [platform === "win32" && t === "python" ? "python.exe" : `${t}.exe`]);
      devTools[t] = Boolean(hit.trim());
    }
  }

  const userFolders: Record<string, string> = {};
  if (home) {
    for (const f of ["Desktop", "Documents", "Downloads", "Music", "Pictures", "Videos"]) {
      const p = path.join(home, f);
      try {
        if (fs.existsSync(p)) userFolders[f.toLowerCase()] = p;
      } catch {
        /* unreadable home — skip */
      }
    }
  }

  return { version: 1, updatedAt: Date.now(), apps: apps.map(withAliases), browsers, userFolders, devTools };
}

async function safeAppIndex(): Promise<InstalledApp[]> {
  try {
    return await buildInstalledAppIndex(undefined, false);
  } catch {
    return [];
  }
}

function withAliases(app: InstalledApp): InstalledApp & { aliases: string[] } {
  const normalized = normalizeAppName(app.name);
  const aliases = new Set<string>([normalized]);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    aliases.add(words.map((w) => w[0]).join("")); // acronym: "visual studio code" → "vsc"
    aliases.add(words.join("")); // squashed: "visualstudiocode"
  }
  if (app.executable) {
    aliases.add(normalizeAppName(app.executable.replace(/\.(exe|lnk|app|bat|com)$/i, "")));
  }
  return { ...app, aliases: [...aliases].filter(Boolean) };
}

// ─── Persistence + diff refresh ──────────────────────────────────────────────

export function saveDeviceIndex(userDataPath: string, data: DeviceIndexData): void {
  try {
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(path.join(userDataPath, INDEX_FILE), JSON.stringify(data), "utf8");
  } catch {
    /* disk issues must never crash the brain */
  }
}

export function loadDeviceIndex(userDataPath: string): DeviceIndexData | null {
  try {
    const p = path.join(userDataPath, INDEX_FILE);
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    if (raw?.version === 1 && Array.isArray(raw.apps)) return raw as DeviceIndexData;
    return null;
  } catch {
    return null;
  }
}

/**
 * Load from disk into memory (instant boot), then optionally merge a fresh
 * scan. ONLY differences are written — spec STEP 5.
 */
export function activateDeviceIndex(data: DeviceIndexData): void {
  cache = data;
  rebuildAliasMap(data);
}

export function getDeviceIndexSnapshot(): DeviceIndexData | null {
  return cache ? { ...cache } : null;
}

export function refreshDeviceIndexForTests(data: DeviceIndexData | null): void {
  cache = data;
  aliasMap = null;
  if (data) rebuildAliasMap(data);
}

/** Merge a fresh scan into the cached index — changes only. */
export function mergeDeviceIndexDiff(prev: DeviceIndexData, fresh: DeviceIndexData): { merged: DeviceIndexData; changed: boolean } {
  const appsChanged = prev.apps.length !== fresh.apps.length ||
    JSON.stringify(prev.apps.map((a) => a.name)) !== JSON.stringify(fresh.apps.map((a) => a.name));
  const browsersChanged = JSON.stringify(prev.browsers) !== JSON.stringify(fresh.browsers);
  const toolsChanged = JSON.stringify(prev.devTools) !== JSON.stringify(fresh.devTools);
  const foldersChanged = JSON.stringify(prev.userFolders) !== JSON.stringify(fresh.userFolders);
  const changed = appsChanged || browsersChanged || toolsChanged || foldersChanged;
  if (!changed) {
    return { merged: { ...prev, updatedAt: fresh.updatedAt }, changed: false };
  }
  return {
    merged: {
      version: 1,
      updatedAt: fresh.updatedAt,
      apps: fresh.apps.length ? fresh.apps : prev.apps,
      browsers: fresh.browsers.length ? fresh.browsers : prev.browsers,
      devTools: { ...prev.devTools, ...fresh.devTools },
      userFolders: Object.keys(fresh.userFolders).length ? fresh.userFolders : prev.userFolders,
    },
    changed: true,
  };
}

/**
 * Boot-time background refresh: load cached index instantly, rescan in the
 * background, merge the diff. Never blocks, never throws.
 */
export async function initDeviceIndex(userDataPath: string, opts: { rescan?: boolean } = {}): Promise<void> {
  const cached = loadDeviceIndex(userDataPath);
  if (cached) activateDeviceIndex(cached);
  if (opts.rescan === false) return;
  try {
    const fresh = await buildDeviceIndexData();
    if (cached) {
      const { merged, changed } = mergeDeviceIndexDiff(cached, fresh);
      activateDeviceIndex(merged);
      if (changed) saveDeviceIndex(userDataPath, merged);
    } else {
      activateDeviceIndex(fresh);
      saveDeviceIndex(userDataPath, fresh);
    }
  } catch {
    /* cached (or empty) index stays active — the app keeps working */
  }
}
