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

const TAB_ACTIONS: TabAction[] = [
  "new", "close", "next", "previous", "reopen", "back", "forward", "reload",
];

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
    return fromVerification(await readWebPage(step.params.url));
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
};

// ─── Router ──────────────────────────────────────────────────────────────────

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
