// Quip Execution Engine — File / Folder / Project Discovery
// ─────────────────────────────────────────────────────────────────────────────
// Resolves "open my quip project" / "open downloads" / "open invoice.pdf"
// to real local paths, then opens + verifies them.
//
// Performance rule: NO full-drive scans. Known folders first, then shallow
// scans of common project roots only (depth-limited, cached per session).
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { shell } from "electron";
import { ok, fail, windowWithTitleExists, type ActionVerification } from "./action-verifier";
import type { ExecutionContextState } from "./context-store";

export interface ResolvedLocalTarget {
  kind: "file" | "folder" | "project";
  path: string;
  displayName: string;
  confidence: number;
}

const HOME = os.homedir();

// ─── Known folders ───────────────────────────────────────────────────────────

const KNOWN_FOLDERS: Record<string, () => string> = {
  downloads: () => path.join(HOME, "Downloads"),
  download: () => path.join(HOME, "Downloads"),
  desktop: () => path.join(HOME, "Desktop"),
  documents: () => path.join(HOME, "Documents"),
  document: () => path.join(HOME, "Documents"),
  docs: () => path.join(HOME, "Documents"),
  pictures: () => path.join(HOME, "Pictures"),
  photos: () => path.join(HOME, "Pictures"),
  music: () => path.join(HOME, "Music"),
  videos: () => path.join(HOME, "Videos"),
  home: () => HOME,
};

function resolveKnownFolder(word: string): string | null {
  const fn = KNOWN_FOLDERS[word.toLowerCase().trim()];
  return fn ? fn() : null;
}

// ─── Project roots (shallow scan targets) ────────────────────────────────────

function projectRoots(): string[] {
  const candidates = [
    path.join(HOME, "Desktop"),
    path.join(HOME, "Documents"),
    path.join(HOME, "dev"),
    path.join(HOME, "projects"),
    path.join(HOME, "Projects"),
    path.join(HOME, "code"),
    path.join(HOME, "source"),
    path.join(HOME, "repos"),
    path.join(HOME, "Downloads"),
  ];
  return candidates.filter((p) => {
    try {
      return fs.existsSync(p) && fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  });
}

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".cache",
  "out", "target", "vendor", "__pycache__", ".venv", "venv",
]);

// ─── Ranked candidates (the follow-up flow's data source) ────────────────────

export interface LocalCandidate {
  path: string;
  name: string;
  kind: "file" | "folder";
  score: number;
  source: "exact-path" | "known-folder" | "project-scan" | "common-scan" | "recent" | "context";
}

/** Common user folders searched before any deeper scan — OneDrive-aware.
 *  Windows "folder backup" silently redirects the REAL Desktop/Documents to
 *  ~/OneDrive/…; only checking the plain folders made Quip "not find" files
 *  that clearly existed. Both locations are searched, plain first. */
function knownFolderVariants(name: string): string[] {
  const oneDrives = [
    process.env.OneDrive,
    process.env.OneDriveConsumer,
    process.env.OneDriveCommercial,
  ].filter((v): v is string => !!v);
  const out = [path.join(HOME, name), ...oneDrives.map((od) => path.join(od, name))];
  return [...new Set(out)];
}

function commonUserFolders(): string[] {
  const names = ["Desktop", "Documents", "Downloads", "Pictures", "Music", "Videos"];
  const out: string[] = [];
  for (const n of names) {
    for (const v of knownFolderVariants(n)) {
      if (!out.includes(v)) out.push(v);
    }
  }
  return out;
}

/** Bounded Levenshtein ratio — last-resort similarity for typos. */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const max = Math.max(a.length, b.length);
  if (Math.abs(a.length - b.length) > Math.floor(max * 0.4)) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return 1 - prev[b.length] / max;
}

/**
 * Score one entry name against the query (both lowercase), 0–100 scale:
 * 92 exact name · 90 exact base name · 80 prefix · 68 substring ·
 * 72/62 token coverage · 50–65 fuzzy typo. Exported for tests.
 */
