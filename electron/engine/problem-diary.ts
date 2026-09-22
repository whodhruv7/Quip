// Quip Problem Diary — the memory of everything that went wrong
// ─────────────────────────────────────────────────────────────────────────────
// Every failed task, tool, quest and chat error lands here automatically.
// The user opens Settings → Problems, sees exactly what failed and why, taps
// "Export" to get a readable Markdown file on the Desktop and can paste it
// back to the developer ("mai teko bata sku kya problem hai").
//
// Design rules (mirrors Contacts Book / FileButler):
//  • Pure core (dedupe key, severity, markdown) is unit-tested without fs.
//  • Store is a bounded local JSON file at userData — nothing phones home.
//  • noteProblem() NEVER throws: a broken diary must not break a task that
//    is already failing. It fails soft, always.
//  • Dedupe: same source+title → occurrences++, lastSeen refreshed. A problem
//    the user already marked resolved reopens (occurrences continue) so
//    "it came back" is visible truth, not a silent new row.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";

const CAP = 500; // CAP-081-style bound — resolved entries evict first

let baseDir: string | null = null;
let meta: { appVersion?: string } = {};

export function configureProblemDiary(userDataDir: string): void {
  baseDir = path.join(userDataDir, "problems");
  try {
    fs.mkdirSync(baseDir, { recursive: true });
  } catch {
    /* read paths still fail soft */
  }
}

export function setProblemDiaryMeta(m: { appVersion?: string }): void {
  meta = { ...meta, ...m };
}

function storePath(): string {
  if (!baseDir) return null as unknown as string;
  return path.join(baseDir, "diary.json");
}

// ─── Model ───────────────────────────────────────────────────────────────────

export type ProblemSource =
  | "quest" | "tool" | "chat" | "mail" | "ghost" | "file" | "routine" | "watch" | "startup" | "manual";

export type ProblemSeverity = "low" | "medium" | "high";

export interface ProblemEntry {
  id: string;
  /** Dedupe key — source + normalized title. */
  key: string;
  source: ProblemSource;
  /** Machine-friendly failure kind ("executor-error", "smtp-auth", "no-key"…). */
  kind: string;
  severity: ProblemSeverity;
  title: string;
  detail: string;
  /** Evidence lines (selectors used, server replies, paths touched) — digested, never secrets. */
  evidence?: string[];
  status: "open" | "resolved";
  firstSeen: number;
  lastSeen: number;
  resolvedAt?: number;
  occurrences: number;
  /** How many times this came back after the user resolved it. */
  reopenCount: number;
  appVersion?: string;
}

export interface ProblemInput {
  source: ProblemSource;
  title: string;
  detail?: string;
  kind?: string;
  severity?: ProblemSeverity;
  evidence?: string[];
}

// ─── Pure core (unit-tested) ─────────────────────────────────────────────────

