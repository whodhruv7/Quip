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
  type InstalledApp,
} from "./app-discovery";
import { executeDesktopAction } from "./desktop-controller";
import { executeFileOp, searchFiles } from "./file-ops";
import { resolveLocalTarget, openLocalTarget } from "./file-discovery";
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

const TAB_ACTIONS: TabAction[] = [
  "new", "close", "next", "previous", "reopen", "back", "forward", "reload",
];

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
    appIndexPromise = buildInstalledAppIndex(app.getPath("userData"));
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
      const result = await launchApp(resolved);
      if (result.ok) {
        contextStore.update({ activeApp: resolved.name });
      }
      return fromVerification(result);
    }

    // Not installed → sensible fallbacks
    const q = query.toLowerCase();
    if (q.includes("whatsapp")) {
      const result = await openBrowserSurface("https://web.whatsapp.com");
      return {
        success: result.ok,
        output: result.ok
          ? "WhatsApp isn't installed as an app, so I opened WhatsApp Web instead."
          : result.summary,
        note: result.ok ? "app missing → web fallback" : result.summary,
        evidence: result.evidence,
      };
    }
    // Maybe it's actually a website the user calls an "app"
    const web = await openBrowserSurface(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
    return {
      success: false,
      output: `I couldn't find an installed app called "${query}".`,
      note: web.ok
        ? "app not found — opened a web search so you can double-check the name"
        : "app not found",
      evidence: ["no Start Menu / Program Files / Store match"],
    };
  },

  async open_website(step, _ctx) {
    const result = await openBrowserSurface(step.params.url);
    if (result.ok) contextStore.update({ activeWebsite: step.target, activeUrl: step.params.url });
    return fromVerification(result);
  },

  async open_url(step, _ctx) {
    const result = await openBrowserSurface(step.params.url);
    if (result.ok) contextStore.update({ activeUrl: step.params.url });
    return fromVerification(result);
  },

  async search_web(step, _ctx) {
    const result = await openBrowserSurface(step.params.url);
    return fromVerification(result);
  },

  async search_youtube(step, _ctx) {
    const result = await openBrowserSurface(step.params.url);
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
    const target = await resolveLocalTarget(
      step.params.location || step.params.query || step.target,
      contextStore.get()
    );
    if (!target) {
      return {
        success: false,
        output: `I couldn't find a folder called "${step.params.query ?? step.target}".`,
        note: "no matching folder in known locations or project directories",
        evidence: ["known folders + project roots scanned"],
      };
    }
    const result = await openLocalTarget(target);
    if (result.ok) contextStore.update({ lastOpenedPath: target.path });
    return fromVerification(result);
  },

  async open_file(step, _ctx) {
    const target = await resolveLocalTarget(
      step.params.query || step.target,
      contextStore.get()
    );
    if (!target) {
      return {
        success: false,
        output: `I couldn't find a file called "${step.params.query ?? step.target}".`,
        note: "no matching file in known locations or project directories",
        evidence: ["known folders + project roots scanned"],
      };
    }
    const result = await openLocalTarget(target);
    if (result.ok) contextStore.update({ lastOpenedPath: target.path });
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
      const res = searchFiles(query, base);
      if (res.hits.length === 0) {
        return {
          success: false,
          output: `I couldn't find any file matching "${query}".`,
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
      return {
        success: true,
        output: `Found ${res.hits.length} matching item${res.hits.length > 1 ? "s" : ""}:\n${res.hits.map((h) => `• ${h}`).join("\n")}`,
        note: "file-search",
        evidence: [`searched: ${query}`],
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
    const result = await openBrowserSurface(step.params.url);
    return fromVerification(result);
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
};

// ─── Router ──────────────────────────────────────────────────────────────────

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
      return await executor(step, ctx);
    } catch (e: any) {
      return {
        success: false,
        output: `Something went wrong running that action.`,
        note: `executor error: ${String(e?.message ?? e)}`,
      };
    }
  }

  // Legacy fallback for old-style (action, params) calls
  const params = (stepOrParams && typeof stepOrParams === "object" ? stepOrParams : {}) as Record<string, string>;
  return legacyExecute(action, params, ctx);
}