export function scoreEntryName(queryLower: string, entryNameLower: string): number {
  const baseNoExt = entryNameLower.replace(/\.[^.]+$/, "");
  if (entryNameLower === queryLower) return 92;
  if (baseNoExt === queryLower) return 90;
  if (baseNoExt.startsWith(queryLower) && queryLower.length >= 3) return 80;
  if (baseNoExt.includes(queryLower) && queryLower.length >= 3) return 68;

  const qTokens = queryLower.split(/[\s._-]+/).filter((t) => t.length > 1);
  const nTokens = baseNoExt.split(/[\s._-]+/).filter(Boolean);
  if (qTokens.length > 0) {
    let hits = 0;
    for (const t of qTokens) {
      if (nTokens.some((n) => n === t)) hits += 1;
      else if (nTokens.some((n) => n.startsWith(t) && t.length >= 3)) hits += 0.75;
      else if (nTokens.some((n) => n.includes(t) && t.length >= 4)) hits += 0.5;
    }
    const coverage = hits / qTokens.length;
    if (coverage >= 1) return 72;
    if (coverage >= 0.7) return 62;
  }

  const fuzz = similarity(queryLower, baseNoExt);
  if (fuzz >= 0.82 && queryLower.length >= 4) return Math.round(50 + (fuzz - 0.82) * 30);
  return 0;
}

/** Depth-bounded name matching — collects every plausible hit, not just one. */
function walkCollect(
  root: string,
  queryLower: string,
  depth: number,
  maxDepth: number,
  out: LocalCandidate[],
  source: LocalCandidate["source"],
  deadline: number
): void {
  if (out.length >= 24 || depth > maxDepth || Date.now() > deadline) return;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= 24 || Date.now() > deadline) return;
    if (entry.name.startsWith(".") && entry.name !== ".env") continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    const matched = scoreEntryName(queryLower, entry.name.toLowerCase());
    if (matched > 0) {
      const score = matched - depth * 2; // shallower matches rank higher
      out.push({
        path: full,
        name: entry.name,
        kind: entry.isDirectory() ? "folder" : "file",
        score,
        source,
      });
    }
    if (entry.isDirectory()) {
      walkCollect(full, queryLower, depth + 1, maxDepth, out, source, deadline);
    }
  }
}

/** Windows Recent-shortcuts: the fastest hit for "the file I had yesterday". */
function recentCandidates(queryLower: string): LocalCandidate[] {
  if (process.platform !== "win32") return [];
  const recent = path.join(process.env.APPDATA ?? "", "Microsoft", "Windows", "Recent");
  if (!recent) return [];
  const out: LocalCandidate[] = [];
  try {
    for (const entry of fs.readdirSync(recent)) {
      if (!entry.toLowerCase().endsWith(".lnk")) continue;
      const nameLower = entry.toLowerCase().replace(/\.lnk$/, "").replace(/- shortcut$/, "");
      if (nameLower === queryLower) {
        out.push({ path: path.join(recent, entry), name: entry.replace(/\.lnk$/i, ""), kind: "file", score: 86, source: "recent" });
      } else if (queryLower.length >= 3 && nameLower.includes(queryLower)) {
        out.push({ path: path.join(recent, entry), name: entry.replace(/\.lnk$/i, ""), kind: "file", score: 64, source: "recent" });
      }
    }
  } catch {
    /* no Recent access — skip */
  }
  return out;
}

/**
 * Rank ALL plausible local matches for a query (bounded, never a full-drive
 * scan): exact path → known folders → context → common user folders
 * (depth 2) → project roots (depth 3) → Recent. Deduped, best first.
 * This is the data behind the follow-up flow ("I found 3 — open which?").
 */
