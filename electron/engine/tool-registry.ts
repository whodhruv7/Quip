// Quip Execution Engine V2 — Tool Registry
// ─────────────────────────────────────────────────────────────────────────────
// One registry routing every action to a real executor + verification:
//   open_app        → app-discovery (installed index, launch, verify process)
//   open_folder/file→ file-discovery (resolve + open + verify)
//   open_website/url→ browser-automation (focused surface, safe-URL gate)
//   play_media      → browser-automation YouTube search → verified watch URL
//   read_page       → Agent-Reach web reader
//   desktop actions → desktop-controller (focus/close/type/key/click/scroll/
//                     drag/clipboard)
//
// Every ToolResult carries verified state — never fake success.
// ─────────────────────────────────────────────────────────────────────────────

import { shell, BrowserWindow, screen } from "electron";
import path from "node:path";
import { app } from "electron";
import { executeTool as legacyExecute } from "./legacy-tools";
import {
  buildInstalledAppIndex,
  getCachedAppIndex,
  resolveApp,
  launchApp,
  invalidateAppIndex as invalidateDiscoveryCache,
  getLastScanDiagnostic,
  scoreAppMatch,
  normalizeAppName,
  type InstalledApp,
} from "./app-discovery";
import { executeDesktopAction } from "./desktop-controller";
import { executeFileOp, searchFiles } from "./file-ops";
import fs from "node:fs";
import { runCapture } from "./action-verifier";
import { resolveLocalTarget, resolveLocalCandidates, openLocalTarget } from "./file-discovery";
import { ghostPerformOpen } from "./ghost-cursor";
import { looksLikeEmail } from "./mailwing";
import type { PendingChoice } from "./context-store";
import {
  openBrowserSurface,
  navigateBrowser,
  playFirstYouTubeResult,
  readWebPage,
} from "./browser-automation";
import { contextStore } from "./context-store";
import type { ActionVerification } from "./action-verifier";
import {
  listProcesses,
  killProcess,
  controlVolume,
  mediaKey,
  browserTabAction,
  type VolumeAction,
  type MediaAction,
  type TabAction,
} from "./system-control";
import { deviceSelfCheck } from "./device-selfcheck";
import { observeScreen, screenClickElement, screenTypeInto } from "./screen-vision";
import { youtubeRead, redditRead, rssRead, githubRead, v2exRead, bilibiliRead, tweetRead } from "./web-reading";
import { weatherRead } from "./weather";
import { createDocument, pdfRead, docxRead, type DocKind } from "./docs-tools";
import { sysInfo, networkInfo } from "./sys-info";
import { speakText } from "../system/speech";
import { modelRouter } from "../system/model-router";
import { execFile } from "node:child_process";
// ── Autonomy wave engines (roadmap A–F) ──
import {
  ghostReadPage,
  ghostExtractContacts,
  ghostClickText,
  ghostFill,
  ghostWaitForText,
  ghostScreenshot,
  lastRememberedContact,
  type GhostField,
} from "./web-ghost";
import {
  upsertAccount,
  removeAccount,
  listAccounts,
  resolveAccount,
  setDefaultAccount,
  otherAccountIdOrLabel,
  testAccount,
  sendMail,
  humanizeEmail,
  gmailComposeUrl,
  readOutbox,
  digestOutboxForLog,
  parseReplyChain,
  buildReplyContext,
  type MailTone,
  type SendMailInput,
} from "./mailwing";
import {
  upsertContact,
  searchContacts,
  listContacts,
  exportContactsCsv,
  resolveEmail,
} from "./contacts-book";
import {
  planOrganize,
  describePlan,
  applyOrganizePlan,
  undoOrganize,
  findDuplicates,
  trashDuplicateCopies,
  storageReport,
  formatBytes,
  startWatch,
  stopWatch,
  watchStatus,
  listManifests,
  type OrganizePlan,
} from "./file-butler";
import {
  screenshotToFile,
  setWallpaper,
  setBrightness,
  getBrightness,
  lockPc,
  batteryStatus,
  notify,
  clipboardHistory,
  proposeInstall,
  snapRect,
} from "./ghost-hands";
import {
  buildQuest,
  runQuest,
  runRoutine,
  saveRoutine,
  listRoutines,
  type RoutineStep,
} from "./quest-engine";
import type { WatchEvent } from "./file-butler";
import {
  noteProblem,
  listProblems,
  resolveProblem,
  clearResolved as diaryClearResolved,
  clearAllProblems,
  problemStats,
  exportProblemsMarkdown,
  type ProblemSource,
} from "./problem-diary";

const TAB_ACTIONS: TabAction[] = [
  "new", "close", "next", "previous", "reopen", "back", "forward", "reload",
];

/** Sink for Downloads-watch auto-moves — main.ts injects a toast bridge. */
let watchEventSink: ((e: WatchEvent) => void) | null = null;
export function setWatchEventSink(sink: ((e: WatchEvent) => void) | null): void {
  watchEventSink = sink;
}

// ─── Shell command execution (Skales computer-use parity, approval-gated) ────

/** Absolute-catastrophe deny list — the approval card is the main gate,
 *  this only stops disk-wipers even if approved by accident. */
const COMMAND_DENY = [
  /rm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+\/(?!home|users)/i,
  /rm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+[a-z]:?\\?\s*$/i,
  /format\s+[a-z]:/i,
  /del\s+\/[fsq][^\n]*c:\\(windows|users)/i,
  /shutdown|restart-computer|stop-computer/i,
  /mkfs/i,
  /:(){ :|:& };:/,
];

async function runShellCommand(command: string): Promise<ToolResult> {
  const cmd = (command ?? "").trim();
  if (!cmd) {
    return { success: false, output: "No command was given.", note: "empty-command" };
  }
  if (COMMAND_DENY.some((re) => re.test(cmd))) {
    return {
      success: false,
      output: "I won't run that command — it looks destructive to system data.",
      note: "deny-listed command",
    };
  }
  const isWin = process.platform === "win32";
  const shell = isWin ? "cmd" : "/bin/sh";
  const args = isWin ? ["/d", "/s", "/c", cmd] : ["-c", cmd];
  try {
    const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>(
      (resolve, reject) => {
        execFile(shell, args, { timeout: 20_000, maxBuffer: 1024 * 1024, windowsHide: true }, (err, so, se) => {
          if (err && !so && !se) reject(err);
          else resolve({ stdout: String(so ?? ""), stderr: String(se ?? "") });
        });
      }
    );
    const out = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
    return {
      success: true,
      output: out ? out.slice(0, 3000) : "(command ran — no output)",
      note: `ran: ${cmd.slice(0, 120)}`,
      evidence: [`shell: ${shell}`, `exit ok`],
    };
  } catch (e: any) {
    const timedOut = e?.killed || e?.signal === "SIGTERM";
    return {
      success: false,
      output: timedOut
        ? "The command took too long (20s) — I stopped it."
        : `The command failed: ${String(e?.message ?? e).slice(0, 300)}`,
      note: `command failed: ${cmd.slice(0, 120)}`,
      evidence: [`shell: ${shell}`],
    };
  }
}

export interface ToolResult {
  success: boolean;
  output: string;
  note: string; // trust layer — what happened and why
  evidence?: string[];
}

export interface ToolContext {
  platform: string;
  /** Current active window (for progress/approval routing). */
  senderWindow?: BrowserWindow;
}

import type { TaskStep } from "./intent-parser-v2";

function fromVerification(v: ActionVerification): ToolResult {
  return { success: v.ok, output: v.summary, note: v.summary, evidence: v.evidence };
}

let appIndexPromise: Promise<InstalledApp[]> | null = null;

async function getAppIndex(): Promise<InstalledApp[]> {
  if (!appIndexPromise) {
    try {
      appIndexPromise = buildInstalledAppIndex(app.getPath("userData"));
    } catch {
      // Headless / test context (no Electron app) — scan without disk cache.
      appIndexPromise = buildInstalledAppIndex("");
    }
  }
  try {
    return await appIndexPromise;
  } catch {
    return getCachedAppIndex() ?? [];
  }
}

/** Allow tests / manual rescan to invalidate the cached app index.
 *  Clears BOTH the registry's in-flight promise and the discovery cache —
 *  one entry point, no stale index can survive a rescan. */
export function invalidateAppIndex(): void {
  appIndexPromise = null;
  invalidateDiscoveryCache();
}

// ─── Executors ───────────────────────────────────────────────────────────────

// ─── Open-with + pending-choice helpers (the follow-up flow) ────────────────

/** Browser aliases for "open X in chrome" — `start <alias> "url"`. */
const BROWSER_START: Record<string, string> = {
  chrome: "chrome",
  edge: "msedge",
  firefox: "firefox",
  brave: "brave",
  opera: "opera",
};

/** Open a file with a specific installed app (`start "" "app.exe" "file"`). */
async function openWithApp(filePath: string, appName: string): Promise<ActionVerification> {
  const apps = await getAppIndex();
  const appEntry = resolveApp(appName, apps);
  if (!appEntry?.executable) {
    return {
      ok: false,
      summary: `I couldn't find an installed app called "${appName}" to open that with.`,
      evidence: ["no installed app matched the open-with request"],
      error: "open-with-app-not-found",
    };
  }
  if (process.platform === "win32") {
    const res = await runCapture(`cmd /c start "" "${appEntry.executable}" "${filePath}"`, 8000);
    if (res === null) {
      return { ok: false, summary: `I couldn't launch ${appEntry.name}.`, evidence: ["start command failed"], error: "open-with-launch-failed" };
    }
  } else {
    try {
      const err = await shell.openPath(filePath); // dev/non-Windows fallback
      if (err) return { ok: false, summary: `I couldn't open the file — ${err}`, evidence: [], error: "open-file-failed" };
    } catch (e: any) {
      return { ok: false, summary: `I couldn't open the file with ${appEntry.name} — ${String(e?.message ?? e).slice(0, 140)}.`, evidence: [], error: "open-file-exception" };
    }
  }
  return { ok: true, summary: `Opened it with ${appEntry.name}.`, evidence: [`launch: ${appEntry.executable}`, `file: ${filePath}`] };
}

/** Open a pending choice (from the follow-up list), optionally with an app.
 *  App-kind picks never reach here (handlePendingOpen launches them via
 *  launchApp) — the guard below is a defensive narrowing. */
