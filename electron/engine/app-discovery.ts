// Quip Execution Engine — Installed App Discovery
// ─────────────────────────────────────────────────────────────────────────────
// Discovers actually-installed applications. No hardcoded app lists for
// launching — Quip discovers what exists on THIS laptop.
//
// Sources (Windows):
//   - Start Menu shortcuts (user + all users), resolved via WScript.Shell COM
//   - %LOCALAPPDATA%\Programs (per-user installs: VS Code, Discord, ...)
//   - Program Files / Program Files (x86) top-level folders
//
// Cached in userData with 24h TTL (token + performance requirement).
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { runCapture, verifyLaunched, type ActionVerification } from "./action-verifier";

export interface InstalledApp {
  name: string;
  executable?: string;
  /** Process name (exe basename without extension) for verification. */
  procName?: string;
  startCommand?: string;
  /** AppUserModelId for UWP apps (shell:AppsFolder launch). */
  appUserModelId?: string;
  confidence: number;
}

const CACHE_FILE = "quip-app-index.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ─── Normalization helpers ───────────────────────────────────────────────────

const SKIP_WORDS = /\b(uninstall|repair|modify|help|documentation|readme|license|update|setup|crash|feedback)\b/i;

export function normalizeAppName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.lnk$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function procNameFromExe(exePath: string): string {
  return path.basename(exePath).replace(/\.exe$/i, "");
}

/** Well-known alias table for canonical names → better matching. */
const COMMON_ALIASES: Record<string, string[]> = {
  "visual studio code": ["vs code", "vscode", "code"],
  "google chrome": ["chrome"],
  "microsoft edge": ["edge"],
  "file explorer": ["explorer", "files"],
  "command prompt": ["cmd"],
  "windows terminal": ["terminal", "wt"],
  "spotify": ["spotify music"],
  "whatsapp": ["whatsapp web"],
  "notepad": ["text editor"],
  "calculator": ["calc"],
};

// ─── Windows scan ────────────────────────────────────────────────────────────

function startMenuDirs(): string[] {
  const appData = process.env.APPDATA ?? "";
  const programData = process.env.PROGRAMDATA ?? "";
  return [
    appData ? path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs") : "",
    programData ? path.join(programData, "Microsoft", "Windows", "Start Menu", "Programs") : "",
  ].filter(Boolean);
}

function localProgramsDirs(): string[] {
  const localAppData = process.env.LOCALAPPDATA ?? "";
  const pf = process.env.ProgramFiles ?? "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  return [
    localAppData ? path.join(localAppData, "Programs") : "",
    pf,
    pf86,
  ].filter(Boolean);
}

/** One PowerShell round-trip resolves ALL Start Menu .lnk targets. */
async function scanStartMenuShortcuts(): Promise<InstalledApp[]> {
  const dirs = startMenuDirs();
  if (dirs.length === 0) return [];
  const dirList = dirs.map((d) => `'${d.replace(/'/g, "''")}'`).join(",");
  const ps = `
$sh = New-Object -ComObject WScript.Shell
Get-ChildItem -Path @(${dirList}) -Recurse -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object {
  $t = $sh.CreateShortcut($_.FullName)
  if ($t.TargetPath) { "$($_.BaseName)|$($t.TargetPath)" }
}`;
  const res = await runCapture(
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps.replace(/"/g, '\\"').replace(/\r?\n/g, "; ")}"`,
    25000
  );
  if (!res || res.code !== 0 || !res.stdout) return [];

  const apps: InstalledApp[] = [];
  const seen = new Set<string>();
  for (const line of res.stdout.split(/\r?\n/)) {
    const parts = line.split("|");
    if (parts.length < 2) continue;
    const name = parts[0].trim();
    const target = parts[1].trim();
    if (!name || !target) continue;
    if (SKIP_WORDS.test(name) || !target.toLowerCase().endsWith(".exe")) continue;
    const norm = normalizeAppName(name);
    if (seen.has(norm)) continue;
    seen.add(norm);
    apps.push({
      name,
      executable: target,
      procName: procNameFromExe(target),
      confidence: 0.95,
    });
  }
  return apps;
}

/** Scan common install roots for standalone executables (per-user apps). */
async function scanProgramDirs(): Promise<InstalledApp[]> {
  const apps: InstalledApp[] = [];
  for (const dir of localProgramsDirs()) {
    try {
      if (!fs.existsSync(dir)) continue;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (SKIP_WORDS.test(entry.name)) continue;
        const dirPath = path.join(dir, entry.name);
        try {
          const files = fs.readdirSync(dirPath);
          const exe = files.find((f) => {
            const lower = f.toLowerCase();
            return lower.endsWith(".exe") && !SKIP_WORDS.test(lower) && !lower.startsWith("unins");
          });
          if (exe) {
            const exePath = path.join(dirPath, exe);
            const norm = normalizeAppName(entry.name);
            if (!apps.some((a) => normalizeAppName(a.name) === norm)) {
              apps.push({
                name: entry.name,
                executable: exePath,
                procName: procNameFromExe(exe),
                confidence: 0.85,
              });
            }
          }
        } catch {
          /* unreadable dir — skip */
        }
      }
    } catch {
      /* skip unreadable root */
    }
  }
  return apps;
}