export async function resolveLocalCandidates(
  query: string,
  context?: ExecutionContextState,
  opts?: { kind?: "file" | "folder" | "any"; limit?: number }
): Promise<LocalCandidate[]> {
  const raw = query.trim().replace(/[?.!]+$/, "");
  if (!raw) return [];
  const q = raw.toLowerCase();
  const kind = opts?.kind ?? "any";
  const limit = opts?.limit ?? 6;
  const deadline = Date.now() + 6000;
  const all: LocalCandidate[] = [];

  // 1. Absolute / explicit path (Windows drive, ~ home, POSIX home)
  const pathMatch = raw.match(/([A-Za-z]:\\[^"<>|*?]+|[A-Za-z]:\/[^"<>|*?]+|~\/[\w\-./ ]+)/)
    ?? raw.match(/((?:\/home|\/Users|\/root)\/[\w\-./ ]+)/);
  if (pathMatch) {
    const candidate = pathMatch[1].trim();
    const expanded = candidate.startsWith("~") ? path.join(HOME, candidate.slice(1)) : candidate;
    try {
      const stat = fs.statSync(expanded);
      all.push({
        path: expanded,
        name: path.basename(expanded),
        kind: stat.isDirectory() ? "folder" : "file",
        score: 100,
        source: "exact-path",
      });
    } catch {
      /* not a real path — continue */
    }
  }

  // 2. Known folders ("open downloads")
  for (const word of q.split(/\s+/)) {
    const folder = resolveKnownFolder(word);
    if (folder) {
      try {
        if (fs.existsSync(folder)) {
          all.push({ path: folder, name: path.basename(folder), kind: "folder", score: 95, source: "known-folder" });
        }
      } catch {
        /* skip */
      }
    }
  }

  // 3. Context reuse ("open that folder again")
  if (context?.lastOpenedPath && /that|it|again|project|folder/.test(q)) {
    try {
      if (fs.existsSync(context.lastOpenedPath)) {
        all.push({
          path: context.lastOpenedPath,
          name: path.basename(context.lastOpenedPath),
          kind: "folder",
          score: 75,
          source: "context",
        });
      }
    } catch {
      /* fall through */
    }
  }

  // 4. Common user folders, depth 2 (fast, covers most personal files)
  for (const root of commonUserFolders()) {
    try {
      if (!fs.statSync(root).isDirectory()) continue;
    } catch {
      continue;
    }
    walkCollect(root, q, 0, 2, all, "common-scan", deadline);
  }

  // 5. Project roots, depth 3 (code folders live deeper)
  for (const root of projectRoots()) {
    walkCollect(root, q, 0, 3, all, "project-scan", deadline);
    if (Date.now() > deadline) break;
  }

  // 6. Windows Recent shortcuts
  all.push(...recentCandidates(q));

  // Filter by kind, dedupe (case-insensitive path), keep best score per path.
  const kindFiltered = all.filter((c) => (kind === "any" ? true : c.kind === kind));
  const best = new Map<string, LocalCandidate>();
  for (const c of kindFiltered) {
    const key = c.path.toLowerCase();
    const prev = best.get(key);
    if (!prev || c.score > prev.score) best.set(key, c);
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score || a.path.length - b.path.length)
    .slice(0, limit);
}

/** Shallow search for a folder/file by name (depth ≤ 3, skips build dirs). */
function findMatching(
  root: string,
  queryLower: string,
  depth: number,
  maxDepth: number,
  out: string[],
  limit: number
): void {
  if (out.length >= limit || depth > maxDepth) return;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= limit) return;
    if (entry.name.startsWith(".") && entry.name !== ".env") continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    const nameLower = entry.name.toLowerCase();
    const baseNoExt = nameLower.replace(/\.[^.]+$/, "");
    if (nameLower === queryLower || baseNoExt === queryLower) {
      out.push(full);
      if (out.length >= limit) return;
    }
    if (entry.isDirectory()) {
      findMatching(full, queryLower, depth + 1, maxDepth, out, limit);
    }
  }
}

