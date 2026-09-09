// Quip Execution Engine — Browser / Website Automation
// ─────────────────────────────────────────────────────────────────────────────
// REAL BROWSER ONLY (Phase 26): Quip opens the user's ACTUAL default browser
// via the OS shell — never an embedded Electron browser window.
//   - Safe-URL gate (SSRF protection — ported from Agent-Reach's URL guard)
//   - openBrowserSurface → shell.openExternal + window-title verification
//   - searchYouTube / playFirstYouTubeResult — score, pick, open, verify
//   - readWebPage — Agent-Reach "reach the web" port (r.jina.ai reader)
//
// Verification contract with the user's real browser: we cannot execute
// JavaScript inside another browser's tabs, so we verify what IS observable —
// the browser's window titles. A YouTube watch page loaded successfully shows
// the video title (or " - YouTube") in the tab/window title. We report
// exactly what we saw, and nothing more.
// ─────────────────────────────────────────────────────────────────────────────

import { shell } from "electron";
import {
  ok,
  fail,
  listWindowTitles,
  type ActionVerification,
} from "./action-verifier";
import { contextStore } from "./context-store";

// ─── URL safety gate (Agent-Reach port) ──────────────────────────────────────

const PRIVATE_HOST_RE =
  /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\]|\[::ffff:|::1)/i;
// Alternate IP encodings (decimal/hex/mixed) that can smuggle private addresses.
const ENCODED_HOST_RE = /^(0x[0-9a-f]+|\d+)$/i;

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
  if (PRIVATE_HOST_RE.test(parsed.hostname) || parsed.hostname.includes("::ffff:")) {
    return { safe: false, reason: "private/internal addresses are not allowed" };
  }
  if (ENCODED_HOST_RE.test(parsed.hostname)) {
    return { safe: false, reason: "numeric host encodings are not allowed" };
  }
  if (parsed.username || parsed.password) {
    return { safe: false, reason: "URLs with embedded credentials are not allowed" };
  }
  return { safe: true, url: parsed.toString() };
}

// ─── Real browser surface (the user's own browser) ──────────────────────────

const BROWSER_TITLE_HINTS = [
  "chrome", "edge", "firefox", "brave", "opera", "vivaldi", "youtube",
  "google search", "reddit", "github", "x.com", "twitter",
];

function titleLooksLikeBrowserOrSite(title: string): boolean {
  const t = ` ${title.toLowerCase()} `;
  return BROWSER_TITLE_HINTS.some((h) => t.includes(h));
}

/**
 * Ask the OS to open the URL in the user's ACTUAL default browser, then
 * verify what can honestly be verified: that a browser window exists.
 * Never opens an embedded Electron browser (Phase 26).
 */
export async function openBrowserSurface(rawUrl: string): Promise<ActionVerification> {
  const gate = isSafePublicUrl(rawUrl);
  if (!gate.safe) {
    return fail(`I won't open that URL — ${gate.reason}.`, [`blocked: ${rawUrl}`], "unsafe-url");
  }
  const url = gate.url!;
  const host = hostnameOf(url);

  let opened = true;
  try {
    await shell.openExternal(url); // resolves void; throws when the shell refuses
  } catch (e: any) {
    opened = false;
    return fail(
      `I couldn't open your browser — ${String(e?.message ?? e)}`,
      [`url: ${url}`],
      "open-external-failed"
    );
  }
  if (!opened) {
    return fail(
      `Your system refused to open ${host} (no default browser set?).`,
      [`url: ${url}`],
      "open-external-refused"
    );
  }
  contextStore.update({ activeUrl: url, activeWebsite: host });

  // Give the OS/browser a moment, then look for a browser window.
  await new Promise((r) => setTimeout(r, 2500));
  const titles = await listWindowTitles();
  const match = titles.find((t) => titleLooksLikeBrowserOrSite(t));
  if (match) {
    return ok(
      `Opened ${host} in your browser.`,
      [`shell.openExternal ${url}`, `browser window seen: "${match.slice(0, 80)}"`]
    );
  }
  return ok(
    `Opened ${host} in your default browser.`,
    [`shell.openExternal ${url}`, "browser window not detected yet — it may still be loading"]
  );
}

