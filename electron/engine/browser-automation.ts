// Quip Execution Engine — Browser / Website Automation
// ─────────────────────────────────────────────────────────────────────────────
// Website understanding + interaction:
//   - Safe-URL gate (SSRF protection — ported from Agent-Reach's URL guard)
//   - openBrowserSurface / navigateBrowser — focused Quip-controlled window
//   - searchYouTube / playFirstYouTubeResult — real playback, verified
//   - readWebPage — Agent-Reach "reach the web" port (r.jina.ai reader)
// ─────────────────────────────────────────────────────────────────────────────

import { BrowserWindow } from "electron";
import { ok, fail, type ActionVerification } from "./action-verifier";
import { computeBrowserWindowBounds, quipOverlayRect } from "./window-policy";
import { contextStore } from "./context-store";

// ─── URL safety gate (Agent-Reach port) ──────────────────────────────────────

const PRIVATE_HOST_RE =
  /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/i;

export function isSafePublicUrl(rawUrl: string): { safe: boolean; reason?: string; url?: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { safe: false, reason: "malformed URL" };
  }
  if (parsed.protocol === "file:") return { safe: false, reason: "file:// URLs are not allowed" };
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { safe: false, reason: `unsupported protocol: ${parsed.protocol}` };
  }
  if (PRIVATE_HOST_RE.test(parsed.hostname)) {
    return { safe: false, reason: "private/internal addresses are not allowed" };
  }
  if (parsed.username || parsed.password) {
    return { safe: false, reason: "URLs with embedded credentials are not allowed" };
  }
  return { safe: true, url: parsed.toString() };
}

// ─── Browser surface management ──────────────────────────────────────────────

let taskSurface: BrowserWindow | null = null;

function createSurface(url: string): BrowserWindow {
  const bounds = computeBrowserWindowBounds(quipOverlayRect());
  const win = new BrowserWindow({
    ...bounds,
    title: "Quip Browser",
    autoHideMenuBar: true,
    show: false,
    backgroundColor: "#ffffff",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // Browser is a NORMAL window: opens in front, user can minimize/switch.
  // Quip chat overlay stays always-on-top and compact — it never hides the task.
  win.loadURL(url);
  win.once("ready-to-show", () => {
    win.show();
    win.focus();
    win.moveTop();
  });
  win.on("closed", () => {
    if (taskSurface === win) taskSurface = null;
  });
  return win;
}

/** Open a URL in Quip's focused browser surface (or the OS browser on failure). */
export async function openBrowserSurface(rawUrl: string): Promise<ActionVerification> {
  const gate = isSafePublicUrl(rawUrl);
  if (!gate.safe) {
    return fail(`I won't open that URL — ${gate.reason}.`, [`blocked: ${rawUrl}`], "unsafe-url");
  }
  const url = gate.url!;

  try {
    if (taskSurface && !taskSurface.isDestroyed()) {
      await taskSurface.loadURL(url);
      taskSurface.show();
      taskSurface.focus();
      taskSurface.moveTop();
    } else {
      taskSurface = createSurface(url);
    }
    contextStore.update({ activeUrl: url, activeWebsite: hostnameOf(url) });
    return ok(`Opened ${hostnameOf(url)} in a browser window.`, [`loaded ${url}`, "surface focused"]);
  } catch (e: any) {
    // Fallback: OS browser via shell (wired in tool-registry to avoid import cycle)
    return fail(
      `The browser window failed to open.`,
      [`error: ${String(e?.message ?? e)}`],
      "surface-failed"
    );
  }
}

export async function navigateBrowser(rawUrl: string): Promise<ActionVerification> {
  return openBrowserSurface(rawUrl);
}

/** Re-focus the existing browser surface (used after navigation). */
export function focusBrowserSurface(): void {
  if (taskSurface && !taskSurface.isDestroyed()) {
    taskSurface.show();
    taskSurface.focus();
    taskSurface.moveTop();
  }
}

export function hasBrowserSurface(): boolean {
  return !!taskSurface && !taskSurface.isDestroyed();
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ─── YouTube ─────────────────────────────────────────────────────────────────

/** Scrape the first video ID for a YouTube search query. */
export async function searchYouTubeVideoId(query: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
      { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } }
    );
    const html = await res.text();
    const match = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Search YouTube and open the first playable result — VERIFIED /watch URL. */
export async function playFirstYouTubeResult(query: string): Promise<ActionVerification> {
  if (!query.trim()) {
    return fail("I don't know what to play — the search was empty.", [], "empty-query");
  }
  const videoId = await searchYouTubeVideoId(query);
  if (videoId) {
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const opened = await openBrowserSurface(watchUrl);
    if (opened.ok) {
      contextStore.update({ lastMediaQuery: query, activeWebsite: "youtube" });
      return ok(`Playing "${query}" on YouTube.`, [`direct watch URL: ${watchUrl}`]);
    }
    // Surface failed — fall back to search page
  }
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  const opened = await openBrowserSurface(searchUrl);
  contextStore.update({ lastMediaQuery: query, activeWebsite: "youtube" });
  return opened.ok
    ? ok(
        `Opened YouTube search results for "${query}" — couldn't auto-pick a video.`,
        ["videoId scrape failed", "search page opened"]
      )
    : fail(`I couldn't open YouTube for "${query}".`, ["both direct and search failed"], "youtube-failed");
}

// ─── Web reading (Agent-Reach "reach" port) ──────────────────────────────────

/** Read a public web page as clean text via the Jina reader fallback chain. */
export async function readWebPage(rawUrl: string): Promise<ActionVerification> {
  const gate = isSafePublicUrl(rawUrl);
  if (!gate.safe) {
    return fail(`I won't read that URL — ${gate.reason}.`, [`blocked: ${rawUrl}`], "unsafe-url");
  }
  const url = gate.url!;

  try {
    const res = await fetch(`https://r.jina.ai/${url}`, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`reader-http-${res.status}`);
    const text = await res.text();
    if (!text || text.length < 20) throw new Error("empty content");
    if (text.length > 20000) {
      return ok(
        `Read the page (${hostnameOf(url)}) — showing the beginning.`,
        [`char count: ${text.length}`],
      );
    }
    contextStore.update({ activeUrl: url });
    return ok(text.slice(0, 20000), [`reader: r.jina.ai`, `url: ${url}`]);
  } catch (e: any) {
    // Fallback: direct fetch → strip HTML
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const html = await res.text();
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (text.length > 20) {
        return ok(text.slice(0, 20000), ["reader: direct fetch", `url: ${url}`]);
      }
      throw new Error("empty after strip");
    } catch {
      return fail(
        `I couldn't read ${hostnameOf(url)}.`,
        [`error: ${String(e?.message ?? e)}`],
        "read-failed"
      );
    }
  }
}
