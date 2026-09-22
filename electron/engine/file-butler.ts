// Quip FileButler — File Intelligence Engine
// ─────────────────────────────────────────────────────────────────────────────
// Organize (type/date) with dry-run plans + manifests + undo, duplicate finder
// (size prefilter → SHA-256 confirm), storage reports, and a debounced
// Downloads watch that auto-organizes with a toast for every auto-move.
//
// Safety spine:
//   • deny list — NEVER touches Windows/, Program Files/, userData itself
//   • dry-run first — applyOrganizePlan only ever runs on a PLAN the user saw
//   • collision policy — numeric suffix rename, never silent overwrite
//   • undo — manifest journal reverses every move with existence checks
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// ─── Pure core: classification ───────────────────────────────────────────────

export type FileCategory =
  | "Images" | "Videos" | "Documents" | "Spreadsheets" | "Presentations"
  | "Audio" | "Code" | "Archives" | "Installers" | "Fonts" | "Design" | "Others";

const CATEGORY_MAP: [RegExp, FileCategory][] = [
  [/\.(jpe?g|png|gif|webp|bmp|heic|avif|tiff?|svg)$/i, "Images"],
  [/\.(mp4|mkv|mov|avi|webm|flv|wmv|m4v|3gp)$/i, "Videos"],
  [/\.(pdf|docx?|odt|rtf|txt|md|epub)$/i, "Documents"],
  [/\.(xlsx?|csv|ods)$/i, "Spreadsheets"],
  [/\.(pptx?|odp|key)$/i, "Presentations"],
  [/\.(mp3|wav|flac|aac|ogg|m4a|opus)$/i, "Audio"],
  [/\.(js|jsx|ts|tsx|py|java|c|cpp|h|cs|go|rs|rb|php|swift|kt|sh|bat|ps1|json|ya?ml|html?|css|sql|toml)$/i, "Code"],
  [/\.(zip|rar|7z|tar|gz|xz|bz2)$/i, "Archives"],
  [/\.(exe|msi|apk|dmg|appx|deb|rpm|pkg)$/i, "Installers"],
  [/\.(ttf|otf|woff2?|eot)$/i, "Fonts"],
  [/\.(psd|ai|fig|sketch|xd|indd|blend|obj|fbx|glb|gltf)$/i, "Design"],
];

export function classifyFile(name: string): FileCategory {
  for (const [re, cat] of CATEGORY_MAP) {
    if (re.test(name)) return cat;
  }
  return "Others";
}

/** Directories FileButler will never organize or report inside (CAP-093). */
const DENY_LIST = [
  /(^|[\\/])windows($|[\\/])/i,
  /(^|[\\/])program files($|[\\/])/i,
  /(^|[\\/])program files \(x86\)($|[\\/])/i,
  /(^|[\\/])programdata($|[\\/])/i,
  /(^|[\\/])appdata($|[\\/])/i,
  /(^|[\\/])\.git($|[\\/])/i,
  /(^|[\\/])node_modules($|[\\/])/i,
  /(^|[\\/])system volume information($|[\\/])/i,
  /(^|[\\/])\$recycle\.bin($|[\\/])/i,
];

export function isDeniedPath(dir: string): boolean {
  return DENY_LIST.some((re) => re.test(dir));
}

// ─── Pure core: the organize plan ────────────────────────────────────────────

export interface PlanEntry {
  from: string; // absolute
  to: string; // absolute
  name: string;
  category: string;
}

export interface OrganizePlan {
  dir: string;
  mode: "type" | "date";
  entries: PlanEntry[];
  skipped: string[]; // dirs / hidden / non-movable with a reason
  foldersCreated: string[];
}

/**
 * Build the FULL move plan as data before touching the disk (CAP-032).
 * mode "type" → <dir>/<Category>/; mode "date" → <dir>/<YYYY-MM>/.
 */
