"use strict";
// Quip Execution Engine — Browser / Website Automation
// ─────────────────────────────────────────────────────────────────────────────
// Website understanding + interaction:
//   - Safe-URL gate (SSRF protection — ported from Agent-Reach's URL guard)
//   - openBrowserSurface / navigateBrowser — focused Quip-controlled window
//   - searchYouTube / playFirstYouTubeResult — real playback, verified
//   - readWebPage — Agent-Reach "reach the web" port (r.jina.ai reader)
// ─────────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSafePublicUrl = isSafePublicUrl;
exports.openBrowserSurface = openBrowserSurface;
exports.navigateBrowser = navigateBrowser;
exports.focusBrowserSurface = focusBrowserSurface;
exports.hasBrowserSurface = hasBrowserSurface;
exports.extractYouTubeResults = extractYouTubeResults;
exports.scoreYouTubeResult = scoreYouTubeResult;
exports.pickBestYouTubeResult = pickBestYouTubeResult;
exports.searchYouTubeResults = searchYouTubeResults;
exports.playFirstYouTubeResult = playFirstYouTubeResult;
exports.readWebPage = readWebPage;
const electron_1 = require("electron");
const action_verifier_1 = require("./action-verifier");
const window_policy_1 = require("./window-policy");
const context_store_1 = require("./context-store");
// ─── URL safety gate (Agent-Reach port) ──────────────────────────────────────
const PRIVATE_HOST_RE = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/i;
function isSafePublicUrl(rawUrl) {
    let parsed;
    try {
        parsed = new URL(rawUrl);
    }
    catch {
        return { safe: false, reason: "malformed URL" };
    }
    if (parsed.protocol === "file:")
        return { safe: false, reason: "file:// URLs are not allowed" };
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
let taskSurface = null;
function createSurface(url) {
    const bounds = (0, window_policy_1.computeBrowserWindowBounds)((0, window_policy_1.quipOverlayRect)());
    const win = new electron_1.BrowserWindow({
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
        if (taskSurface === win)
            taskSurface = null;
    });
    return win;
}
/** Open a URL in Quip's focused browser surface (or the OS browser on failure). */
async function openBrowserSurface(rawUrl) {
    const gate = isSafePublicUrl(rawUrl);
    if (!gate.safe) {
        return (0, action_verifier_1.fail)(`I won't open that URL — ${gate.reason}.`, [`blocked: ${rawUrl}`], "unsafe-url");
    }
    const url = gate.url;
    try {
        if (taskSurface && !taskSurface.isDestroyed()) {
            await taskSurface.loadURL(url);
            taskSurface.show();
            taskSurface.focus();
            taskSurface.moveTop();
        }
        else {
            taskSurface = createSurface(url);
        }
        context_store_1.contextStore.update({ activeUrl: url, activeWebsite: hostnameOf(url) });
        return (0, action_verifier_1.ok)(`Opened ${hostnameOf(url)} in a browser window.`, [`loaded ${url}`, "surface focused"]);
    }
    catch (e) {
        // Fallback: OS browser via shell (wired in tool-registry to avoid import cycle)
        return (0, action_verifier_1.fail)(`The browser window failed to open.`, [`error: ${String(e?.message ?? e)}`], "surface-failed");
    }
}
async function navigateBrowser(rawUrl) {
    return openBrowserSurface(rawUrl);
}
/** Re-focus the existing browser surface (used after navigation). */
function focusBrowserSurface() {
    if (taskSurface && !taskSurface.isDestroyed()) {
        taskSurface.show();
        taskSurface.focus();
        taskSurface.moveTop();
    }
}
function hasBrowserSurface() {
    return !!taskSurface && !taskSurface.isDestroyed();
}
function hostnameOf(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    }
    catch {
        return url;
    }
}
const VIDEO_RENDERER_RE = /"videoRenderer":\{"videoId":"([\w-]{11})".{0,800}?"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/g;
function unescapeJsonString(s) {
    try {
        return JSON.parse(`"${s}"`);
    }
    catch {
        return s.replace(/\\u0026/g, "&").replace(/\\"/g, '"');
    }
}
/**
 * Extract the ORGANIC video results (id + title) from a YouTube search page.
 * Only "videoRenderer" entries are taken — ads, channels, playlists and
 * shelves use different renderer keys, so they never pollute the results.
 */
function extractYouTubeResults(html, max = 10) {
    const results = [];
    const seen = new Set();
    VIDEO_RENDERER_RE.lastIndex = 0;
    let m;
    while ((m = VIDEO_RENDERER_RE.exec(html)) && results.length < max) {
        const videoId = m[1];
        if (seen.has(videoId))
            continue;
        seen.add(videoId);
        const title = unescapeJsonString(m[2]).replace(/\s+/g, " ").trim();
        if (title)
            results.push({ videoId, title });
    }
    return results;
}
/**
 * Score how well a result title matches what the user asked for.
 * Positive: token overlap, exact/substring title, official audio markers.
 * Negative: covers, live, reactions, remixes, full-album dumps — things
 * that are NOT the requested song.
 */
function scoreYouTubeResult(title, query) {
    const t = title.toLowerCase();
    const q = query.toLowerCase().trim();
    if (!q || !t)
        return 0;
    const qTokens = q.split(/\s+/).filter(Boolean);
    const tTokens = new Set(t.split(/[^a-z0-9]+/).filter(Boolean));
    let overlap = 0;
    for (const w of qTokens)
        if (tTokens.has(w))
            overlap++;
    let score = overlap / qTokens.length;
    if (t === q)
        score += 0.5;
    else if (t.includes(q))
        score += 0.3;
    const strong = qTokens.filter((w) => w.length >= 3);
    if (strong.length) {
        const strongHits = strong.filter((w) => tTokens.has(w)).length;
        score += 0.2 * (strongHits / strong.length);
    }
    if (/\b(live|cover|reaction|remix|mashup|karaoke|tutorial|lesson|8d|slowed|sped up)\b/.test(t))
        score -= 0.15;
    if (/\b(full album|all songs|jukebox|playlist|mix|top \d+)\b/.test(t))
        score -= 0.2;
    if (/\b(official (audio|video|music video)|lyrical? video|topic)\b/.test(t))
        score += 0.12;
    if (/\bvideo song\b|\bfull video\b/.test(t) && /\b(song|gaana)\b/.test(q))
        score += 0.05;
    return score;
}
/**
 * Pick the result that actually IS what the user asked for — not blindly the
 * first one. Returns null when no result is a confident match.
 */
function pickBestYouTubeResult(results, query) {
    if (results.length === 0)
        return null;
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
async function searchYouTubeResults(query) {
    try {
        const res = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } });
        const html = await res.text();
        const results = extractYouTubeResults(html);
        if (results.length > 0)
            return results;
        // Fallback: bare first-videoId scrape (no titles available)
        const match = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
        return match ? [{ videoId: match[1], title: "" }] : [];
    }
    catch {
        return [];
    }
}
async function probePlayback(surface) {
    try {
        const state = (await surface.webContents.executeJavaScript(`(function(){
        var v = document.querySelector('video.html5-main-video') || document.querySelector('video');
        if (!v) return { found: false };
        return { found: true, paused: !!v.paused, ended: !!v.ended, time: v.currentTime || 0, duration: v.duration || 0 };
      })()`, true));
        if (!state?.found)
            return { found: false, playing: false, detail: "no video element yet" };
        const playing = !state.paused && !state.ended;
        const t = typeof state.time === "number" ? state.time.toFixed(1) : "0";
        return {
            found: true,
            playing,
            detail: playing
                ? `video element present, playing at ${t}s`
                : `video present but ${state.ended ? "ended" : "paused"}`,
        };
    }
    catch {
        return { found: false, playing: false, detail: "page probe unavailable" };
    }
}
/**
 * Wait for real playback on the YouTube surface; nudge the play button once
 * if the video is still paused. Never fabricates success — the caller
 * receives an honest playing/not-verified verdict.
 */
