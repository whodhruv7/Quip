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
//   quiz            → quiz capability (model-generated, delivered via result)
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
  type InstalledApp,
} from "./app-discovery";
import { resolveLocalTarget, openLocalTarget } from "./file-discovery";
import { executeDesktopAction } from "./desktop-controller";
import {
  openBrowserSurface,
  navigateBrowser,
  playFirstYouTubeResult,
  readWebPage,
} from "./browser-automation";
import { contextStore } from "./context-store";
import type { ActionVerification } from "./action-verifier";

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

/** Allow tests / manual rescan to invalidate the cached app index. */
export function invalidateAppIndex(): void {
  appIndexPromise = null;
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
    return fromVerification(await executeDesktopAction({
      type: "click",
      x: parseFloat(step.params.x ?? "0"),
      y: parseFloat(step.params.y ?? "0"),
    }));
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

  async quiz(_step, _ctx) {
    // Quiz generation is handled by the orchestrator via the model.
    return { success: true, output: "quiz-handled-by-orchestrator", note: "quiz" };
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