/**
 * Resolve a natural-language local target.
 * Order: context reuse → known folders → exact path → project-root scan.
 */
export async function resolveLocalTarget(
  query: string,
  context?: ExecutionContextState
): Promise<ResolvedLocalTarget | null> {
  const q = query.trim().toLowerCase().replace(/[?.!]+$/, "");
  if (!q) return null;

  // 1. Context: "open that folder again" / "open my project"
  if (context?.lastOpenedPath) {
    try {
      if (fs.existsSync(context.lastOpenedPath) && /project|folder|that|it|again/.test(q)) {
        return {
          kind: "folder",
          path: context.lastOpenedPath,
          displayName: path.basename(context.lastOpenedPath),
          confidence: 0.75,
        };
      }
    } catch {
      /* fall through */
    }
  }

  // 2. Known folders
  for (const word of q.split(/\s+/)) {
    const folder = resolveKnownFolder(word);
    if (folder && fs.existsSync(folder)) {
      return { kind: "folder", path: folder, displayName: path.basename(folder), confidence: 0.9 };
    }
  }

  // 3. Exact / absolute path in the message
  const pathMatch = query.match(/([A-Za-z]:\\[^"<>|*?]+|[A-Za-z]:\/[^"<>|*?]+|~\/[\w\-./ ]+)/);
  if (pathMatch) {
    const candidate = pathMatch[1].trim();
    const expanded = candidate.startsWith("~") ? path.join(HOME, candidate.slice(1)) : candidate;
    try {
      const stat = fs.statSync(expanded);
      return {
        kind: stat.isDirectory() ? "folder" : "file",
        path: expanded,
        displayName: path.basename(expanded),
        confidence: 0.95,
      };
    } catch {
      /* not a real path — continue */
    }
  }

  // 4. Shallow scan of project roots (cached root list, bounded depth)
  const results: string[] = [];
  for (const root of projectRoots()) {
    findMatching(root, q, 0, 3, results, 5);
    if (results.length >= 3) break;
  }
  if (results.length > 0) {
    const best = results[0];
    try {
      const stat = fs.statSync(best);
      return {
        kind: stat.isDirectory() ? "project" : "file",
        path: best,
        displayName: path.basename(best),
        confidence: 0.8,
      };
    } catch {
      /* race — fall through */
    }
  }

  return null;
}

/** Open a resolved local target and verify it actually opened. */
export async function openLocalTarget(target: ResolvedLocalTarget): Promise<ActionVerification> {
  let exists = false;
  try {
    exists = fs.existsSync(target.path);
  } catch {
    exists = false;
  }
  if (!exists) {
    return fail(
      `I couldn't find "${target.displayName}" on disk anymore.`,
      [`path missing: ${target.path}`],
      "path-missing"
    );
  }

  if (target.kind === "file") {
    const err = await shell.openPath(target.path);
    if (err) {
      return fail(
        `I couldn't open "${target.displayName}" — ${err}`,
        [`shell.openPath error: ${err}`],
        "open-file-failed"
      );
    }
    return ok(`Opened ${target.displayName}.`, [`shell.openPath succeeded for ${target.path}`]);
  }

  // Folder / project — explorer shows the path in its title bar on Windows.
  const res = await shell.openPath(target.path);
  if (res) {
    return fail(
      `I couldn't open the folder "${target.displayName}" — ${res}`,
      [`shell.openPath error: ${res}`],
      "open-folder-failed"
    );
  }
  const nameVerified = await windowWithTitleExists(target.displayName);
  return ok(
    `Opened ${target.kind === "project" ? "the project" : "the folder"} ${target.displayName}.`,
    [
      `shell.openPath succeeded for ${target.path}`,
      nameVerified ? "explorer window title verified" : "window title not yet visible (opened non-blocking)",
    ]
  );
}