async function openPickedTarget(pick: PendingChoice, openWith?: string): Promise<ActionVerification> {
  if (pick.kind === "app") {
    return { ok: false, summary: `App picks launch directly — ask for "${pick.label}" again.`, evidence: ["app kind in openPickedTarget"], error: "wrong-pick-kind" };
  }
  let exists = false;
  try {
    exists = fs.existsSync(pick.path);
  } catch {
    exists = false;
  }
  if (!exists) {
    return { ok: false, summary: `"${pick.label}" isn't on disk anymore.`, evidence: [`path missing: ${pick.path}`], error: "path-missing" };
  }
  try {
    if (openWith) {
      if (pick.kind !== "file") {
        const opened = await openLocalTarget({
          kind: pick.kind === "project" ? "project" : "folder",
          path: pick.path,
          displayName: pick.label,
          confidence: 1,
        });
        return opened.ok
          ? { ok: true, summary: `Opened the folder ${pick.label}. (Folders open in Explorer — "with ${openWith}" applies to files.)`, evidence: opened.evidence }
          : opened;
      }
      return await openWithApp(pick.path, openWith);
    }
    return await openLocalTarget({ kind: pick.kind, path: pick.path, displayName: pick.label, confidence: 1 });
  } catch (e: any) {
    return {
      ok: false,
      summary: `I couldn't open "${pick.label}" — ${String(e?.message ?? e).slice(0, 140)}.`,
      evidence: [`open threw for: ${pick.path}`],
      error: "open-exception",
    };
  }
}

/** Shared pending-choice handler for open_file / open_folder / open_app. */
async function handlePendingOpen(p: Record<string, string>): Promise<ToolResult | null> {
  if (p.fromPending === "cancel") {
    contextStore.update({ pendingChoices: [], pendingQuery: undefined, pendingKind: undefined });
    return { success: true, output: "Okay — I've dropped those options. What's next?", note: "pending choices cleared" };
  }
  if (p.fromPending !== "true") return null;
  const pending = contextStore.get().pendingChoices ?? [];
  let idx = parseInt(p.choice ?? "1", 10);
  if (!Number.isFinite(idx) || idx < 1) idx = 1;
  if (String(p.choice) === "-1") idx = pending.length; // "last one"
  const pick = pending[idx - 1];
  if (!pick) {
    contextStore.update({ pendingChoices: [] });
    return { success: false, output: "That option isn't on the list anymore — tell me the file or folder name again.", note: "stale pending choice" };
  }
  // App picks launch through the installed-app launcher (visible too).
  if (pick.kind === "app") {
    let appPromise: Promise<ActionVerification> | null = null;
    await ghostPerformOpen({
      label: pick.label,
      act: () => {
        appPromise = launchApp({
          name: pick.label,
          executable: pick.path,
          appUserModelId: pick.appUserModelId,
          procName: pick.procName,
          confidence: 1,
        });
      },
    });
    const result = await (appPromise ?? launchApp({
      name: pick.label,
      executable: pick.path,
      appUserModelId: pick.appUserModelId,
      procName: pick.procName,
      confidence: 1,
    }));
    if (result.ok) {
      contextStore.update({ activeApp: pick.label, pendingChoices: [] });
    }
    return fromVerification(result);
  }
  // The pick is VISIBLE too — the cursor performs the open.
  let openPromise: Promise<ActionVerification> | null = null;
  await ghostPerformOpen({ label: pick.label, act: () => { openPromise = openPickedTarget(pick, p.openWith); } });
  const result = await (openPromise ?? openPickedTarget(pick, p.openWith));
  if (result.ok) {
    contextStore.update({ lastOpenedPath: pick.path, pendingChoices: [] });
  }
  return fromVerification(result);
}

/** Ask the user which match to open (the follow-up flow's question). */
function askWhichCandidate(
  query: string,
  candidates: { path: string; name: string; kind: "file" | "folder" }[],
  kind: "file" | "folder" | "any"
): ToolResult {
  const choices: PendingChoice[] = candidates.slice(0, 5).map((c) => ({ label: c.name, path: c.path, kind: c.kind }));
  contextStore.update({ pendingChoices: choices, pendingQuery: query, pendingKind: kind });
  const listed = choices.map((c, i) => `${i + 1}. ${c.label} — ${c.path}`).join("\n");
  return {
    success: true,
    output: `I found ${candidates.length} matches for "${query}":\n${listed}\n\nOpen one? Say "open it", "open the second one", "open it with <app>", or "no".`,
    note: "ambiguous match — following up with the user",
    evidence: [`candidates: ${choices.length}`],
  };
}