/** UWP / Store apps via PowerShell Get-StartApps. */
async function scanUwpApps(): Promise<InstalledApp[]> {
  const res = await runCapture(
    `powershell -NoProfile -Command "Get-StartApps | ForEach-Object { if ($_.AppID -like '*!*') { '$($_.Name)|$($_.AppID)' } }"`,
    15000
  );
  if (!res || !res.stdout) return [];
  const apps: InstalledApp[] = [];
  for (const line of res.stdout.split(/\r?\n/)) {
    const idx = line.lastIndexOf("|");
    if (idx === -1) continue;
    const name = line.slice(0, idx).trim();
    const aumid = line.slice(idx + 1).trim();
    if (!name || !aumid || SKIP_WORDS.test(name)) continue;
    const norm = normalizeAppName(name);
    if (apps.some((a) => normalizeAppName(a.name) === norm)) continue;
    apps.push({ name, appUserModelId: aumid, confidence: 0.8 });
  }
  return apps;
}

// ─── Index build + cache ─────────────────────────────────────────────────────

let memCache: { apps: InstalledApp[]; at: number } | null = null;

export async function buildInstalledAppIndex(
  userDataPath?: string,
  force = false
): Promise<InstalledApp[]> {
  // 1. memory cache
  if (!force && memCache && Date.now() - memCache.at < CACHE_TTL_MS) return memCache.apps;

  // 2. disk cache
  if (!force && userDataPath) {
    try {
      const p = path.join(userDataPath, CACHE_FILE);
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        if (data?.at && Date.now() - data.at < CACHE_TTL_MS && Array.isArray(data.apps)) {
          memCache = { apps: data.apps, at: data.at };
          return data.apps;
        }
      }
    } catch {
      /* corrupt cache — rescan */
    }
  }

  // 3. fresh scan
  const [shortcuts, progs, uwp] = await Promise.all([
    scanStartMenuShortcuts(),
    scanProgramDirs(),
    scanUwpApps(),
  ]);

  const merged: InstalledApp[] = [];
  const seen = new Set<string>();
  for (const app of [...shortcuts, ...progs, ...uwp]) {
    const norm = normalizeAppName(app.name);
    if (seen.has(norm)) {
      // keep the entry with an executable (more launchable)
      const existing = merged.find((a) => normalizeAppName(a.name) === norm);
      if (existing && !existing.executable && app.executable) {
        existing.executable = app.executable;
        existing.procName = app.procName;
      }
      continue;
    }
    seen.add(norm);
    merged.push(app);
  }

  memCache = { apps: merged, at: Date.now() };
  if (userDataPath) {
    try {
      fs.writeFileSync(
        path.join(userDataPath, CACHE_FILE),
        JSON.stringify({ at: memCache.at, apps: merged })
      );
    } catch {
      /* best effort */
    }
  }
  return merged;
}

