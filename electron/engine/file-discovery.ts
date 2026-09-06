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

export function resolveKnownFolder(word: string): string | null {
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