const Executors: Record<string, (step: TaskStep, ctx: ToolContext) => Promise<ToolResult>> = {
  async open_app(step, _ctx) {
    const apps = await getAppIndex();
    const query = step.params.query || step.params.appName || step.target;
    let resolved = resolveApp(query, apps);

    // Alias corrections for canonical labels not present in names
    if (!resolved) {
      const aliasMap: Record<string, string> = {
        "visual studio code": "code",
        "file explorer": "explorer",
      };
      const alt = aliasMap[query.toLowerCase()];
      if (alt) resolved = resolveApp(alt, apps);
    }

    if (resolved) {
      // The cursor PERFORMS the launch — visible summon, glide, press+burst
      // while the app actually starts. Fails soft: no overlay → direct run.
      const app = resolved;
      let launchPromise: Promise<ActionVerification> | null = null;
      await ghostPerformOpen({ label: app.name, act: () => { launchPromise = launchApp(app); } });
      const result = await (launchPromise ?? launchApp(app));
      if (result.ok) {
        contextStore.update({ activeApp: app.name });
      }
      return fromVerification(result);
    }

    // Not installed → sensible fallbacks
    const q = query.toLowerCase();
    if (q.includes("whatsapp")) {
      let webPromise: Promise<ActionVerification> | null = null;
      await ghostPerformOpen({ label: "WhatsApp Web", act: () => { webPromise = openBrowserSurface("https://web.whatsapp.com"); } });
      const result = await (webPromise ?? openBrowserSurface("https://web.whatsapp.com"));
      return {
        success: result.ok,
        output: result.ok
          ? "WhatsApp isn't installed as an app, so I opened WhatsApp Web instead."
          : result.summary,
        note: result.ok ? "app missing → web fallback" : result.summary,
        evidence: result.evidence,
      };
    }

    // Honest failure + near-miss offer. If the index is empty because the
    // SCAN broke, say so — "app not found" would be a lie. And NO surprise
    // browser windows: the old fallback opened a Google search page on every
    // miss, which looked like Quip doing the wrong thing.
    const scanIssue = apps.length === 0 ? getLastScanDiagnostic() : null;
    if (scanIssue) {
      return {
        success: false,
        output: `I couldn't check installed apps — the app list failed to load (${scanIssue}). Say "rescan apps" and try again.`,
        note: "app index scan failed",
        evidence: ["app index is empty", scanIssue],
      };
    }

    // Near-misses — ASK instead of failing ("open sheets" should offer Excel,
    // not die). Stored as kind:"app" picks so "yes" / "first" launches it.
    const qNorm = normalizeAppName(query);
    const near: Array<{ app: InstalledApp; score: number }> = [];
    for (const app of apps) {
      const score = scoreAppMatch(qNorm, normalizeAppName(app.name));
      if (score >= 0.3 && score < 0.5) near.push({ app, score });
    }
    near.sort((a, b) => b.score - a.score);
    const top = near.slice(0, 3);
    if (top.length > 0) {
      const choices: PendingChoice[] = top.map((t) => ({
        label: t.app.name,
        path: t.app.executable ?? "",
        kind: "app",
        appUserModelId: t.app.appUserModelId,
        procName: t.app.procName,
      }));
      contextStore.update({ pendingChoices: choices, pendingQuery: query, pendingKind: "any" });
      const listed = choices.map((c, i) => `${i + 1}. ${c.label}`).join("\n");
      return {
        success: true,
        output: `I couldn't find an app called "${query}". Did you mean one of these?\n${listed}\n\nSay "first", "second", or the app's name — or "no" to drop it.`,
        note: "app near-miss — following up with the user",
        evidence: [`candidates: ${choices.length}`],
      };
    }

    return {
      success: false,
      output: `I couldn't find an installed app called "${query}".`,
      note: "app not found in Start Menu, Program Files or Store",
      evidence: ["no Start Menu / Program Files / Store match"],
    };
  },

  async open_website(step, _ctx) {
    // "open youtube in chrome" — launch in THAT browser when asked.
    const browser = String(step.params.browser ?? "").toLowerCase();
    if (browser && BROWSER_START[browser] && process.platform === "win32") {
      const url = String(step.params.url ?? "");
      const res = await runCapture(`cmd /c start ${BROWSER_START[browser]} "${url}"`, 8000);
      if (res !== null) {
        contextStore.update({ activeWebsite: step.target, activeUrl: url });
        return {
          success: true,
          output: `Opened ${step.params.label ?? step.target} in ${browser}.`,
          note: `browser-specific launch: ${browser}`,
          evidence: [`start ${BROWSER_START[browser]} "${url}"`],
        };
      }
      // launch failed → fall through to the default browser, still useful
    }
    const url = String(step.params.url ?? "");
    const label = String(step.params.label ?? step.target ?? "website");
    let surfPromise: Promise<ActionVerification> | null = null;
    await ghostPerformOpen({ label, act: () => { surfPromise = openBrowserSurface(url); } });
    const result = await (surfPromise ?? openBrowserSurface(url));
    if (result.ok) contextStore.update({ activeWebsite: step.target, activeUrl: url });
    return fromVerification(result);
  },

  async open_url(step, _ctx) {
    const url = String(step.params.url ?? "");
    let surfPromise: Promise<ActionVerification> | null = null;
    await ghostPerformOpen({ label: step.params.label || step.target || url, act: () => { surfPromise = openBrowserSurface(url); } });
    const result = await (surfPromise ?? openBrowserSurface(url));
    if (result.ok) contextStore.update({ activeUrl: url });
    return fromVerification(result);
  },

  async search_web(step, _ctx) {
    const url = String(step.params.url ?? "");
    let surfPromise: Promise<ActionVerification> | null = null;
    await ghostPerformOpen({ label: `search "${step.params.query || step.target || ""}"`, act: () => { surfPromise = openBrowserSurface(url); } });
    const result = await (surfPromise ?? openBrowserSurface(url));
    return fromVerification(result);
  },

  async search_youtube(step, _ctx) {
    const url = String(step.params.url ?? "");
    let surfPromise: Promise<ActionVerification> | null = null;
    await ghostPerformOpen({ label: `YouTube "${step.params.query || step.target || ""}"`, act: () => { surfPromise = openBrowserSurface(url); } });
    const result = await (surfPromise ?? openBrowserSurface(url));
    if (result.ok) contextStore.update({ activeWebsite: "youtube", lastMediaQuery: step.params.query });
    return fromVerification(result);
  },

  async play_media(step, _ctx) {
    if (step.params.youtube === "true" || step.target === "youtube") {
      const result = await playFirstYouTubeResult(step.params.query ?? step.target);
      return fromVerification(result);
    }
    // Spotify / other: open the URL
    const result = await openBrowserSurface(step.params.url);
    if (result.ok) contextStore.update({ lastMediaQuery: step.params.query });
    return fromVerification(result);
  },

  async open_folder(step, _ctx) {
    // Follow-up answers ("open the second one") land here too.
    const pendingResult = await handlePendingOpen(step.params);
    if (pendingResult) return pendingResult;

    const query = step.params.location || step.params.query || step.target;
    const candidates = await resolveLocalCandidates(query, contextStore.get(), { kind: "folder" });
    if (candidates.length === 0) {
      return {
        success: false,
        output: `I couldn't find a folder called "${step.params.query ?? step.target}".`,
        note: "no matching folder in known locations or project directories",
        evidence: ["known folders + common folders + project roots scanned"],
      };
    }
    const top = candidates[0];
    const runner = candidates[1];
    // Decisive = exact/strong hit (≥90), a clear 20-point lead over the
    // runner-up, or a lone candidate at ≥65. A lone WEAK hit (a fuzzy
    // typo match) is a "did you mean this?" question — never a guess.
    const decisive =
      top.score >= 90 ||
      (runner && top.score - runner.score >= 20 && top.score >= 65) ||
      (candidates.length === 1 && top.score >= 65);
    if (!decisive) {
      return askWhichCandidate(query, candidates, "folder");
    }
    let openPromise: Promise<ActionVerification> | null = null;
    const folderTarget = { kind: "folder" as const, path: top.path, displayName: top.name, confidence: top.score / 100 };
    await ghostPerformOpen({ label: top.name, act: () => { openPromise = openLocalTarget(folderTarget); } });
    const result = await (openPromise ?? openLocalTarget(folderTarget));
    if (result.ok) contextStore.update({ lastOpenedPath: top.path });
    return fromVerification(result);
  },

  async open_file(step, _ctx) {
    // Follow-up answers ("open it", "open it with word", "no") ──────────────
    const pendingResult = await handlePendingOpen(step.params);
    if (pendingResult) return pendingResult;

    const query = step.params.query || step.target;
    const kind = step.params.kind === "folder" ? "folder" : "any";
    const candidates = await resolveLocalCandidates(query, contextStore.get(), { kind });
    if (candidates.length === 0) {
      return {
        success: false,
        output: `I searched your Desktop, Documents, Downloads, Pictures and project folders — nothing matches "${query}".`,
        note: "no local match in the bounded scan",
        evidence: ["common folders + project roots + Recent scanned"],
      };
    }
    const top = candidates[0];
    const runner = candidates[1];
    // Same decisive rule as folders — weak lone fuzzy hits ask, not open.
    const decisive =
      top.score >= 90 ||
      (runner && top.score - runner.score >= 20 && top.score >= 65) ||
      (candidates.length === 1 && top.score >= 65);
    if (!decisive) {
      return askWhichCandidate(query, candidates, kind);
    }
    // The open is VISIBLE — the cursor performs it (optionally with an app).
    let openPromise: Promise<ActionVerification> | null = null;
    const label = step.params.openWith ? `${top.name} with ${step.params.openWith}` : top.name;
    await ghostPerformOpen({
      label,
      act: () => { openPromise = openPickedTarget({ label: top.name, path: top.path, kind: top.kind }, step.params.openWith); },
    });
    const result = await (openPromise ?? openPickedTarget({ label: top.name, path: top.path, kind: top.kind }, step.params.openWith));
    if (result.ok) contextStore.update({ lastOpenedPath: top.path });
    return fromVerification(result);
  },

  async focus_app(step, _ctx) {
    return fromVerification(await executeDesktopAction({ type: "focus", target: step.params.target ?? step.target }));
  },

  async close_app(step, _ctx) {
    return fromVerification(await executeDesktopAction({ type: "close", target: step.params.target ?? step.target }));
  },

  async type_text(step, _ctx) {
    return fromVerification(await executeDesktopAction({ type: "type", text: step.params.text ?? "" }));
  },

  async press_key(step, _ctx) {
    const keys = (step.params.keys ?? "").split(",").map((k) => k.trim()).filter(Boolean);
    return fromVerification(await executeDesktopAction({ type: "key", keys }));
  },

  async click(step, _ctx) {
    const variant = step.params.variant as "double" | "right" | undefined;
    // No coordinates → click at the CURRENT cursor position (real, honest).
    const hasCoords = step.params.x !== undefined && step.params.x !== "";
    const x = hasCoords ? parseFloat(step.params.x) : undefined;
    const y = hasCoords ? parseFloat(step.params.y) : undefined;
    if (variant === "double" || variant === "right") {
      return fromVerification(await executeDesktopAction({ type: "click.variant", variant, x, y }));
    }
    return fromVerification(await executeDesktopAction({ type: "click", x, y }));
  },

  async mouse_move(step, _ctx) {
    const x = parseFloat(step.params.x ?? "");
    const y = parseFloat(step.params.y ?? "");
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { success: false, output: "I need coordinates to move the mouse.", note: "missing-coords" };
    }
    return fromVerification(await executeDesktopAction({ type: "mouse.move", x, y }));
  },

  async drag(step, _ctx) {
    const fromX = parseFloat(step.params.fromX ?? "");
    const fromY = parseFloat(step.params.fromY ?? "");
    const toX = parseFloat(step.params.toX ?? "");
    const toY = parseFloat(step.params.toY ?? "");
    if (![fromX, fromY, toX, toY].every(Number.isFinite)) {
      return { success: false, output: "I need a start and an end point to drag.", note: "missing-coords" };
    }
    return fromVerification(
      await executeDesktopAction({ type: "drag", from: { x: fromX, y: fromY }, to: { x: toX, y: toY } })
    );
  },

  async scroll(step, _ctx) {
    return fromVerification(await executeDesktopAction({
      type: "scroll",
      deltaY: parseFloat(step.params.deltaY ?? "-360"),
    }));
  },

  async clipboard(step, _ctx) {
    if (step.params.mode === "write" && step.params.text) {
      return fromVerification(await executeDesktopAction({ type: "clipboard.write", text: step.params.text }));
    }
    return fromVerification(await executeDesktopAction({ type: "clipboard.read" }));
  },

  async read_page(step, _ctx) {
    const verification = await readWebPage(step.params.url);
    // Remember the text so "summarize that" works right after.
    if (verification.ok && verification.summary.length > 100) {
      contextStore.update({ lastReadPage: verification.summary.slice(0, 20_000) });
    }
    return fromVerification(verification);
  },

  async window_control(step, _ctx) {
    const op = (step.params.op ?? "minimize") as "minimize" | "maximize" | "restore";
    if (step.params.op === "move") {
      return fromVerification(await executeDesktopAction({
        type: "window.move",
        target: step.params.target ?? step.target,
        x: parseFloat(step.params.x ?? "0"),
        y: parseFloat(step.params.y ?? "0"),
      }));
    }
    if (step.params.op === "resize") {
      return fromVerification(await executeDesktopAction({
        type: "window.resize",
        target: step.params.target ?? step.target,
        width: parseFloat(step.params.width ?? "1000"),
        height: parseFloat(step.params.height ?? "700"),
      }));
    }
    return fromVerification(await executeDesktopAction({
      type: "window.control",
      op: op === "restore" ? "restore" : op,
      target: step.params.target ?? step.target,
    }));
  },

  // CAP-048: snap presets — "is window ko right side rakho".
  async window_snap(step, _ctx) {
    const preset = (String(step.params.preset ?? step.target ?? "").toLowerCase().trim() || "") as "left" | "right" | "maximize" | "restore";
    if (!["left", "right", "maximize", "restore"].includes(preset)) {
      return { success: false, output: "Which snap? left / right / maximize / restore.", note: "unknown snap preset" };
    }
    const target = step.params.window ?? step.params.target ?? "";
    if (preset === "maximize" || preset === "restore") {
      return fromVerification(await executeDesktopAction({
        type: "window.control",
        op: preset,
        target,
      }));
    }
    // Half-screen snap: workArea → snapRect → move + resize (verified twice).
    let workArea: { x: number; y: number; width: number; height: number } | null = null;
    try {
      const { screen } = await import("electron");
      workArea = screen.getPrimaryDisplay().workArea;
    } catch {
      return { success: false, output: "Screen geometry isn't available right now (running outside the desktop app?).", note: "screen unavailable" };
    }
    if (!workArea) return { success: false, output: "I couldn't read the screen work area.", note: "no workarea" };
    const rect = snapRect(preset, workArea);
    const moved = await executeDesktopAction({ type: "window.move", target, x: rect.x, y: rect.y });
    if (!moved.ok) return fromVerification(moved);
    const resized = await executeDesktopAction({ type: "window.resize", target, width: rect.width, height: rect.height });
    return {
      success: resized.ok,
      output: resized.ok
        ? `Snapped ${target ? `"${target}"` : "the window"} to the ${preset} half (${rect.width}×${rect.height}).`
        : `Moved it, but the resize failed — ${resized.summary}`,
      note: `snap-${preset}`,
      evidence: [`rect: ${rect.x},${rect.y} ${rect.width}×${rect.height}`, moved.evidence?.join("; ") ?? ""],
    };
  },

  async screen(_step, _ctx) {
    return fromVerification(await executeDesktopAction({ type: "screen.capture" }));
  },

  async windows_list(_step, _ctx) {
    return fromVerification(await executeDesktopAction({ type: "windows.list" }));
  },

  async file_op(step, _ctx) {
    const op = step.params.op as string;

    // ── search: local-first file search, optional "open the first hit" ──
    if (op === "search") {
      const query = step.params.query ?? step.params.path ?? "";
      const base = step.params.base;
      const wantContent = String(step.params.content ?? "") === "true";
      const res = searchFiles(query, base, { content: wantContent });
      const contentLines = res.contentHits?.length ?? 0;
      if (res.hits.length === 0 && contentLines === 0) {
        return {
          success: false,
          output: `I couldn't find any file matching "${query}"${wantContent ? " (name or contents)" : ""}.`,
          note: "searched common folders, no hits",
          evidence: ["local search found nothing"],
        };
      }
      // "…and open it" → open the first REAL hit and report honestly.
      if (step.params.openFirst === "true") {
        const first = res.hits[0];
        const opened = await openLocalTarget({
          kind: "file",
          path: first,
          displayName: path.basename(first),
          confidence: 1,
        });
        const others = res.hits.slice(1, 5);
        return {
          success: opened.ok,
          output:
            `Found ${res.hits.length} matching item${res.hits.length > 1 ? "s" : ""}. ` +
            (opened.ok
              ? `Opened the first one: ${first}`
              : `I found "${first}" but couldn't open it — ${opened.summary}`) +
            (others.length ? `\nOther matches:\n${others.map((h) => `• ${h}`).join("\n")}` : ""),
          note: opened.ok ? "file-search: opened first hit" : "file-search: open failed",
          evidence: [`hits: ${res.hits.length}`, opened.ok ? `opened ${first}` : "open failed"],
        };
      }
      // Store the hits as pending choices — "open it" / "open the second
      // one" works right after, per the search → confirm → open flow.
      const searchChoices = res.hits.slice(0, 5).map((h) => ({ label: path.basename(h), path: h, kind: "file" as const }));
      contextStore.update({ pendingChoices: searchChoices, pendingQuery: query, pendingKind: "file" });
      return {
        success: true,
        output:
          `Found ${res.hits.length} matching item${res.hits.length > 1 ? "s" : ""}:\n${res.hits.map((h) => `• ${h}`).join("\n")}` +
          (contentLines ? `\nContents also mention "${query}" in:\n${res.contentHits!.slice(0, 8).map((h) => `• ${h}`).join("\n")}` : "") +
          `\n\nOpen one? Say "open it" or "open the second one" — or "open it with <app>".`,
        note: "file-search: results listed for the follow-up flow",
        evidence: [`searched: ${query}`, wantContent ? `content grep: ${contentLines} hit(s)` : "name-only"],
      };
    }

    // ── everything else: synchronous fs operation with verification ──
    const fileAction = (() => {
      switch (op) {
        case "read":
          return { op: "read", path: step.params.path ?? "" } as const;
        case "write":
        case "append":
          return { op: "write", path: step.params.path ?? "", content: step.params.content ?? "", append: op === "append" } as const;
        case "delete":
          return { op: "delete", path: step.params.path ?? "" } as const;
        case "copy":
          return { op: "copy", from: step.params.from ?? step.params.path ?? "", to: step.params.to ?? "" } as const;
        case "move":
          return { op: "move", from: step.params.from ?? step.params.path ?? "", to: step.params.to ?? "" } as const;
        case "mkdir":
          return { op: "mkdir", path: step.params.path ?? "" } as const;
        case "list":
          return { op: "list", path: step.params.path ?? "" } as const;
        default:
          return null;
      }
    })();
    if (!fileAction) {
      return { success: false, output: `Unknown file operation: ${op}`, note: "unsupported-file-op" };
    }
    return fromVerification(executeFileOp(fileAction as any));
  },

  async site_search(step, _ctx) {
    const site = step.params.site ?? "web";
    const query = step.params.query ?? "";
    const SEARCH_URLS: Record<string, string> = {
      reddit: `https://www.reddit.com/search/?q=${encodeURIComponent(query)}`,
      x: `https://x.com/search?q=${encodeURIComponent(query)}`,
      twitter: `https://x.com/search?q=${encodeURIComponent(query)}`,
      github: `https://github.com/search?q=${encodeURIComponent(query)}&type=repositories`,
      youtube: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
    };
    const searchUrl = SEARCH_URLS[site];
    if (!searchUrl) {
      return { success: false, output: `I don't know how to search ${site}.`, note: "unknown-site" };
    }
    const opened = await openBrowserSurface(searchUrl);
    if (!opened.ok) {
      return fromVerification(opened);
    }
    // Read the results page for an honest summary (best effort — some sites
    // require login; if reading fails the open itself is still real).
    const read = await readWebPage(searchUrl);
    const summary = read.ok && read.summary
      ? `Opened ${site} search for "${query}" — top of the results page:\n${read.summary.slice(0, 1200)}`
      : `Opened ${site} search for "${query}" in the browser.` +
        (read.ok ? "" : " I couldn't read the results page — the site may require login.");
    return {
      success: true,
      output: summary,
      note: "site-search",
      evidence: [`search url: ${searchUrl}`, read.ok ? "results page read" : "results page not readable"],
    };
  },

  async compose_email(step, _ctx) {
    const to = String(step.params.to ?? "").trim();
    const subject = String(step.params.subject ?? "").trim();
    const body = String(step.params.body ?? "").trim();
    // Only a real email address goes into the Gmail compose URL — a name like
    // "dhruv" would silently corrupt the recipient field. mailto: passes
    // through untouched (the parser/agent built it deliberately).
    const rawUrl = String(step.params.url ?? "");
    const url = rawUrl.startsWith("mailto:")
      ? rawUrl
      : gmailComposeUrl({ to: looksLikeEmail(to) ? to : "", subject, body });
    // The compose surface opens VISIBLE — the cursor performs it.
    let surfPromise: Promise<ActionVerification> | null = null;
    await ghostPerformOpen({
      label: to ? `email to ${to}` : "new email",
      act: () => { surfPromise = openBrowserSurface(url); },
    });
    const result = await (surfPromise ?? openBrowserSurface(url));
    if (!result.ok) return fromVerification(result);
    contextStore.update({ activeWebsite: "gmail", activeUrl: url });

    return {
      success: true,
      output: to
        ? looksLikeEmail(to)
          ? `Compose window is open for ${to}${subject ? ` — subject "${subject}"` : ""}${body ? ", body filled" : ""}. Check it and hit Send.`
          : `Compose window is open${subject ? ` with subject "${subject}"` : ""} — but "${to}" isn't an email address. Give me the full address and I'll open it addressed.`
        : `Compose window is open${subject || body ? " with the details filled" : ""}. Tell me the recipient — say "to someone@gmail.com" — and I'll open it addressed.`,
      note: "gmail compose surface opened with details",
      evidence: [...(result.evidence ?? []), `compose url: ${url.slice(0, 120)}`],
    };
  },

  async compose_message(step, _ctx) {
    const result = await openBrowserSurface(step.params.url);
    return fromVerification(result);
  },

  async system_action(step, _ctx) {
    // Settings is safe + verifiable on Windows
    if (step.target === "settings") {
      const verification = await executeDesktopAction({ type: "focus", target: "Settings" })
        .then(async (focusRes) => {
          if (focusRes.ok) return focusRes;
          try {
            await shell.openExternal("ms-settings:");
            return { ok: true, summary: "Opened system settings.", evidence: ["ms-settings: opened"] } as ActionVerification;
          } catch {
            return { ok: false, summary: "I couldn't open Settings.", evidence: [], error: "settings-failed" } as ActionVerification;
          }
        });
      return fromVerification(verification);
    }
    return { success: false, output: `Unsupported system action: ${step.target}`, note: "unsupported" };
  },
  async process_list(_step, _ctx) {
    return fromVerification(await listProcesses());
  },

  async process_kill(step, _ctx) {
    return fromVerification(await killProcess(step.params.target ?? step.target ?? ""));
  },

  async volume(step, _ctx) {
    const action = (step.params.action ?? "set") as VolumeAction;
    const level = action === "set" ? parseFloat(step.params.level ?? "") : undefined;
    return fromVerification(await controlVolume(action, level));
  },

  async media_key(step, _ctx) {
    const action = (step.params.action ?? "playpause") as MediaAction;
    return fromVerification(await mediaKey(action));
  },

  async browser_tab(step, _ctx) {
    const op = (step.params.op ?? "new") as TabAction;
    if (!TAB_ACTIONS.includes(op)) {
      return { success: false, output: `Unknown tab action: ${op}`, note: "unsupported-tab-action" };
    }
    return fromVerification(await browserTabAction(op));
  },

  async self_check(_step, _ctx) {
    return fromVerification(await deviceSelfCheck());
  },

  // ── V3: vision, shell, app index, web reading (Agent-Reach role) ─────────
  async screen_observe(_step, _ctx) {
    return fromVerification(await observeScreen());
  },

  async screen_click_element(step, _ctx) {
    return fromVerification(await screenClickElement(String(step.params.element ?? step.target ?? "")));
  },

  async screen_type_into(step, _ctx) {
    return fromVerification(
      await screenTypeInto(String(step.params.element ?? ""), String(step.params.text ?? ""))
    );
  },

  async run_command(step, _ctx) {
    return runShellCommand(String(step.params.command ?? step.target ?? ""));
  },

  async youtube_read(step, _ctx) {
    const r = await youtubeRead(String(step.params.query_or_url ?? step.target ?? ""));
    return { success: r.ok, output: r.summary, note: r.summary, evidence: r.evidence };
  },

  async reddit_read(step, _ctx) {
    const r = await redditRead(String(step.params.query_or_url ?? step.params.query ?? step.target ?? ""));
    return { success: r.ok, output: r.summary, note: r.summary, evidence: r.evidence };
  },

  async rss_read(step, _ctx) {
    const r = await rssRead(String(step.params.url ?? step.target ?? ""));
    return { success: r.ok, output: r.summary, note: r.summary, evidence: r.evidence };
  },

  async github_read(step, _ctx) {
    const r = await githubRead(String(step.params.query_or_url ?? step.target ?? ""));
    return { success: r.ok, output: r.summary, note: r.summary, evidence: r.evidence };
  },

  async v2ex_read(step, _ctx) {
    const r = await v2exRead(String(step.params.node ?? ""));
    return { success: r.ok, output: r.summary, note: r.summary, evidence: r.evidence };
  },

  async bilibili_read(step, _ctx) {
    const r = await bilibiliRead(String(step.params.query ?? step.target ?? ""));
    return { success: r.ok, output: r.summary, note: r.summary, evidence: r.evidence };
  },

  async tweet_read(step, _ctx) {
    const r = await tweetRead(String(step.params.query_or_url ?? step.target ?? ""));
    return { success: r.ok, output: r.summary, note: r.summary, evidence: r.evidence };
  },

  async weather(step, _ctx) {
    const r = await weatherRead(String(step.params.place ?? step.target ?? ""));
    return { success: r.ok, output: r.summary, note: r.summary, evidence: r.evidence };
  },

  async summarize(step, _ctx) {
    const raw = String(step.params.text ?? "").trim();
    let text = raw;
    if (!text) {
      const last = contextStore.get().lastReadPage;
      if (!last) {
        return { success: false, output: "Give me the text to summarize — or ask me to read a page first.", note: "nothing to summarize" };
      }
      text = last;
    }
    if (text.length < 60) {
      return { success: false, output: "That's too short to need a summary — I'd just be repeating it.", note: "text too short" };
    }
    try {
      const summary = await modelRouter.complete(
        "Summarize the text in 2-4 clear sentences. Keep the key facts, numbers and names. Plain text only.",
        [{ role: "user", content: text.slice(0, 12_000) }],
        25_000
      );
      return { success: true, output: summary.trim(), note: `summarized ${text.length} chars`, evidence: ["llm summary"] };
    } catch (e: any) {
      return { success: false, output: `I couldn't summarize — the AI brain didn't answer (${String(e?.message ?? e).slice(0, 120)}).`, note: "summary failed" };
    }
  },

  async pdf_read(step, _ctx) {
    const r = pdfRead(String(step.params.path ?? step.target ?? ""));
    return { success: r.ok, output: r.summary, note: r.summary, evidence: r.evidence };
  },

  async docx_read(step, _ctx) {
    const r = docxRead(String(step.params.path ?? step.target ?? ""));
    return { success: r.ok, output: r.summary, note: r.summary, evidence: r.evidence };
  },

  async doc_create(step, _ctx) {
    const kind = String(step.params.kind ?? "docx") as DocKind;
    let rows: string[][] | undefined;
    let slides: { title: string; body: string }[] | undefined;
    try {
      if (step.params.rows) rows = JSON.parse(step.params.rows);
    } catch {
      return { success: false, output: "The rows weren't valid JSON — send them as an array of arrays of strings.", note: "bad rows json" };
    }
    try {
      if (step.params.slides) slides = JSON.parse(step.params.slides);
    } catch {
      return { success: false, output: "The slides weren't valid JSON — send them as [{\"title\":…,\"body\":…}]", note: "bad slides json" };
    }
    const r = createDocument(kind, String(step.params.path ?? ""), {
      text: step.params.text,
      rows,
      slides,
    });
    return { success: r.ok, output: r.summary, note: r.summary, evidence: r.evidence };
  },

  async sys_info(_step, _ctx) {
    const r = await sysInfo();
    return { success: r.ok, output: r.summary, note: r.summary, evidence: r.evidence };
  },

  async network_info(_step, _ctx) {
    const r = await networkInfo();
    return { success: r.ok, output: r.summary, note: r.summary, evidence: r.evidence };
  },

  async speak(step, _ctx) {
    const text = String(step.params.text ?? step.target ?? "").trim();
    if (!text) {
      return { success: false, output: "Tell me exactly what to say out loud.", note: "empty speak text" };
    }
    const outcome = await speakText(text);
    if (outcome.ok) {
      return {
        success: true,
        output: `Said it out loud (${outcome.engine === "groq" ? "Groq voice" : "laptop voice"}).`,
        note: outcome.message,
        evidence: ["tts", outcome.engine],
      };
    }
    return {
      success: false,
      output: `I couldn't speak — ${outcome.message}`,
      note: "speak failed",
      evidence: ["tts", outcome.engine],
    };
  },

  async app_list(_step, _ctx) {
    const apps = await getAppIndex();
    if (apps.length === 0) {
      return { success: false, output: "I couldn't scan the installed apps yet.", note: "empty app index" };
    }
    const names = apps.slice(0, 40).map((a) => a.name);
    return {
      success: true,
      output: `${apps.length} apps installed. First ${names.length}:\n${names.map((n) => `• ${n}`).join("\n")}`,
      note: `app index: ${apps.length} entries`,
      evidence: ["cached installed-app index"],
    };
  },

  // ── Autonomy wave (roadmap A–F) ────────────────────────────────────────────

  async web_ghost_read(step, _ctx) {
    const url = String(step.params.url ?? step.target ?? "");
    if (!url) return { success: false, output: "Which page should I read with the ghost browser?", note: "missing url" };
    const r = await ghostReadPage(url);
    if (!r.ok) {
      return { success: false, output: `The ghost browser couldn't read that page — ${r.error}`, note: `ghost-read failed: ${r.error?.slice(0, 120)}` };
    }
    contextStore.update({ activeUrl: url, lastReadPage: r.text?.slice(0, 20_000) });
    return {
      success: true,
      output: `"${r.title}" —\n${(r.text ?? "").slice(0, 8000)}`,
      note: `ghost-read ${url.slice(0, 80)}`,
      evidence: [`ghost session page: ${r.title?.slice(0, 80)}`, `${r.text?.length ?? 0} chars of visible text`],
    };
  },

  async web_ghost_extract(step, _ctx) {
    const url = String(step.params.url ?? step.target ?? "");
    if (!url) return { success: false, output: "Which website should I pull contacts from?", note: "missing url" };
    const r = await ghostExtractContacts(url);
    if (!r.ok) {
      return { success: false, output: `I couldn't pull contacts from that site — ${r.error}`, note: `ghost-extract failed: ${r.error?.slice(0, 120)}` };
    }
    // Auto-save into the Contacts Book with the source (CAP-029).
    let saved = 0;
    for (const c of r.contacts.slice(0, 10)) {
      if (!c.email) continue;
      const res = upsertContact({ email: c.email, name: c.name, source: `ghost:${url.slice(0, 80)}` });
      if (res.ok) saved += 1;
    }
    const list = r.contacts.map((c, i) => `${i + 1}. ${c.email ?? c.phone}${c.name ? ` — ${c.name}` : ""}${c.role ? ` (${c.role.slice(0, 40)})` : ""}`).join("\n");
    if (r.contacts.length === 0) {
      return {
        success: false,
        output: `I opened ${url} but found no email or phone${r.followedContactPage ? " — even their contact page came up empty" : ""}. The site may hide contacts behind a form.`,
        note: "ghost-extract: no contacts",
        evidence: [`page title: ${r.title?.slice(0, 80)}`, r.followedContactPage ? "followed contact page: nothing" : "no contact page detected"],
      };
    }
    contextStore.update({ lastExtractedEmails: r.contacts.filter((c) => c.email).map((c) => c.email!).slice(0, 8).join(", ") });
    return {
      success: true,
      output: `Found ${r.contacts.length} contact(s) on the site${r.followedContactPage ? " (followed their contact page)" : ""}:\n${list}${saved ? `\nSaved ${saved} to your Contacts Book.` : ""}`,
      note: `ghost-extract: ${r.contacts.length} contact(s), ${saved} saved`,
      evidence: [`url: ${url.slice(0, 100)}`, `title: ${r.title?.slice(0, 80)}`, saved ? `contacts book: +${saved}` : "nothing new saved"],
    };
  },

  async web_ghost_click(step, _ctx) {
    const url = String(step.params.url ?? "");
    const text = String(step.params.element ?? step.params.text ?? step.target ?? "");
    if (!url || !text) return { success: false, output: "I need a page URL and what to click (its visible text).", note: "missing url or text" };
    const r = await ghostClickText(url, text);
    if (!r.ok) return { success: false, output: `The ghost click failed — ${r.error}`, note: `ghost-click failed` };
    if (!r.clicked) return { success: false, output: `I couldn't find "${text}" to click on that page — ${r.error ?? "no match"}.`, note: "ghost-click: no match" };
    return { success: true, output: `Clicked "${r.label}" in the ghost page.`, note: "ghost-click", evidence: [`clicked: ${r.label?.slice(0, 60)}`] };
  },

  async web_ghost_fill(step, _ctx) {
    const url = String(step.params.url ?? "");
    const raw = String(step.params.fields ?? "");
    if (!url || !raw) return { success: false, output: "I need a page URL and the fields to fill.", note: "missing url or fields" };
    let fields: GhostField[] = [];
    try {
      const parsed = JSON.parse(raw) as { selector?: string; hint: string; value: string }[];
      fields = parsed.map((f) => ({ selector: f.selector, hint: String(f.hint ?? ""), value: String(f.value ?? "") }));
    } catch {
      return { success: false, output: "The fields weren't valid JSON — send [{\"hint\":\"email\",\"value\":\"a@b.c\"}].", note: "bad fields json" };
    }
    const r = await ghostFill(url, fields);
    if (!r.ok || !r.report) return { success: false, output: `The ghost fill failed — ${r.error}`, note: "ghost-fill failed" };
    const okCount = r.report.filter((x) => x.filled).length;
    const lines = r.report.map((x) => `• ${x.field}: ${x.filled ? "filled" : x.reason ?? "not found"}`).join("\n");
    return {
      success: okCount > 0,
      output: okCount === r.report.length ? `Filled ${okCount} field(s):\n${lines}` : `Filled ${okCount}/${r.report.length}:\n${lines}`,
      note: `ghost-fill ${okCount}/${r.report.length}`,
      evidence: r.report.map((x) => `${x.field}: ${x.filled ? "ok" : x.reason}`),
    };
  },

  // CAP-007: bounded wait so multi-step flows don't race the page.
  async web_ghost_wait(step, _ctx) {
    const text = String(step.params.text ?? step.target ?? "").trim();
    if (!text) return { success: false, output: "What text should I wait for on the page?", note: "missing text" };
    const timeout = Math.min(30_000, Math.max(2_000, parseInt(String(step.params.timeout ?? "10"), 10) * 1000 || 10_000));
    const r = await ghostWaitForText(text.slice(0, 120), timeout);
    return r.found
      ? { success: true, output: `The text "${text}" appeared on the page${r.title ? ` (title: ${r.title})` : ""}.`, note: "ghost wait verified", evidence: [`waited ≤ ${timeout}ms`] }
      : { success: false, output: `The text "${text}" never appeared within ${timeout / 1000}s — the page may still be loading, blocked, or the text may not exist.`, note: "ghost wait timeout" };
  },

  // CAP-008: ghost page → PNG (vision on pages the user never opened).
  async web_ghost_screenshot(step, _ctx) {
    const url = String(step.params.url ?? "");
    if (!url) return { success: false, output: "Which page should I capture? I need a URL.", note: "missing url" };
    const r = await ghostScreenshot(url);
    if (!r.ok) return { success: false, output: `The ghost screenshot failed — ${r.error}`, note: "ghost screenshot failed" };
    return {
      success: true,
      output: `Captured ${url} → ${r.path} (${r.size} bytes).` + (r.title ? ` Page title: "${r.title}".` : ""),
      note: "ghost screenshot saved",
      evidence: [`path: ${r.path}`, `size: ${r.size} bytes`],
    };
  },

  async mailwing_draft(step, _ctx) {
    const rawTo = String(step.params.to ?? step.target ?? "").trim();
    const bodyRaw = String(step.params.body ?? "").trim();
    // CAP-069: "usko mail kar" — pronoun recipients resolve to the last
    // contact Quip extracted (session memory), then the Contacts Book.
    const PRONOUN = /^(usko|unko|unhe|us|un|them|him|her|woh|wo|that person|the same guy|same person)$/i;
    let to = rawTo;
    let resolvedFrom = "";
    if (PRONOUN.test(rawTo)) {
      const remembered = lastRememberedContact();
      if (remembered?.email) {
        to = remembered.email;
        resolvedFrom = ` (the person from your last extraction${remembered.name ? `: ${remembered.name}` : ""})`;
      } else {
        return { success: false, output: `"${rawTo}" — I don't have a recent contact in memory. Extract someone from a site first ("extract emails from <site>") or give me the address.`, note: "no remembered contact" };
      }
    }
    if (!to) {
      return { success: false, output: "Whom should I write to? I need a real email address (or a saved contact's name I can resolve).", note: "missing/invalid recipient" };
    }
    // "send an email to john" → resolve john from the Contacts Book first.
    if (!to.includes("@")) {
      const hit = resolveEmail(to);
      if (hit) {
        to = hit.email;
        resolvedFrom = ` (resolved "${rawTo}" from your Contacts Book)`;
      }
    }
    if (!to.includes("@")) {
      return { success: false, output: `"${rawTo}" isn't an email address and I don't have them in your Contacts Book — give me the full address or save the contact first.`, note: "unresolvable recipient" };
    }
    if (!bodyRaw) return { success: false, output: "What should the email say? Give me the rough points and I'll write it properly.", note: "missing body" };
    const tone = (String(step.params.tone ?? "professional") as MailTone);
    const humanize = String(step.params.humanize ?? "true") !== "false";
    const account = resolveAccount(step.params.account);
    let subject = String(step.params.subject ?? "").trim();
    // CAP-022: Re:/Fwd: subjects are thread continuity — the humanizer keeps
    // the thread tone instead of writing a cold-open letter.
    const chain = parseReplyChain(subject);
    const replyContext = buildReplyContext(chain, subject);
    let body = bodyRaw;
    let humanized = false;
    if (humanize) {
      const res = await humanizeEmail({
        body: bodyRaw,
        tone,
        context: [step.params.context, replyContext].filter(Boolean).join(" ") || undefined,
        languageHint: step.params.language,
        signature: step.params.signature,
      });
      body = res.body;
      subject = subject || res.subject;
      humanized = res.humanized;
    }
    subject = subject || "Message from Quip";
    stagedDraft = { to: to.split(/[,;]\s*/), subject, body, humanized, accountId: account?.label, stagedAt: Date.now() };
    return {
      success: true,
      output:
        `Draft ready${humanized ? " (humanized" + tone + ")" : " (your words as-is)"}:\n` +
        `To: ${to}${resolvedFrom}\nSubject: ${subject}\n---\n${body.slice(0, 700)}${body.length > 700 ? "…" : ""}\n---\n` +
        (account ? `Will send from ${account.fromEmail} — say "send it" to approve.` : `No MailWing account yet — say "send it" and I'll open a prefilled Gmail draft.`),
      note: `mailwing draft staged (${humanized ? "humanized" : "raw"})`,
      evidence: [`tone: ${tone}`, humanized ? "LLM humanize: ok" : "LLM humanize: unavailable — raw text", account ? `account: ${account.label}` : "account: none (Gmail fallback)"],
    };
  },

  async mailwing_send(step, _ctx) {
    const draft = freshDraft();
    if (!draft) {
      return { success: false, output: "There's no staged draft — write one first (whom + what), then I'll send.", note: "no staged draft" };
    }
    const account = resolveAccount(step.params.account ?? draft.accountId);
    if (!account) {
      // Gmail fallback — prefilled compose in the real browser.
      const url = gmailComposeUrl({ to: draft.to.join(","), subject: draft.subject, body: draft.body });
      const opened = await openBrowserSurface(url);
      stagedDraft = null;
      return {
        success: opened.ok,
        output: opened.ok
          ? `Opened a Gmail draft to ${draft.to.join(", ")} with the subject and body prefilled — press send when it looks right.`
          : opened.summary,
        note: opened.ok ? "gmail fallback draft opened" : "gmail fallback failed",
        evidence: opened.evidence,
      };
    }
    const input: SendMailInput = {
      accountId: account.label,
      to: draft.to,
      cc: draft.cc,
      subject: draft.subject,
      body: draft.body,
    };
    const res = await sendMail(input);
    stagedDraft = null;
    return {
      success: res.ok,
      output: res.output,
      note: res.ok ? "mailwing send verified (SMTP 250)" : `mailwing send failed: ${res.smtp?.stage ?? "?"}`,
      evidence: res.evidence,
    };
  },

  async mailwing_accounts(step, _ctx) {
    const op = String(step.params.op ?? "list");
    if (op === "add") {
      const res = upsertAccount({
        label: String(step.params.label ?? ""),
        smtpHost: String(step.params.host ?? ""),
        smtpPort: parseInt(String(step.params.port ?? "587"), 10),
        secure: String(step.params.secure ?? "false") === "true",
        user: String(step.params.user ?? ""),
        pass: String(step.params.pass ?? ""),
        fromEmail: String(step.params.from ?? step.params.user ?? ""),
        fromName: step.params.fromName,
        isDefault: String(step.params.default ?? "false") === "true",
      });
      return { success: res.ok, output: res.ok ? `Account "${step.params.label}" saved (password encrypted at rest).` : `Couldn't save the account — ${res.error}`, note: "mailwing account add", evidence: res.ok ? [`id: ${res.accountId}`] : [] };
    }
    if (op === "remove") {
      const res = removeAccount(String(step.params.account ?? ""));
      return { success: res.ok, output: res.ok ? `Removed account "${res.removed}".` : res.error!, note: "mailwing account remove" };
    }
    if (op === "switch") {
      // "switch my gmail" with no named account → the OTHER account.
      const wanted = String(step.params.account ?? step.target ?? "").trim();
      const target = wanted && wanted !== "other" ? wanted : otherAccountIdOrLabel() ?? "";
      if (!target) {
        const accounts = listAccounts();
        if (accounts.length === 0) {
          // No vault accounts — do the web thing: the other signed-in Gmail.
          const url = "https://mail.google.com/mail/u/1/";
          let surfPromise: Promise<ActionVerification> | null = null;
          await ghostPerformOpen({ label: "other Gmail account", act: () => { surfPromise = openBrowserSurface(url); } });
          const opened = await (surfPromise ?? openBrowserSurface(url));
          return {
            success: opened.ok,
            output: opened.ok
              ? "No MailWing accounts configured, so I opened your other signed-in Gmail account in the browser."
              : opened.summary,
            note: "switch: no vault accounts → web fallback",
            evidence: opened.evidence,
          };
        }
        return { success: false, output: "There's only one mail account — nothing to switch to. Add another in Settings → MailWing.", note: "switch: single account" };
      }
      const res = setDefaultAccount(target);
      return {
        success: res.ok,
        output: res.ok ? `Switched the default mail account to "${res.label}".` : `Couldn't switch — ${res.error}`,
        note: res.ok ? "mailwing default account switched" : "mailwing switch failed",
        evidence: res.ok ? [`default: ${res.label}`] : [],
      };
    }
    if (op === "test") {
      const res = await testAccount(step.params.account);
      return { success: res.ok, output: res.detail, note: res.ok ? "mailwing account verified (nothing sent)" : "mailwing test failed", evidence: [`stage: ${res.stage ?? "-"}`, `tls: ${res.tls ? "yes" : "no"}`] };
    }
    const accounts = listAccounts();
    if (accounts.length === 0) {
      return { success: false, output: "No MailWing accounts yet — add one in Settings → MailWing (host, port, user, password).", note: "no accounts" };
    }
    return {
      success: true,
      output: accounts.map((a) => `• ${a.label}${a.isDefault ? " (default)" : ""} — ${a.user} via ${a.smtpHost}:${a.smtpPort}${a.passEncrypted ? " [encrypted]" : ""}`).join("\n"),
      note: `mailwing accounts: ${accounts.length}`,
      evidence: ["passwords never shown"],
    };
  },

  async mailwing_outbox(_step, _ctx) {
    const entries = readOutbox();
    if (entries.length === 0) return { success: true, output: "The outbox is empty — no mail sent yet through MailWing.", note: "outbox empty" };
    const lines = entries.slice(0, 15).map((e) => `• ${e.status === "sent" ? "✓" : "✗"} ${new Date(e.ts).toLocaleString()} → ${e.to.join(", ")} "${e.subject.slice(0, 50)}"`);
    return {
      success: true,
      output: `Outbox (last ${lines.length} of ${entries.length}):\n${lines.join("\n")}`,
      note: "mailwing outbox",
      evidence: digestOutboxForLog(entries.slice(0, 5)),
    };
  },

  async contacts_search(step, _ctx) {
    const q = String(step.params.query ?? step.target ?? "").trim();
    if (!q) return { success: false, output: "Whose contact should I look for?", note: "missing query" };
    const hits = searchContacts(q);
    if (hits.length === 0) {
      return { success: false, output: `No contact matched "${q}" — I can save one if you give me the details.`, note: "contacts: no hit" };
    }
    contextStore.update({ lastExtractedEmails: hits[0].email ?? "" });
    return {
      success: true,
      output: hits.map((c) => `• ${c.name ?? "(no name)"} — ${c.email ?? c.phone}${c.company ? ` @ ${c.company}` : ""} [from: ${c.sources.join(", ")}]`).join("\n"),
      note: `contacts search: ${hits.length} hit(s)`,
      evidence: [`query: ${q}`],
    };
  },

  async contacts_save(step, _ctx) {
    const res = upsertContact({
      email: step.params.email,
      phone: step.params.phone,
      name: step.params.name,
      company: step.params.company,
      note: step.params.note,
      source: `manual:${String(step.params.source ?? "chat")}`,
    });
    if (!res.ok) return { success: false, output: `Couldn't save the contact — ${res.error}`, note: "contacts save failed" };
    const c = res.contact!;
    return { success: true, output: `Saved ${c.name ?? ""} — ${c.email ?? c.phone}${c.company ? ` @ ${c.company}` : ""} to your Contacts Book.`, note: "contact saved", evidence: [`id: ${c.id}`] };
  },

  async contacts_export(step, _ctx) {
    const res = exportContactsCsv(step.params.path || undefined);
    if (!res.ok) return { success: false, output: `Couldn't export — ${res.error}`, note: "contacts export failed" };
    return { success: true, output: `Exported ${res.count} contact(s) to ${res.path}.`, note: "contacts exported", evidence: [`file: ${res.path}`] };
  },

  async file_organize(step, _ctx) {
    const op = String(step.params.op ?? "plan");
    if (op === "undo") {
      const manifestId = String(step.params.manifest ?? "").trim();
      const target = manifestId || listManifests(1)[0]?.id;
      if (!target) return { success: false, output: "There's no organize run to undo yet.", note: "no manifest" };
      const res = undoOrganize(target);
      return {
        success: res.ok,
        output: res.ok ? `Undone — moved ${res.moved} file(s) back to their original places.` : `Undo partially failed: ${res.failed.slice(0, 3).map((f) => `${f.from}: ${f.error}`).join("; ")}`,
        note: res.ok ? "organize undone from manifest" : "undo incomplete",
        evidence: [`manifest: ${res.manifestId}`],
      };
    }
    if (op === "apply") {
      const plan = freshPlan();
      if (!plan) return { success: false, output: "There's no staged organize plan — ask me to organize a folder first.", note: "no staged plan" };
      const res = applyOrganizePlan(plan);
      stagedPlan = null;
      return {
        success: res.ok,
        output: res.ok ? `Organized — moved ${res.moved} file(s). Undo any time: "undo organize" (manifest ${res.manifestId}).` : `Moved ${res.moved}/${plan.entries.length} — some failed: ${res.failed.slice(0, 3).map((f) => f.error).join("; ")}`,
        note: `organize applied: ${res.moved}/${plan.entries.length}`,
        evidence: [`manifest: ${res.manifestId}`, res.failed.length ? `failures: ${res.failed.length}` : "no failures"],
      };
    }
    const dir = String(step.params.dir ?? step.params.location ?? step.target ?? "").trim();
    if (!dir) return { success: false, output: "Which folder should I organize?", note: "missing dir" };
    const mode = String(step.params.mode ?? "type") === "date" ? "date" : "type";
    const r = planOrganize(dir, mode);
    if (!r.ok || !r.plan) return { success: false, output: `I couldn't plan that — ${r.error}`, note: "organize plan failed" };
    if (r.plan.entries.length === 0) {
      return { success: true, output: `${dir} is already organized — nothing to move.`, note: "nothing to organize", evidence: [`dir: ${dir}`] };
    }
    stagedPlan = { plan: r.plan, stagedAt: Date.now() };
    return {
      success: true,
      output: `${describePlan(r.plan)}\nSay "confirm organize" and I'll move them.`,
      note: `organize plan staged: ${r.plan.entries.length} move(s)`,
      evidence: [`dir: ${dir}`, `mode: ${mode}`, r.truncated ? "scan truncated at 2000 files" : "full scan"],
    };
  },

  async file_duplicates(step, _ctx) {
    const dir = String(step.params.dir ?? step.params.location ?? step.target ?? "").trim();
    if (!dir) return { success: false, output: "Which folder should I scan for duplicates?", note: "missing dir" };
    const r = findDuplicates(dir);
    if (!r.ok || !r.groups) return { success: false, output: `The duplicate scan failed — ${r.error}`, note: "duplicates scan failed" };
    if (r.groups.length === 0) {
      return { success: true, output: `Scanned ${r.scanned} files — no duplicates found.`, note: "no duplicates", evidence: [`dir: ${dir}`, `scanned: ${r.scanned}`] };
    }
    const lines = r.groups.slice(0, 10).map((g) => `• ${(formatBytes(g.size))} × ${g.files.length}: ${g.files.map((f) => path.basename(f)).join(" = ")}`);
    const wasted = r.groups.reduce((sum, g) => sum + g.size * (g.files.length - 1), 0);
    if (String(step.params.clean ?? "") === "true") {
      const trashed = trashDuplicateCopies(r.groups);
      return {
        success: trashed.failed.length === 0,
        output: `Found ${r.groups.length} duplicate group(s). Moved ${trashed.trashed.length} extra copy(ies) to .quip-trash folders (reversible).${trashed.failed.length ? ` Failures: ${trashed.failed.map((f) => path.basename(f.path)).join(", ")}` : ""}`,
        note: `duplicates cleaned: ${trashed.trashed.length}`,
        evidence: [`groups: ${r.groups.length}`, `reclaimed: ~${formatBytes(wasted)}`],
      };
    }
    return {
      success: true,
      output: `Found ${r.groups.length} duplicate group(s) (~${formatBytes(wasted)} wasted):\n${lines.join("\n")}${r.groups.length > 10 ? `\n… and ${r.groups.length - 10} more` : ""}\nSay "clean the duplicates" to trash the extra copies.`,
      note: `duplicates: ${r.groups.length} group(s)`,
      evidence: [`dir: ${dir}`, `scanned: ${r.scanned}`],
    };
  },

  async file_storage_report(step, _ctx) {
    const dir = String(step.params.dir ?? step.params.location ?? step.target ?? "").trim();
    if (!dir) return { success: false, output: "Which folder should I report on?", note: "missing dir" };
    const r = storageReport(dir);
    if (!r.ok || !r.report) return { success: false, output: `The storage report failed — ${r.error}`, note: "storage report failed" };
    const rep = r.report;
    const cats = rep.byCategory.slice(0, 6).map((c) => `${c.category}: ${c.files} file(s), ${formatBytes(c.bytes)}`).join("\n");
    const top = rep.top.slice(0, 8).map((t) => `• ${formatBytes(t.bytes)} — ${path.basename(t.path)}`).join("\n");
    return {
      success: true,
      output: `${dir}: ${rep.files} file(s), ${rep.folders} folder(s), ${formatBytes(rep.bytes)} total.${rep.truncated ? " (scan truncated — deep folders skipped)" : ""}\nBy type:\n${cats}\nBiggest files:\n${top}`,
      note: `storage report: ${formatBytes(rep.bytes)} in ${rep.files} files`,
      evidence: [`dir: ${dir}`, rep.truncated ? "truncated scan" : "full scan"],
    };
  },

  async file_watch(step, _ctx) {
    const op = String(step.params.op ?? "status");
    if (op === "stop") {
      const dir = String(step.params.dir ?? step.target ?? "").trim();
      if (!dir) return { success: false, output: "Which folder's watch should I stop?", note: "missing dir" };
      const r = stopWatch(dir);
      return { success: true, output: r.wasWatching ? `Stopped watching ${dir}.` : `${dir} wasn't being watched.`, note: "watch stopped" };
    }
    if (op === "start") {
      const dir = String(step.params.dir ?? step.target ?? "").trim();
      if (!dir) return { success: false, output: "Which folder should I watch?", note: "missing dir" };
      const r = startWatch(dir, (e) => {
        // Auto-move toast is delivered by the boot wiring (main.ts) — here we
        // only register the watch; the sink is injected via setWatchEventSink.
        watchEventSink?.(e);
      });
      return { success: r.ok, output: r.ok ? `Watching ${dir} — new files get organized automatically and I'll toast every move.` : `Couldn't watch ${dir} — ${r.error}`, note: r.ok ? "watch started" : "watch failed", evidence: r.ok ? [`dir: ${dir}`] : [] };
    }
    const st = watchStatus();
    if (st.length === 0) return { success: true, output: "No folders are being watched right now.", note: "no watches" };
    return { success: true, output: `Watching:\n${st.map((w) => `• ${w.dir} (auto-organize ${w.autoOrganize ? "on" : "off"})`).join("\n")}`, note: `watches: ${st.length}` };
  },

  async screenshot_save(step, _ctx) {
    const r = await screenshotToFile(step.params.dir || undefined);
    if (!r.ok) return { success: false, output: `Screenshot failed — ${r.error}`, note: "screenshot failed" };
    return { success: true, output: `Screenshot saved: ${r.path} (${formatBytes(r.bytes ?? 0)}). Opened its folder for you.`, note: "screenshot saved", evidence: [`file: ${r.path}`, `bytes: ${r.bytes}`] };
  },

  async wallpaper_set(step, _ctx) {
    const src = String(step.params.source ?? step.target ?? "").trim();
    if (!src) return { success: false, output: "Which image should I set as wallpaper (a local path or https URL)?", note: "missing source" };
    return fromVerification(await setWallpaper(src));
  },

  async brightness(step, _ctx) {
    const action = String(step.params.action ?? "get");
    if (action === "get") return fromVerification(await getBrightness());
    const level = parseFloat(String(step.params.level ?? ""));
    if (!Number.isFinite(level) || level < 1 || level > 100) {
      return { success: false, output: "Give me a brightness level between 1 and 100.", note: "invalid level" };
    }
    return fromVerification(await setBrightness(level));
  },

  async notify_me(step, _ctx) {
    const title = String(step.params.title ?? "Quip reminder");
    const body = String(step.params.body ?? step.params.text ?? step.target ?? "").trim();
    if (!body) return { success: false, output: "What should the notification say?", note: "missing body" };
    return fromVerification(notify(title, body));
  },

  async lock_pc(_step, _ctx) {
    // DESTRUCTIVE-class: the Action Engine's permission gate confirms before
    // this executor ever runs — locking without asking would be hostile.
    return fromVerification(await lockPc());
  },

  async battery(_step, _ctx) {
    return fromVerification(await batteryStatus());
  },

  async clipboard_history(_step, _ctx) {
    const hist = clipboardHistory();
    if (hist.length === 0) {
      return { success: false, output: "The clipboard history is empty — I only see what Quip copies/pastes in this session.", note: "empty clipboard ring" };
    }
    return {
      success: true,
      output: `Clipboard history (${hist.length}):
${hist.slice(0, 8).map((h, i) => `${i + 1}. [${h.origin}] ${h.text.slice(0, 80).replace(/\n/g, " ")}`).join("\n")}`,
      note: `clipboard ring: ${hist.length}`,
      evidence: ["session-scoped: only Quip's own clipboard actions"],
    };
  },

  async install_app(step, _ctx) {
    const appQuery = String(step.params.query ?? step.target ?? "").trim();
    if (!appQuery) return { success: false, output: "Which app should I install?", note: "missing app" };
    const proposal = proposeInstall(appQuery);
    if (!proposal.ok || !proposal.command) return { success: false, output: `I couldn't propose an install for "${appQuery}" — ${proposal.note}.`, note: "no install proposal" };
    return runShellCommand(proposal.command);
  },

  async quest_run(step, _ctx) {
    const kind = String(step.params.kind ?? step.target ?? "").trim();
    const built = buildQuest(kind, step.params);
    if (!built.ok || !built.quest) {
      return { success: false, output: `I can't run that quest — ${built.error}`, note: "quest build failed" };
    }
    const res = await runQuest(built.quest, step.params);
    return {
      success: res.ok,
      output: `${res.summary}\n${res.notes.map((n) => `• ${n}`).join("\n")}`.slice(0, 3000),
      note: res.cancelled ? "quest cancelled" : res.ok ? "quest verified end-to-end" : `quest failed at ${res.failedStep}`,
      evidence: [`quest: ${built.quest.id}`, `steps: ${res.stepsCompleted}/${res.stepsTotal}`],
    };
  },

  async routine_save(step, _ctx) {
    const name = String(step.params.name ?? "").trim();
    const raw = String(step.params.steps ?? "").trim();
    if (!name || !raw) return { success: false, output: "I need a routine name and its steps.", note: "missing name or steps" };
    let steps: RoutineStep[] = [];
    try {
      steps = JSON.parse(raw) as RoutineStep[];
    } catch {
      return { success: false, output: 'The steps weren\'t valid JSON — e.g. [{"kind":"quest","questId":"organize-downloads"},{"kind":"say","text":"done"}].', note: "bad steps json" };
    }
    const res = saveRoutine(name, steps);
    return { success: res.ok, output: res.ok ? `Routine "${res.routine!.name}" saved with ${steps.length} step(s). Run it: "run routine ${res.routine!.name}".` : `Couldn't save — ${res.error}`, note: "routine save", evidence: res.ok ? [`id: ${res.routine!.id}`] : [] };
  },

  async routine_run(step, _ctx) {
    const name = String(step.params.name ?? step.target ?? "").trim();
    if (!name) return { success: false, output: "Which routine should I run?", note: "missing name" };
    const res = await runRoutine(name);
    return {
      success: res.ok,
      output: `${res.summary}\n${res.results.map((r) => `• ${r}`).join("\n")}`.slice(0, 2500),
      note: res.ok ? "routine verified" : "routine had failures",
      evidence: [`routine: ${name}`],
    };
  },

  async routine_list(_step, _ctx) {
    const routines = listRoutines();
    if (routines.length === 0) return { success: false, output: 'No routines saved yet — make one: "save a routine called morning that organizes downloads".', note: "no routines" };
    return {
      success: true,
      output: routines.map((r) => `• ${r.name} — ${r.steps.length} step(s)${r.lastRunOk === true ? " (last run ok)" : r.lastRunOk === false ? " (last run had failures)" : ""}`).join("\n"),
      note: `routines: ${routines.length}`,
    };
  },

  // ── Problem Diary — "kya problems aayi?" / "problem report do" ──────────
  // The user can ask Quip what failed, resolve entries and export the
  // Markdown report to the Desktop for sharing with the developer.
  async problem_diary(step, _ctx) {
    const verb = String(step.params.verb ?? step.params.action ?? (step.params.query ? "search" : "list")).toLowerCase().trim();
    if (verb === "resolve") {
      const id = String(step.params.id ?? step.target ?? "").trim();
      if (!id) return { success: false, output: "Which problem should I mark resolved? Give me its number from the list or its id.", note: "missing id" };
      const byIndex = /^\d+$/.test(id);
      let target = id;
      if (byIndex) {
        const entries = listProblems({ status: "open", limit: 200 });
        const entry = entries[Number(id) - 1];
        if (!entry) return { success: false, output: `There's no open problem #${id}. Say "problems dikhao" for the current list.`, note: "bad index" };
        target = entry.id;
      }
      const res = resolveProblem(target);
      return res.ok
        ? { success: true, output: `Marked resolved. It stays in the diary — if the same problem comes back, it reopens automatically with a higher count.`, note: "problem resolved" }
        : { success: false, output: `Couldn't resolve it — ${res.error}`, note: "resolve failed" };
    }
    if (verb === "export") {
      const res = exportProblemsMarkdown();
      return res.ok
        ? { success: true, output: `Problem report written to ${res.path} (${res.count} entr${res.count === 1 ? "y" : "ies"}). Hand that file back and every line can be fixed against real data.`, note: "diary exported", evidence: [`path: ${res.path}`] }
        : { success: false, output: `Export failed — ${res.error}`, note: "export failed" };
    }
    if (verb === "clear") {
      const which = String(step.params.scope ?? "resolved").toLowerCase();
      const res = which === "all" ? clearAllProblems() : diaryClearResolved();
      return { success: true, output: res.ok ? `Cleared ${res.removed} ${which === "all" ? "entries" : "resolved entries"} from the diary.` : "Couldn't clear the diary.", note: "diary cleared" };
    }
    // list (default) — optionally filtered by source
    const src = String(step.params.source ?? "all").toLowerCase() as ProblemSource | "all";
    const stats = problemStats();
    const entries = listProblems({ status: "open", source: src, limit: 20 });
    if (entries.length === 0) {
      return {
        success: true,
        output: `The problem diary is empty${src !== "all" ? ` for "${src}"` : ""} — no open problems. (${stats.total} total recorded, ${stats.resolved} resolved.)`,
        note: "diary empty",
      };
    }
    const lines = entries.map((e, i) => {
      const when = new Date(e.lastSeen).toLocaleString();
      return `${i + 1}. [${e.severity.toUpperCase()}] ${e.title} — ${e.occurrences}× (last ${when}) [${e.id}]`;
    });
    return {
      success: true,
      output: `Open problems (${entries.length} shown, ${stats.high} high-severity):\n${lines.join("\n")}\nSay "resolve problem <number>" to mark one handled, or "export problem report" to write the Markdown file to your Desktop.`,
      note: `open: ${stats.open}, resolved: ${stats.resolved}`,
      evidence: entries.slice(0, 5).map((e) => `${e.id}: ${e.key}`),
    };
  },
};