export function getCachedAppIndex(): InstalledApp[] | null {
  return memCache?.apps ?? null;
}

/** Drop the in-memory index so the next call rescans (used by device rescan). */
export function invalidateAppIndex(): void {
  memCache = null;
}

// ─── Resolution ──────────────────────────────────────────────────────────────

/** Token-overlap + substring scoring between the user's words and app names. */
export function scoreAppMatch(queryNorm: string, appNameNorm: string): number {
  if (!queryNorm || !appNameNorm) return 0;
  if (queryNorm === appNameNorm) return 1;

  const aliasFor = COMMON_ALIASES[appNameNorm];
  if (aliasFor && aliasFor.some((a) => a === queryNorm)) return 0.97;

  const qWords = new Set(queryNorm.split(" ").filter(Boolean));
  const aWords = appNameNorm.split(" ").filter(Boolean);

  let overlap = 0;
  for (const w of qWords) {
    if (aWords.includes(w)) overlap++;
    else if (aWords.some((aw) => aw.startsWith(w) && w.length >= 3)) overlap += 0.5;
  }
  const coverage = overlap / Math.max(qWords.size, 1);

  let score = coverage * 0.9;
  if (appNameNorm.includes(queryNorm) && queryNorm.length >= 3) score = Math.max(score, 0.85);
  if (aWords.length === 1 && queryNorm === appNameNorm) score = 1;
  return Math.min(score, 0.99);
}

/**
 * Resolve the user's spoken app name against the installed index.
 * e.g. "vs code" → Visual Studio Code (if installed), "whatsapp" → WhatsApp.
 */
export function resolveApp(query: string, apps: InstalledApp[]): InstalledApp | null {
  const q = normalizeAppName(query);
  if (!q) return null;

  let best: InstalledApp | null = null;
  let bestScore = 0;
  for (const app of apps) {
    const score = scoreAppMatch(q, normalizeAppName(app.name));
    if (score > bestScore) {
      best = app;
      bestScore = score;
    }
  }
  if (best && bestScore >= 0.5) return { ...best, confidence: bestScore };
  return null;
}

// ─── Launch ──────────────────────────────────────────────────────────────────

/**
 * Launch an installed app and VERIFY it actually started
 * (process appears or window title shows). Never fakes success.
 */
export async function launchApp(app: InstalledApp): Promise<ActionVerification> {
  const evidence: string[] = [];

  if (app.executable) {
    try {
      if (!fs.existsSync(app.executable)) {
        evidence.push(`executable missing: ${app.executable}`);
        return {
          ok: false,
          summary: `I found "${app.name}" in the index but its executable is gone.`,
          evidence,
          error: "exe-missing",
        };
      }
    } catch {
      /* existsSync failure — try anyway */
    }
    // `start "" "path"` — empty title arg so paths with spaces work.
    const res = await runCapture(`cmd /c start "" "${app.executable}"`, 6000);
    if (res === null) {
      evidence.push("start command failed to spawn");
    }
  } else if (app.appUserModelId) {
    const res = await runCapture(
      `cmd /c start "" "shell:AppsFolder\\${app.appUserModelId.replace(/"/g, "")}"`,
      6000
    );
    if (res === null) evidence.push("shell:AppsFolder launch failed");
  } else if (app.startCommand) {
    const res = await runCapture(app.startCommand, 6000);
    if (res === null) evidence.push("start command failed");
  } else {
    return {
      ok: false,
      summary: `No launch method available for "${app.name}".`,
      evidence,
      error: "no-launch-method",
    };
  }

  const procNames = [app.procName, normalizeAppName(app.name).replace(/\s+/g, "")].filter(Boolean) as string[];
  const verification = await verifyLaunched({
    procNames,
    titleHints: [app.name],
    timeoutMs: 9000,
  });

  if (verification.ok) return { ...verification, summary: `Opened ${app.name}.` };
  return {
    ...verification,
    summary: `I tried to open ${app.name} but couldn't confirm it started.`,
  };
}