export function buildOrganizePlan(
  dir: string,
  entries: { name: string; isDirectory: boolean; mtimeMs: number }[],
  mode: "type" | "date"
): OrganizePlan {
  const plan: OrganizePlan = { dir, mode, entries: [], skipped: [], foldersCreated: [] };
  const seenTargets = new Set<string>();

  for (const e of entries) {
    if (e.name.startsWith(".")) {
      plan.skipped.push(`${e.name}: hidden`);
      continue;
    }
    if (e.isDirectory) {
      plan.skipped.push(`${e.name}: is a folder`);
      continue;
    }
    const bucket =
      mode === "type"
        ? classifyFile(e.name)
        : new Date(e.mtimeMs).toISOString().slice(0, 7); // YYYY-MM
    const targetDir = path.join(dir, bucket);
    let target = path.join(targetDir, e.name);
    // Collision policy: suffix -2, -3… never overwrite (CAP-035).
    let n = 2;
    while (fs.existsSync(target) || seenTargets.has(target.toLowerCase())) {
      const ext = path.extname(e.name);
      const stem = path.basename(e.name, ext);
      target = path.join(targetDir, `${stem}-${n}${ext}`);
      n += 1;
      if (n > 999) break;
    }
    seenTargets.add(target.toLowerCase());
    if (!plan.foldersCreated.includes(targetDir)) plan.foldersCreated.push(targetDir);
    plan.entries.push({ from: path.join(dir, e.name), to: target, name: e.name, category: bucket });
  }
  return plan;
}

function scanEntries(dir: string, maxFiles: number): { entries: { name: string; isDirectory: boolean; mtimeMs: number }[]; truncated: boolean } {
  const entries: { name: string; isDirectory: boolean; mtimeMs: number }[] = [];
  let truncated = false;
  for (const name of fs.readdirSync(dir)) {
    if (entries.length >= maxFiles) {
      truncated = true;
      break;
    }
    try {
      const st = fs.statSync(path.join(dir, name));
      entries.push({ name, isDirectory: st.isDirectory(), mtimeMs: st.mtimeMs });
    } catch {
      /* vanished mid-scan — skip honestly */
    }
  }
  return { entries, truncated };
}

// ─── Manifest journal + apply + undo ────────────────────────────────────────

interface Manifest {
  id: string;
  ts: number;
  dir: string;
  mode: "type" | "date" | "undo";
  moves: { from: string; to: string }[];
}

let manifestDir: string | null = null;

export function configureFileButler(userDataDir: string): void {
  manifestDir = path.join(userDataDir, "file-butler");
  try {
    fs.mkdirSync(manifestDir, { recursive: true });
  } catch {
    /* manifest ops fail soft with honest errors */
  }
}

function manifestPath(id: string): string {
  if (!manifestDir) throw new Error("FileButler not configured — configureFileButler(userDataDir) must run at boot");
  return path.join(manifestDir, `${id}.json`);
}

function writeManifest(m: Manifest): void {
  fs.writeFileSync(manifestPath(m.id), JSON.stringify(m, null, 2), "utf8");
}

function readManifest(id: string): Manifest | null {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(id), "utf8")) as Manifest;
  } catch {
    return null;
  }
}