/** Stable dedupe key: lowercase, whitespace-collapsed, truncated title. */
export function problemKey(source: string, title: string): string {
  const norm = String(title ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `${String(source ?? "manual").toLowerCase()}::${norm}`;
}

const HIGH_PAT = /(auth|password|permission|access denied|unauthorized|forbidden|vault|401|403)/i;
const MED_PAT = /(timeout|network|rate.?limit|5\d\d|connect|refused|dns|proxy|blocked|fail)/i;

/** Auto-severity from the failure text when the caller didn't pin one. */
export function classifySeverity(kind?: string, detail?: string): ProblemSeverity {
  const hay = `${kind ?? ""} ${detail ?? ""}`;
  if (HIGH_PAT.test(hay)) return "high";
  if (MED_PAT.test(hay)) return "medium";
  return "low";
}

/** Clamp every user-facing string — a runaway error must not eat the disk. */
export function clampEntry(input: ProblemInput, now: number): Pick<ProblemEntry, "title" | "detail" | "kind" | "evidence" | "severity"> {
  const title = String(input.title ?? "unknown problem").slice(0, 160);
  return {
    title,
    detail: String(input.detail ?? "").slice(0, 1000),
    kind: String(input.kind ?? guessKind(input.source, title)).slice(0, 60),
    evidence: (input.evidence ?? []).slice(0, 10).map((e) => String(e).slice(0, 200)),
    severity: input.severity ?? classifySeverity(input.kind ?? title, input.detail ?? title),
  };
}

function guessKind(source: string, title: string): string {
  const t = title.toLowerCase();
  if (source === "chat") return /no.?key/.test(t) ? "no-key" : /network|timeout/.test(t) ? "network" : "chat-error";
  if (source === "mail") return /auth/.test(t) ? "smtp-auth" : /5\d\d/.test(t) ? "smtp-5xx" : "smtp-error";
  if (source === "ghost") return /blocked/.test(t) ? "ghost-blocked" : "ghost-error";
  if (source === "quest") return "quest-step-failed";
  if (source === "tool") return "executor-failed";
  return "problem";
}

/** Pure merge rule: repeat problem → bump counters, refresh, keep first-seen. */
export function mergeRepeat(existing: ProblemEntry, incoming: ProblemInput, now: number): ProblemEntry {
  const c = clampEntry(incoming, now);
  const wasResolved = existing.status === "resolved";
  return {
    ...existing,
    ...c,
    status: "open",
    lastSeen: now,
    resolvedAt: undefined,
    occurrences: existing.occurrences + 1,
    reopenCount: wasResolved ? existing.reopenCount + 1 : existing.reopenCount,
  };
}

/** Eviction rule when the diary is full: resolved first, then oldest lastSeen. */
export function evictOrder(entries: ProblemEntry[]): ProblemEntry[] {
  return entries
    .slice()
    .sort((a, b) => {
      const ar = a.status === "resolved" ? 1 : 0;
      const br = b.status === "resolved" ? 1 : 0;
      if (ar !== br) return br - ar; // resolved go to the front (evicted first)
      return a.lastSeen - b.lastSeen;
    });
}

// ─── Markdown export (the file the user downloads and shares) ────────────────

export function toMarkdown(entries: ProblemEntry[], opts?: { appVersion?: string }): string {
  const lines: string[] = [];
  const at = new Date().toISOString();
  lines.push(`# Quip — Problem Diary export`);
  lines.push("");
  lines.push(`- Exported: ${at}`);
  if (opts?.appVersion) lines.push(`- Quip build: ${opts.appVersion}`);
  const open = entries.filter((e) => e.status === "open");
  const resolved = entries.filter((e) => e.status === "resolved");
  lines.push(`- Open problems: ${open.length} · Resolved: ${resolved.length}`);
  lines.push("");
  if (entries.length === 0) {
    lines.push("No problems recorded — everything Quip attempted verified successfully.");
    return lines.join("\n");
  }
  const order: Record<ProblemSeverity, number> = { high: 0, medium: 1, low: 2 };
  const sorted = entries.slice().sort((a, b) => order[a.severity] - order[b.severity] || b.lastSeen - a.lastSeen);
  for (const e of sorted) {
    lines.push(`## [${e.status.toUpperCase()}] ${e.title}`);
    lines.push("");
    lines.push(`- **Severity:** ${e.severity} · **Source:** ${e.source} · **Kind:** ${e.kind}`);
    lines.push(`- **Happened:** ${e.occurrences}× (first ${new Date(e.firstSeen).toISOString()}${e.reopenCount > 0 ? `, reopened ${e.reopenCount}×` : ""}) · last ${new Date(e.lastSeen).toISOString()}`);
    if (e.detail) {
      lines.push("");
      lines.push("```text");
      lines.push(e.detail);
      lines.push("```");
    }
    if (e.evidence && e.evidence.length > 0) {
      lines.push("");
      lines.push("**Evidence:**");
      for (const ev of e.evidence) lines.push(`- ${ev}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ─── Store ops ───────────────────────────────────────────────────────────────

function configured(): boolean {
  return baseDir !== null;
}

function load(): ProblemEntry[] {
  if (!configured()) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), "utf8"));
    if (Array.isArray(parsed)) return parsed.slice(0, CAP);
  } catch {
    /* fresh diary */
  }
  return [];
}

function save(list: ProblemEntry[]): void {
  if (!configured()) return;
  const tmp = `${storePath()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list.slice(0, CAP), null, 2), "utf8");
  fs.renameSync(tmp, storePath());
}

export type ProblemChangedSink = () => void;
let changedSink: ProblemChangedSink | null = null;

/** main.ts subscribes so open Settings views refresh live. */
export function setProblemChangedSink(fn: ProblemChangedSink | null): void {
  changedSink = fn;
}

function notifyChanged(): void {
  try {
    changedSink?.();
  } catch {
    /* a broken sink must never break the recorder */
  }
}

/**
 * Record a problem. NEVER throws — call sites are already on failure paths.
 * Returns the entry (or null when the diary isn't configured / write failed).
 */
export function noteProblem(input: ProblemInput): ProblemEntry | null {
  try {
    if (!configured()) return null;
    const now = Date.now();
    const key = problemKey(input.source, input.title);
    const list = load();
    const idx = list.findIndex((e) => e.key === key);
    let entry: ProblemEntry;
    if (idx >= 0) {
      entry = mergeRepeat(list[idx], input, now);
      list[idx] = entry;
    } else {
      const c = clampEntry(input, now);
      if (list.length >= CAP) {
        // evictOrder puts eviction candidates (resolved, then oldest) at the
        // FRONT — drop from the front, keep the tail.
        const kept = evictOrder(list).slice(-(CAP - 1));
        list.length = 0;
        list.push(...kept);
      }
      entry = {
        id: `p-${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        key,
        source: input.source,
        ...c,
        status: "open",
        firstSeen: now,
        lastSeen: now,
        occurrences: 1,
        reopenCount: 0,
        appVersion: meta.appVersion,
      };
      list.push(entry);
    }
    save(list);
    notifyChanged();
    return entry;
  } catch {
    return null;
  }
}

export interface ListOpts {
  status?: "open" | "resolved" | "all";
  source?: ProblemSource | "all";
  limit?: number;
}

export function listProblems(opts?: ListOpts): ProblemEntry[] {
  const { status = "all", source = "all", limit = 200 } = opts ?? {};
  let list = load();
  if (status !== "all") list = list.filter((e) => e.status === status);
  if (source !== "all") list = list.filter((e) => e.source === source);
  return list
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, limit);
}

export function getProblem(id: string): ProblemEntry | null {
  return load().find((e) => e.id === id || e.key === id) ?? null;
}

export function resolveProblem(id: string): { ok: boolean; error?: string } {
  try {
    const list = load();
    const idx = list.findIndex((e) => e.id === id || e.key === id);
    if (idx === -1) return { ok: false, error: `no problem "${id}"` };
    list[idx] = { ...list[idx], status: "resolved", resolvedAt: Date.now() };
    save(list);
    notifyChanged();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 160) };
  }
}

export function clearResolved(): { ok: boolean; removed: number } {
  try {
    const list = load();
    const kept = list.filter((e) => e.status !== "resolved");
    save(kept);
    notifyChanged();
    return { ok: true, removed: list.length - kept.length };
  } catch {
    return { ok: false, removed: 0 };
  }
}

export function clearAllProblems(): { ok: boolean; removed: number } {
  try {
    const list = load();
    save([]);
    notifyChanged();
    return { ok: true, removed: list.length };
  } catch {
    return { ok: false, removed: 0 };
  }
}

export function problemStats(): { open: number; resolved: number; high: number; total: number } {
  const list = load();
  return {
    open: list.filter((e) => e.status === "open").length,
    resolved: list.filter((e) => e.status === "resolved").length,
    high: list.filter((e) => e.severity === "high" && e.status === "open").length,
    total: list.length,
  };
}

/** Write the human-readable Markdown report. Defaults to the Desktop. */
export function exportProblemsMarkdown(filePath?: string): { ok: boolean; path?: string; count?: number; error?: string } {
  try {
    const list = load();
    const target =
      filePath ??
      path.join(
        process.platform === "win32" ? path.join(process.env.USERPROFILE ?? "C:", "Desktop") : path.join(process.env.HOME ?? "/tmp", "Desktop"),
        `quip-problems-${new Date().toISOString().slice(0, 10)}.md`
      );
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const md = toMarkdown(list, { appVersion: meta.appVersion });
    fs.writeFileSync(target, md, "utf8");
    return { ok: true, path: target, count: list.length };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 160) };
  }
}