export async function navigateBrowser(rawUrl: string): Promise<ActionVerification> {
  return openBrowserSurface(rawUrl);
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ─── YouTube ─────────────────────────────────────────────────────────────────

export interface YouTubeResult {
  videoId: string;
  title: string;
}

const VIDEO_RENDERER_RE =
  /"videoRenderer":\{"videoId":"([\w-]{11})".{0,800}?"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/g;

function unescapeJsonString(s: string): string {
  try {
    return JSON.parse(`"${s}"`) as string;
  } catch {
    return s.replace(/\\u0026/g, "&").replace(/\\"/g, '"');
  }
}

/**
 * Extract the ORGANIC video results (id + title) from a YouTube search page.
 * Only "videoRenderer" entries are taken — ads, channels, playlists and
 * shelves use different renderer keys, so they never pollute the results.
 */
export function extractYouTubeResults(html: string, max = 10): YouTubeResult[] {
  const results: YouTubeResult[] = [];
  const seen = new Set<string>();
  VIDEO_RENDERER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = VIDEO_RENDERER_RE.exec(html)) && results.length < max) {
    const videoId = m[1];
    if (seen.has(videoId)) continue;
    seen.add(videoId);
    const title = unescapeJsonString(m[2]).replace(/\s+/g, " ").trim();
    if (title) results.push({ videoId, title });
  }
  return results;
}

/**
 * Score how well a result title matches what the user asked for.
 * Positive: token overlap, exact/substring title, official audio markers.
 * Negative: covers, live, reactions, remixes, full-album dumps — things
 * that are NOT the requested song.
 */
export function scoreYouTubeResult(title: string, query: string): number {
  const t = title.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q || !t) return 0;
  const qTokens = q.split(/\s+/).filter(Boolean);
  const tTokens = new Set(t.split(/[^a-z0-9]+/).filter(Boolean));

  let overlap = 0;
  for (const w of qTokens) if (tTokens.has(w)) overlap++;
  let score = overlap / qTokens.length;

  if (t === q) score += 0.5;
  else if (t.includes(q)) score += 0.3;

  const strong = qTokens.filter((w) => w.length >= 3);
  if (strong.length) {
    const strongHits = strong.filter((w) => tTokens.has(w)).length;
    score += 0.2 * (strongHits / strong.length);
  }

  if (/\b(live|cover|reaction|remix|mashup|karaoke|tutorial|lesson|8d|slowed|sped up)\b/.test(t)) score -= 0.15;
  if (/\b(full album|all songs|jukebox|playlist|mix|top \d+)\b/.test(t)) score -= 0.2;
  if (/\b(official (audio|video|music video)|lyrical? video|topic)\b/.test(t)) score += 0.12;
  if (/\bvideo song\b|\bfull video\b/.test(t) && /\b(song|gaana)\b/.test(q)) score += 0.05;

  return score;
}

/**
 * Pick the result that actually IS what the user asked for — not blindly the
 * first one. The caller must check `.confident` before auto-playing; a
 * `confident: false` pick is returned for introspection, never for execution.
 */
export function pickBestYouTubeResult(
  results: YouTubeResult[],
  query: string
): { best: YouTubeResult; score: number; confident: boolean } | null {
  if (results.length === 0) return null;
  let best = results[0];
  let bestScore = -Infinity;
  for (const r of results) {
    const s = scoreYouTubeResult(r.title, query);
    if (s > bestScore) {
      best = r;
      bestScore = s;
    }
  }
  // Confident = meaningful overlap with the request (not a random video).
  const confident = bestScore >= 0.45;
  return { best, score: bestScore, confident };
}

/** Scrape YouTube search results (id + title) for a query. */
export async function searchYouTubeResults(query: string): Promise<YouTubeResult[]> {
  try {
    const res = await fetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
      { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } }
    );
    const html = await res.text();
    const results = extractYouTubeResults(html);
    if (results.length > 0) return results;
    // Fallback: bare first-videoId scrape (no titles available)
    const match = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    return match ? [{ videoId: match[1], title: "" }] : [];
  } catch {
    return [];
  }
}

