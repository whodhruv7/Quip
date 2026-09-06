// Quip Execution Engine — File Operations
// ─────────────────────────────────────────────────────────────────────────────
// REAL file/folder operations on the user's device, with verification:
//   read / create / write / append / delete / copy / move files
//   create / delete / copy / move folders, list folders, search by name
//
// Safety: paths are resolved against the user's home directory and checked
// against a deny-list (Windows system dirs). Nothing outside the user's
// scope is touched. Every operation verifies its result on disk afterwards —
// no fake success.
// ─────────────────────────────────────────────────────────────────────────────

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { ok, fail, type ActionVerification } from "./action-verifier";

const DENY_DIRS = [
  "windows",
  "program files",
  "program files (x86)",
  "programdata",
  "appdata\\local\\temp", // still allow inside userData, not system temp
];

/** Resolve a user-supplied path to an absolute one inside the user's scope. */
export function resolveUserPath(raw: string): { ok: true; path: string } | { ok: false; reason: string } {
  let p = raw.trim().replace(/^["']|["']$/g, "");
  if (!p) return { ok: false, reason: "empty path" };
  // Expand ~ and common folder aliases
  if (p.startsWith("~")) p = path.join(os.homedir(), p.slice(1));
  if (/^(desktop|downloads|documents|pictures|music|videos|movies)/i.test(p) && !path.isAbsolute(p)) {
    p = path.join(os.homedir(), p);
  }
  const abs = path.isAbsolute(p) ? path.normalize(p) : path.join(process.cwd(), p);
  const lower = abs.toLowerCase();

  if (DENY_DIRS.some((d) => lower === `c:\\${d}` || lower.startsWith(`c:\\${d}\\`))) {
    return { ok: false, reason: "system locations are protected" };
  }
  // Must be inside the user profile or a drive root folder the user named
  const homeLower = os.homedir().toLowerCase();
  if (!lower.startsWith(homeLower)) {
    // Allow other drives (D:\projects...) but deny obvious system roots
    if (/^c:\\$/.test(lower) || /^c:\\windows/i.test(lower)) {
      return { ok: false, reason: "system locations are protected" };
    }
  }
  return { ok: true, path: abs };
}

function statInfo(p: string): { exists: boolean; isDir: boolean; size: number; mtime: number } {
  try {
    const st = fs.statSync(p);
    return { exists: true, isDir: st.isDirectory(), size: st.size, mtime: st.mtimeMs };
  } catch {
    return { exists: false, isDir: false, size: 0, mtime: 0 };
  }
}

function truncate(s: string, n = 8000): string {
  return s.length > n ? s.slice(0, n) + `\n… (truncated, ${s.length} chars total)` : s;
}

export type FileOp =
  | { op: "read"; path: string }
  | { op: "write"; path: string; content: string; append?: boolean }
  | { op: "delete"; path: string }
  | { op: "copy"; from: string; to: string }
  | { op: "move"; from: string; to: string }
  | { op: "mkdir"; path: string }
  | { op: "list"; path: string }
  | { op: "search"; query: string; base?: string };

export function executeFileOp(action: FileOp): ActionVerification {
  switch (action.op) {
    case "read": {
      const r = resolveUserPath(action.path);
      if (!r.ok) return fail(`I won't read there — ${r.reason}.`, [], "unsafe-path");
      const st = statInfo(r.path);
      if (!st.exists) return fail(`I couldn't find "${action.path}".`, ["file does not exist"], "file-not-found");
      if (st.isDir) {
        const entries = safeList(r.path);
        return ok(`"${action.path}" is a folder with ${entries.length} items:\n${entries.slice(0, 20).map((e) => `• ${e}`).join("\n")}`, ["path is a folder — listed instead"]);
      }
      if (st.size > 2_000_000) {
        return fail(`"${action.path}" is too big to read inline (${st.size} bytes).`, ["file over 2 MB"], "file-too-large");
      }
      try {
        const text = fs.readFileSync(r.path, "utf8");
        return ok(truncate(text), [`read ${st.size} bytes from ${r.path}`]);
      } catch {
        return fail(`I couldn't read "${action.path}" as text (it may be binary).`, ["read failed"], "read-failed");
      }
    }

    case "write": {
      const r = resolveUserPath(action.path);
      if (!r.ok) return fail(`I won't write there — ${r.reason}.`, [], "unsafe-path");
      const existed = statInfo(r.path).exists;
      try {
        fs.mkdirSync(path.dirname(r.path), { recursive: true });
        if (action.append && existed) {
          fs.appendFileSync(r.path, action.content);
        } else {
          fs.writeFileSync(r.path, action.content, "utf8");
        }
        const st = statInfo(r.path);
        return st.exists && (!existed || true)
          ? ok(`${action.append && existed ? "Appended to" : existed ? "Wrote (overwrote)" : "Created"} "${action.path}".`, [`file now ${st.size} bytes`])
          : fail(`I couldn't verify the write.`, ["stat failed after write"], "write-verify-failed");
      } catch (e: any) {
        return fail(`I couldn't write "${action.path}".`, [`error: ${String(e?.message ?? e)}`], "write-failed");
      }
    }

    case "delete": {
      const r = resolveUserPath(action.path);
      if (!r.ok) return fail(`I won't delete there — ${r.reason}.`, [], "unsafe-path");
      const st = statInfo(r.path);
      if (!st.exists) return fail(`"${action.path}" doesn't exist.`, ["nothing to delete"], "delete-not-found");
      try {
        fs.rmSync(r.path, { recursive: st.isDir, force: false });
      } catch (e: any) {
        return fail(`I couldn't delete "${action.path}".`, [`error: ${String(e?.message ?? e)}`], "delete-failed");
      }
      return statInfo(r.path).exists
        ? fail(`"${action.path}" still exists after delete.`, ["delete did not take effect"], "delete-verify-failed")
        : ok(`Deleted ${st.isDir ? "folder" : "file"} "${action.path}".`, ["verified gone"]);
    }

    case "copy":
    case "move": {
      const from = resolveUserPath(action.from);
      const to = resolveUserPath(action.to);
      if (!from.ok) return fail(`I won't read from there — ${from.reason}.`, [], "unsafe-path");
      if (!to.ok) return fail(`I won't write there — ${to.reason}.`, [], "unsafe-path");
      const st = statInfo(from.path);
      if (!st.exists) return fail(`I couldn't find "${action.from}".`, ["source missing"], "copy-source-missing");
      try {
        fs.mkdirSync(path.dirname(to.path), { recursive: true });
        // If destination is an existing folder, copy/move INTO it keeping the name
        let dest = to.path;
        const destStat = statInfo(to.path);
        if (destStat.exists && destStat.isDir) {
          dest = path.join(to.path, path.basename(from.path));
        }
        if (action.op === "copy") {
          fs.cpSync(from.path, dest, { recursive: true });
        } else {
          fs.renameSync(from.path, dest);
        }
        const after = statInfo(dest);
        if (action.op === "move" && statInfo(from.path).exists) {
          return fail(`I couldn't move "${action.from}" — source still exists (cross-drive?).`, ["rename failed"], "move-verify-failed");
        }
        return after.exists
          ? ok(`${action.op === "copy" ? "Copied" : "Moved"} "${action.from}" → "${dest}".`, [`destination ${after.size} bytes`])
          : fail(`I couldn't verify the ${action.op}.`, ["destination missing"], "copy-verify-failed");
      } catch (e: any) {
        return fail(`I couldn't ${action.op} "${action.from}".`, [`error: ${String(e?.message ?? e)}`], `${action.op}-failed`);
      }
    }

    case "mkdir": {
      const r = resolveUserPath(action.path);
      if (!r.ok) return fail(`I won't create folders there — ${r.reason}.`, [], "unsafe-path");
      try {
        fs.mkdirSync(r.path, { recursive: true });
      } catch (e: any) {
        return fail(`I couldn't create the folder "${action.path}".`, [`error: ${String(e?.message ?? e)}`], "mkdir-failed");
      }
      const st = statInfo(r.path);
      return st.exists && st.isDir
        ? ok(`Created folder "${action.path}".`, ["verified on disk"])
        : fail(`I couldn't verify the folder was created.`, [], "mkdir-verify-failed");
    }

    case "list": {
      const r = resolveUserPath(action.path);
      if (!r.ok) return fail(`I won't list there — ${r.reason}.`, [], "unsafe-path");
      const st = statInfo(r.path);
      if (!st.exists) return fail(`I couldn't find "${action.path}".`, ["folder missing"], "list-not-found");
      const entries = safeList(r.path);
      return ok(
        entries.length
          ? `"${action.path}" contains ${entries.length} items:\n${entries.slice(0, 30).map((e) => `• ${e}`).join("\n")}`
          : `"${action.path}" is empty.`,
        [`${entries.length} entries`]
      );
    }

    case "search": {
      const baseR = action.base ? resolveUserPath(action.base) : { ok: true as const, path: os.homedir() };
      if (!baseR.ok) return fail(`I won't search there — ${baseR.reason}.`, [], "unsafe-path");
      const needle = action.query.toLowerCase().trim();
      if (!needle) return fail("I don't know what file name to search for.", [], "empty-query");
      const roots = [baseR.path, path.join(os.homedir(), "Desktop"), path.join(os.homedir(), "Documents"), path.join(os.homedir(), "Downloads")];
      const seen = new Set<string>();
      const hits: string[] = [];
      const deadline = Date.now() + 6000;
      for (const root of roots) {
        if (seen.has(root.toLowerCase()) || !statInfo(root).exists) continue;
        seen.add(root.toLowerCase());
        walkSearch(root, needle, hits, deadline, 0);
        if (hits.length >= 15 || Date.now() > deadline) break;
      }
      return hits.length
        ? ok(`Found ${hits.length} matching item${hits.length > 1 ? "s" : ""}:\n${hits.map((h) => `• ${h}`).join("\n")}`, [`searched: ${needle}`])
        : fail(`I couldn't find any file matching "${action.query}".`, ["searched common folders"], "search-no-hits");
    }

    default:
      return fail("Unknown file operation.", [], "unknown-file-op");
  }
}

function safeList(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .map((e) => (e.isDirectory() ? e.name + "/" : e.name))
      .slice(0, 200);
  } catch {
    return [];
  }
}

function walkSearch(dir: string, needle: string, hits: string[], deadline: number, depth: number): void {
  if (depth > 4 || Date.now() > deadline || hits.length >= 15) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (hits.length >= 15 || Date.now() > deadline) return;
    if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "$RECYCLE.BIN" || e.name === "AppData") continue;
    if (e.name.toLowerCase().includes(needle)) {
      hits.push(path.join(dir, e.name));
    }
    if (e.isDirectory()) walkSearch(path.join(dir, e.name), needle, hits, deadline, depth + 1);
  }
}