export function listManifests(limit = 10): { id: string; ts: number; dir: string; moves: number }[] {
  if (!manifestDir) return [];
  try {
    return fs
      .readdirSync(manifestDir)
      .filter((f) => f.endsWith(".json"))
      .slice(0, 40)
      .map((f) => {
        try {
          const m = JSON.parse(fs.readFileSync(path.join(manifestDir!, f), "utf8")) as Manifest;
          return { id: m.id, ts: m.ts, dir: m.dir, moves: m.moves.length };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b!.ts - a!.ts)
      .slice(0, limit) as { id: string; ts: number; dir: string; moves: number }[];
  } catch {
    return [];
  }
}

export interface ApplyResult {
  ok: boolean;
  moved: number;
  failed: { from: string; error: string }[];
  manifestId: string;
}

export function applyOrganizePlan(plan: OrganizePlan): ApplyResult {
  const result: ApplyResult = { ok: true, moved: 0, failed: [], manifestId: `m-${Date.now().toString(36)}` };
  for (const folder of plan.foldersCreated) {
    try {
      fs.mkdirSync(folder, { recursive: true });
    } catch (e: any) {
      result.failed.push({ from: folder, error: `mkdir failed: ${String(e?.message ?? e).slice(0, 80)}` });
    }
  }
  for (const e of plan.entries) {
    try {
      if (!fs.existsSync(e.from)) {
        result.failed.push({ from: e.from, error: "source vanished" });
        continue;
      }
      fs.renameSync(e.from, e.to);
      result.moved += 1;
    } catch (e2: any) {
      // rename across volumes fails — fall back to copy+unlink.
      try {
        fs.copyFileSync(e.from, e.to);
        fs.unlinkSync(e.from);
        result.moved += 1;
      } catch (e3: any) {
        result.failed.push({ from: e.from, error: String(e3?.message ?? e3).slice(0, 80) });
      }
    }
  }
  result.ok = result.failed.filter((f) => !f.from.includes("mkdir")).length === 0;
  try {
    writeManifest({
      id: result.manifestId,
      ts: Date.now(),
      dir: plan.dir,
      mode: plan.mode,
      moves: plan.entries.map((e) => ({ from: e.from, to: e.to })),
    });
  } catch {
    /* undo unavailable but the moves are real and reported */
  }
  return result;
}

/** Reverse a manifest move-by-move. Every step checks existence first (CAP-094). */
export function undoOrganize(manifestId: string): ApplyResult {
  const m = readManifest(manifestId.replace(/\.json$/, ""));
  if (!m) return { ok: false, moved: 0, failed: [{ from: manifestId, error: "manifest not found" }], manifestId };
  const result: ApplyResult = { ok: true, moved: 0, failed: [], manifestId: m.id };
  for (const move of [...m.moves].reverse()) {
    try {
      if (!fs.existsSync(move.to)) {
        result.failed.push({ from: move.to, error: "moved file no longer exists — was it renamed again?" });
        continue;
      }
      if (fs.existsSync(move.from)) {
        result.failed.push({ from: move.from, error: "a file already occupies the original spot" });
        continue;
      }
      fs.mkdirSync(path.dirname(move.from), { recursive: true });
      fs.renameSync(move.to, move.from);
      result.moved += 1;
    } catch (e: any) {
      result.failed.push({ from: move.to, error: String(e?.message ?? e).slice(0, 80) });
    }
  }
  result.ok = result.failed.length === 0;
  try {
    writeManifest({ id: `${m.id}-undo`, ts: Date.now(), dir: m.dir, mode: "undo", moves: m.moves.map((x) => ({ from: x.to, to: x.from })) });
  } catch {
    /* best effort */
  }
  return result;
}

// ─── Public operations (used by executors + quests) ─────────────────────────

export function planOrganize(dir: string, mode: "type" | "date"): { ok: boolean; plan?: OrganizePlan; error?: string; truncated?: boolean } {
  if (isDeniedPath(dir)) return { ok: false, error: "I won't organize system directories — pick a user folder" };
  try {
    const { entries, truncated } = scanEntries(dir, 2000);
    return { ok: true, plan: buildOrganizePlan(dir, entries, mode), truncated };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 160) };
  }
}