// ─── Playback verification (observable truth: the browser's window titles) ──

/**
 * Watch the user's real browser window titles for signs the requested video
 * actually loaded. A loaded YouTube watch page shows the video title in the
 * window/tab title. We never claim "playing" beyond what the titles show.
 */
async function verifyVideoLoaded(
  expectedTitle: string,
  timeoutMs = 9000
): Promise<{ loaded: boolean; detail: string; seenTitle?: string }> {
  const deadline = Date.now() + timeoutMs;
  // Use a meaningful fragment of the title (YouTube truncates long titles).
  const needle = expectedTitle.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 24);
  let lastDetail = "no browser window with the video seen yet";
  while (Date.now() < deadline) {
    const titles = await listWindowTitles();
    const ytWindow = titles.find((t) => t.toLowerCase().includes("youtube") || t.toLowerCase().includes("- yt"));
    if (needle.length >= 4) {
      const match = titles.find((t) => t.toLowerCase().includes(needle));
      if (match) {
        return { loaded: true, detail: `browser tab shows "${match.slice(0, 80)}"`, seenTitle: match };
      }
    }
    if (ytWindow) {
      lastDetail = `browser tab shows "${ytWindow.slice(0, 80)}" (title match not confirmed)`;
    }
    await new Promise((r) => setTimeout(r, 900));
  }
  return { loaded: false, detail: lastDetail };
}

/**
 * Search YouTube, UNDERSTAND which result matches the request, open it in the
 * user's REAL browser and VERIFY what is observable. Order of honesty:
 *   1. best-matching result + tab title confirms → "Playing …"
 *   2. best-matching result, title not confirmable → say exactly that
 *   3. no confident match → open the search page and say so
 * The first result is never blindly trusted.
 */
export async function playFirstYouTubeResult(query: string): Promise<ActionVerification> {
  if (!query.trim()) {
    return fail("I don't know what to play — the search was empty.", [], "empty-query");
  }

  const results = await searchYouTubeResults(query);
  const pick = pickBestYouTubeResult(results, query);
  // Only auto-play a result we actually UNDERSTOOD — a confident title match
  // for what was asked. An unrelated video opened silently is precisely the
  // old "searched but didn't understand the song" failure.
  if (pick && pick.confident) {
    const chosen = pick.best;
    const matchedNote = chosen.title
      ? `matched "${query}" → "${chosen.title}"`
      : `matched "${query}" → video ${chosen.videoId}`;
    const watchUrl = `https://www.youtube.com/watch?v=${chosen.videoId}`;
    const opened = await openBrowserSurface(watchUrl);
    if (opened.ok) {
      contextStore.update({ lastMediaQuery: query, activeWebsite: "youtube" });
      const check = chosen.title
        ? await verifyVideoLoaded(chosen.title)
        : { loaded: false, detail: "no title available from search — cannot verify" };
      const evidence = [matchedNote, check.detail];
      if (check.loaded) {
        return ok(
          chosen.title
            ? `Playing "${chosen.title}" on YouTube.`
            : `Playing the top match for "${query}" on YouTube.`,
          evidence
        );
      }
      return ok(
        chosen.title
          ? `Opened "${chosen.title}" in your browser — I can't see inside your browser, so press play once if it didn't start.`
          : `Opened the match for "${query}" in your browser — playback not confirmed.`,
        evidence
      );
    }
    // Surface failed — fall through to the search page.
  }

  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  const opened = await openBrowserSurface(searchUrl);
  contextStore.update({ lastMediaQuery: query, activeWebsite: "youtube" });
  return opened.ok
    ? ok(
        `Opened YouTube search results for "${query}" — no result clearly matched, so I didn't auto-pick one.`,
        ["no confident result match", "search page opened"]
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
    // Both branches return the actual page text — never drop the content.
    const body = text.slice(0, 20000);
    contextStore.update({ activeUrl: url });
    return ok(
      body,
      text.length > 20000
        ? [`reader: r.jina.ai`, `url: ${url}`, `full length: ${text.length} chars — showing the first 20000`]
        : [`reader: r.jina.ai`, `url: ${url}`],
    );
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