async function ensurePlayback(surface, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    let nudged = false;
    let last = { found: false, playing: false, detail: "not probed" };
    while (Date.now() < deadline) {
        last = await probePlayback(surface);
        if (last.playing)
            return last;
        if (last.found && !last.playing && !nudged) {
            // One honest nudge: click the YouTube play button / resume the element.
            try {
                await surface.webContents.executeJavaScript(`(function(){
            var v = document.querySelector('video.html5-main-video') || document.querySelector('video');
            if (v && v.paused) {
              var btn = document.querySelector('.ytp-large-play-button');
              if (btn) btn.click();
              var p = v.play();
              if (p && p.catch) p.catch(function(){});
            }
          })()`, true);
            }
            catch {
                /* nudge is best-effort */
            }
            nudged = true;
            await new Promise((r) => setTimeout(r, 1500));
            continue;
        }
        await new Promise((r) => setTimeout(r, 700));
    }
    return last;
}
/**
 * Search YouTube, UNDERSTAND which result matches the request, open it and
 * VERIFY playback. Order of honesty:
 *   1. best-matching result + verified playing → "Playing …"
 *   2. best-matching result, playback not confirmable → say exactly that
 *   3. no confident match → open the search page and say so
 * The first result is never blindly trusted.
 */
async function playFirstYouTubeResult(query) {
    if (!query.trim()) {
        return (0, action_verifier_1.fail)("I don't know what to play — the search was empty.", [], "empty-query");
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
            context_store_1.contextStore.update({ lastMediaQuery: query, activeWebsite: "youtube" });
            const surface = taskSurface;
            if (surface && !surface.isDestroyed()) {
                const playback = await ensurePlayback(surface);
                const evidence = [matchedNote, `video ${chosen.videoId} — ${playback.detail}`];
                if (playback.playing) {
                    return (0, action_verifier_1.ok)(chosen.title
                        ? `Playing "${chosen.title}" on YouTube.`
                        : `Playing the top match for "${query}" on YouTube.`, evidence);
                }
                return (0, action_verifier_1.ok)(chosen.title
                    ? `Opened "${chosen.title}" on YouTube — I couldn't confirm playback started (it may need one click).`
                    : `Opened the match for "${query}" on YouTube — playback not confirmed.`, evidence);
            }
            return (0, action_verifier_1.ok)(chosen.title
                ? `Opened "${chosen.title}" on YouTube.`
                : `Opened the match for "${query}" on YouTube.`, [matchedNote]);
        }
        // Surface failed — fall through to the search page.
    }
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const opened = await openBrowserSurface(searchUrl);
    context_store_1.contextStore.update({ lastMediaQuery: query, activeWebsite: "youtube" });
    return opened.ok
        ? (0, action_verifier_1.ok)(`Opened YouTube search results for "${query}" — no result clearly matched, so I didn't auto-pick one.`, ["no confident result match", "search page opened"])
        : (0, action_verifier_1.fail)(`I couldn't open YouTube for "${query}".`, ["both direct and search failed"], "youtube-failed");
}
// ─── Web reading (Agent-Reach "reach" port) ──────────────────────────────────
/** Read a public web page as clean text via the Jina reader fallback chain. */
async function readWebPage(rawUrl) {
    const gate = isSafePublicUrl(rawUrl);
    if (!gate.safe) {
        return (0, action_verifier_1.fail)(`I won't read that URL — ${gate.reason}.`, [`blocked: ${rawUrl}`], "unsafe-url");
    }
    const url = gate.url;
    try {
        const res = await fetch(`https://r.jina.ai/${url}`, { signal: AbortSignal.timeout(20000) });
        if (!res.ok)
            throw new Error(`reader-http-${res.status}`);
        const text = await res.text();
        if (!text || text.length < 20)
            throw new Error("empty content");
        // Both branches return the actual page text — never drop the content.
        const body = text.slice(0, 20000);
        context_store_1.contextStore.update({ activeUrl: url });
        return (0, action_verifier_1.ok)(body, text.length > 20000
            ? [`reader: r.jina.ai`, `url: ${url}`, `full length: ${text.length} chars — showing the first 20000`]
            : [`reader: r.jina.ai`, `url: ${url}`]);
    }
    catch (e) {
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
                return (0, action_verifier_1.ok)(text.slice(0, 20000), ["reader: direct fetch", `url: ${url}`]);
            }
            throw new Error("empty after strip");
        }
        catch {
            return (0, action_verifier_1.fail)(`I couldn't read ${hostnameOf(url)}.`, [`error: ${String(e?.message ?? e)}`], "read-failed");
        }
    }
}
//# sourceMappingURL=browser-automation.js.map