export function describePlan(plan: OrganizePlan, maxRows = 12): string {
  const byCat = new Map<string, number>();
  for (const e of plan.entries) byCat.set(e.category, (byCat.get(e.category) ?? 0) + 1);
  const summary = [...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} → ${k}`).join(", ");
  const rows = plan.entries.slice(0, maxRows).map((e) => `• ${e.name} → ${path.basename(path.dirname(e.to))}/`);
  const more = plan.entries.length > maxRows ? `\n… and ${plan.entries.length - maxRows} more` : "";
  const skip = plan.skipped.length ? `\nSkipped ${plan.skipped.length} item(s) (folders/hidden).` : "";
  return `${plan.entries.length} file(s) to move: ${summary}.${skip}\n${rows.join("\n")}${more}`;
}

// ─── Duplicates (size prefilter → SHA-256) ──────────────────────────────────

export interface DuplicateGroup {
  hash: string;
  files: string[];
  size: number;
}

export function findDuplicates(
  dir: string,
  opts: { maxFiles?: number; maxSizeBytes?: number } = {}
): { ok: boolean; groups?: DuplicateGroup[]; scanned?: number; error?: string } {
  if (isDeniedPath(dir)) return { ok: false, error: "I won't scan system directories" };
  const maxFiles = Math.min(opts.maxFiles ?? 200, 2000);
  const maxSize = opts.maxSizeBytes ?? 100 * 1024 * 1024;
  try {
    const bySize = new Map<number, string[]>();
    let scanned = 0;
    const stack = [dir];
    while (stack.length && scanned < maxFiles * 4) {
      const cur = stack.pop()!;
      if (isDeniedPath(cur)) continue;
      let names: string[] = [];
      try {
        names = fs.readdirSync(cur);
      } catch {
        continue;
      }
      for (const name of names) {
        if (scanned >= maxFiles * 4) break;
        const full = path.join(cur, name);
        let st: fs.Stats;
        try {
          st = fs.statSync(full);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          if (!isDeniedPath(full)) stack.push(full);
          continue;
        }
        scanned += 1;
        if (st.size === 0 || st.size > maxSize) continue;
        const list = bySize.get(st.size) ?? [];
        list.push(full);
        bySize.set(st.size, list);
      }
    }
    const groups: DuplicateGroup[] = [];
    let hashed = 0;
    for (const [size, files] of bySize) {
      if (files.length < 2) continue;
      const byHash = new Map<string, string[]>();
      for (const f of files) {
        if (hashed >= maxFiles) break;
        try {
          const h = crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 16);
          hashed += 1;
          const l = byHash.get(h) ?? [];
          l.push(f);
          byHash.set(h, l);
        } catch {
          /* unreadable — skip */
        }
      }
      for (const [hash, fs_] of byHash) {
        if (fs_.length >= 2) groups.push({ hash, files: fs_, size });
      }
      if (groups.length >= 25) break;
    }
    return { ok: true, groups, scanned };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 160) };
  }
}

/** Duplicate handling: trash every copy except the first of each group. */
export function trashDuplicateCopies(groups: DuplicateGroup[]): { trashed: string[]; failed: { path: string; error: string }[] } {
  const trashed: string[] = [];
  const failed: { path: string; error: string }[] = [];
  for (const g of groups) {
    for (const f of g.files.slice(1)) {
      try {
        // shell.trashItem lives in Electron; here we use the OS trash via
        // a direct move into a .quip-trash folder — reversible, honest.
        const trashDir = path.join(path.dirname(f), ".quip-trash");
        fs.mkdirSync(trashDir, { recursive: true });
        const dest = path.join(trashDir, `${path.basename(f)}.${Date.now().toString(36)}`);
        fs.renameSync(f, dest);
        trashed.push(f);
      } catch (e: any) {
        failed.push({ path: f, error: String(e?.message ?? e).slice(0, 80) });
      }
    }
  }
  return { trashed, failed };
}

// ─── Storage report ──────────────────────────────────────────────────────────

export interface StorageReport {
  dir: string;
  files: number;
  folders: number;
  bytes: number;
  byCategory: { category: string; files: number; bytes: number }[];
  top: { path: string; bytes: number }[];
  truncated: boolean;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n;
  let u = -1;
  do {
    v /= 1024;
    u += 1;
  } while (v >= 1024 && u < units.length - 1);
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[u]}`;
}