// ─── Autonomy wave state (MailWing draft + organize plan staging) ────────────

interface StagedDraft {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  humanized: boolean;
  accountId?: string;
  stagedAt: number;
}

const DRAFT_TTL_MS = 10 * 60 * 1000; // 10 minutes to approve a draft
let stagedDraft: StagedDraft | null = null;
let stagedPlan: { plan: OrganizePlan; stagedAt: number } | null = null;

function freshDraft(): StagedDraft | null {
  if (stagedDraft && Date.now() - stagedDraft.stagedAt <= DRAFT_TTL_MS) return stagedDraft;
  stagedDraft = null;
  return null;
}

function freshPlan(): OrganizePlan | null {
  if (stagedPlan && Date.now() - stagedPlan.stagedAt <= 10 * 60 * 1000) return stagedPlan.plan;
  stagedPlan = null;
  return null;
}

function firstUrlIn(text: string): string {
  const m =
    text.match(/https?:\/\/[^\s"<>]+/i) ??
    text.match(/\b(?:www\.)[a-z0-9-]+(?:\.[a-z]{2,24})+[^\s"<>]*/i) ??
    text.match(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|in|co|dev|ai|app|me)\b/i);
  if (!m) return "";
  let url = m[0].replace(/[.,;]+$/, "");
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

// ─── Router ───────────────────────────────────────────────────────────

/** Names of every real executor — used by tests to prove the model-facing
 *  catalog never advertises a capability that doesn't exist. */
export function executorNames(): string[] {
  return Object.keys(Executors);
}

export async function executeTool(
  action: string,
  stepOrParams: TaskStep | Record<string, string>,
  ctx: ToolContext
): Promise<ToolResult> {
  // New-style: full TaskStep object
  const step = stepOrParams as TaskStep;
  const executor = Executors[action];
  if (executor) {
    try {
      const result = await executor(step, ctx);
      // Problem Diary: every failed tool call is recorded with its real
      // output as evidence — the user can later see exactly what broke.
      if (!result.success) {
        noteProblem({
          source: problemSourceFor(action),
          kind: "executor-failed",
          title: `${action} failed: ${firstLine(result.note || result.output || "no detail")}`,
          detail: result.output?.slice(0, 800),
          evidence: result.evidence,
        });
      }
      return result;
    } catch (e: any) {
      const detail = String(e?.message ?? e).slice(0, 500);
      noteProblem({
        source: problemSourceFor(action),
        kind: "executor-error",
        severity: "high",
        title: `${action} crashed: ${firstLine(detail)}`,
        detail,
      });
      return {
        success: false,
        output: `Something went wrong running that action.`,
        note: `executor error: ${detail}`,
      };
    }
  }

  // Legacy fallback for old-style (action, params) calls
  const params = (stepOrParams && typeof stepOrParams === "object" ? stepOrParams : {}) as Record<string, string>;
  return legacyExecute(action, params, ctx);
}

// ─── Problem Diary helpers ───────────────────────────────────────────────────

function firstLine(text: string): string {
  return String(text ?? "").split("\n")[0].slice(0, 120);
}

/** Map an action to its diary source bucket so the Settings list groups sensibly. */
function problemSourceFor(action: string): ProblemSource {
  if (action.startsWith("mailwing") || action === "compose_email") return "mail";
  if (action.startsWith("web_ghost") || action === "web_read") return "ghost";
  if (action.startsWith("file_") || action === "find_file") return "file";
  if (action.startsWith("routine")) return "routine";
  if (action.startsWith("quest")) return "quest";
  return "tool";
}