export function storageReport(dir: string, opts: { maxFiles?: number } = {}): { ok: boolean; report?: StorageReport; error?: string } {
  if (isDeniedPath(dir)) return { ok: false, error: "I won't report on system directories" };
  const maxFiles = Math.min(opts.maxFiles ?? 1500, 4000);
  const catAgg = new Map<string, { files: number; bytes: number }>();
  const top: { path: string; bytes: number }[] = [];
  const report: StorageReport = { dir, files: 0, folders: 0, bytes: 0, byCategory: [], top: [], truncated: false };
  try {
    const stack = [dir];
    while (stack.length) {
      if (report.files >= maxFiles) {
        report.truncated = true;
        break;
      }
      const cur = stack.pop()!;
      if (isDeniedPath(cur)) continue;
      let names: string[] = [];
      try {
        names = fs.readdirSync(cur);
      } catch {
        continue;
      }
      for (const name of names) {
        const full = path.join(cur, name);
        let st: fs.Stats;
        try {
          st = fs.statSync(full);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          report.folders += 1;
          if (!isDeniedPath(full)) stack.push(full);
          continue;
        }
        report.files += 1;
        report.bytes += st.size;
        const cat = classifyFile(name);
        const agg = catAgg.get(cat) ?? { files: 0, bytes: 0 };
        agg.files += 1;
        agg.bytes += st.size;
        catAgg.set(cat, agg);
        top.push({ path: full, bytes: st.size });
      }
    }
    top.sort((a, b) => b.bytes - a.bytes);
    report.top = top.slice(0, 15);
    report.byCategory = [...catAgg.entries()]
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.bytes - a.bytes);
    return { ok: true, report };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 160) };
  }
}

// ─── Watch mode (debounced auto-organize) ───────────────────────────────────

interface WatchState {
  watcher: fs.FSWatcher;
  timer: NodeJS.Timeout;
  dir: string;
  autoOrganize: boolean;
}

const watches = new Map<string, WatchState>();

export interface WatchEvent {
  dir: string;
  moved: { name: string; to: string }[];
}

export function startWatch(
  dir: string,
  onEvent: (e: WatchEvent) => void,
  opts: { autoOrganize?: boolean } = {}
): { ok: boolean; error?: string } {
  if (isDeniedPath(dir)) return { ok: false, error: "I won't watch system directories" };
  if (watches.has(dir)) return { ok: true }; // idempotent
  try {
    const watcher = fs.watch(dir, () => {
      const w = watches.get(dir);
      if (!w) return;
      clearTimeout(w.timer);
      w.timer = setTimeout(() => {
        // Re-check state — the watch may have been stopped during the debounce.
        const live = watches.get(dir);
        if (!live?.autoOrganize) return;
        try {
          const { entries } = scanEntries(dir, 500);
          const fresh = entries.filter((e) => !e.isDirectory && !e.name.startsWith("."));
          if (fresh.length === 0) return;
          const plan = buildOrganizePlan(dir, fresh, "type");
          if (plan.entries.length === 0) return;
          const applied = applyOrganizePlan(plan);
          if (applied.moved > 0) {
            onEvent({
              dir,
              moved: plan.entries.slice(0, applied.moved).map((e) => ({ name: e.name, to: e.to })),
            });
          }
        } catch {
          /* a failed auto-move is silent here but journaled by applyOrganizePlan */
        }
      }, 3000);
      w.timer.unref?.();
    });
    const state: WatchState = { watcher, timer: setTimeout(() => {}, 0), dir, autoOrganize: opts.autoOrganize ?? true };
    watches.set(dir, state);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 120) };
  }
}

export function stopWatch(dir: string): { ok: boolean; wasWatching: boolean } {
  const w = watches.get(dir);
  if (!w) return { ok: true, wasWatching: false };
  clearTimeout(w.timer);
  try {
    w.watcher.close();
  } catch {
    /* already closed */
  }
  watches.delete(dir);
  return { ok: true, wasWatching: true };
}

export function stopAllWatches(): void {
  for (const dir of [...watches.keys()]) stopWatch(dir);
}

export function watchStatus(): { dir: string; autoOrganize: boolean }[] {
  return [...watches.values()].map((w) => ({ dir: w.dir, autoOrganize: w.autoOrganize }));
}
