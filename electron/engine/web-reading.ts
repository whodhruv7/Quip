// Quip Execution Engine V3 — Web Reading (Agent-Reach recipes, real HTTP)
// ─────────────────────────────────────────────────────────────────────────────
// Port of Zekiog/agent-reach's reading channels — no wrapper process, the
// same recipes implemented natively:
//   youtube_read  — video metadata via oEmbed; search-result reading via the
//                   Jina reader (Agent-Reach web.py recipe, already trusted)
//   reddit_read   — reddit's public JSON endpoints (channels/reddit.py)
//   rss_read      — RSS/Atom feed parsing (channels/rss.py)
//
// Every fetch passes the same SSRF safe-URL gate as the browser layer,
// carries a short timeout, and reports failure honestly. These tools give
// the agent internet INFORMATION — desktop control stays with the device
// layer (the Agent-Reach boundary, respected by design).
// ─────────────────────────────────────────────────────────────────────────────

import { isSafePublicUrl } from "./browser-automation";

const FETCH_TIMEOUT_MS = 15_000;
const UA = "Quip/1.0 (+https://github.com/whodhruv7/Quip; companion assistant)";

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n… (truncated)`;
}

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "User-Agent": UA, ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) throw new Error(`http-${res.status}`);
  return res.text();
}

export interface ReadResult {
  ok: boolean;
  summary: string;
  evidence: string[];
}

// ─── YouTube ─────────────────────────────────────────────────────────────────

/** Video metadata without a browser: public oEmbed, no key needed. */
async function youtubeVideoInfo(videoUrl: string): Promise<ReadResult> {
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`;
  const raw = await fetchText(endpoint);
  const data = JSON.parse(raw) as { title?: string; author_name?: string };
  return {
    ok: true,
    summary: `Video: "${data.title ?? "unknown title"}" by ${data.author_name ?? "unknown channel"}.`,
    evidence: ["youtube oembed", videoUrl],
  };
}

export async function youtubeRead(queryOrUrl: string): Promise<ReadResult> {
  const input = (queryOrUrl ?? "").trim();
  if (!input) {
    return { ok: false, summary: "I need a YouTube link or something to look up.", evidence: [] };
  }

  // Direct video URL/ID → oEmbed metadata (fast, reliable).
  const urlMatch = input.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{6,})/);
  if (urlMatch) {
    try {
      return await youtubeVideoInfo(`https://www.youtube.com/watch?v=${urlMatch[1]}`);
    } catch (e: any) {
      return {
        ok: false,
        summary: `I couldn't read that video's info — ${e?.message ?? e}. If it's a private or deleted video, that's expected.`,
        evidence: ["youtube oembed failed"],
      };
    }
  }

  // Search query → read the results page via the reader (Agent-Reach recipe).
  const gate = isSafePublicUrl(`https://www.youtube.com/results?search_query=${encodeURIComponent(input)}`);
  if (!gate.safe) {
    return { ok: false, summary: "That search was blocked for safety.", evidence: [] };
  }
  try {
    const text = await fetchText(`https://r.jina.ai/https://www.youtube.com/results?search_query=${encodeURIComponent(input)}`);
    if (!text || text.length < 40) throw new Error("empty results");
    return {
      ok: true,
      summary: `Top of YouTube results for "${input}":\n${truncate(text.replace(/\s+\n/g, "\n"), 1500)}`,
      evidence: ["youtube search page read via r.jina.ai"],
    };
  } catch (e: any) {
    return {
      ok: false,
      summary: `I couldn't read YouTube results — ${e?.message ?? e}. I can still open the search in your browser if you want.`,
      evidence: ["reader fetch failed"],
    };
  }
}

// ─── Reddit ──────────────────────────────────────────────────────────────────

interface RedditPost {
  title: string;
  subreddit: string;
  score: number;
  url: string;
}

function parseRedditJson(raw: string, limit: number): RedditPost[] {
  const data = JSON.parse(raw) as any;
  const children = data?.data?.children ?? [];
  return children.slice(0, limit).map((c: any) => ({
    title: String(c?.data?.title ?? "").slice(0, 160),
    subreddit: String(c?.data?.subreddit ?? ""),
    score: Number(c?.data?.score ?? 0),
    url: c?.data?.permalink ? `https://www.reddit.com${c.data.permalink}` : String(c?.data?.url ?? ""),
  }));
}

function formatPosts(posts: RedditPost[], header: string): ReadResult {
  if (posts.length === 0) {
    return { ok: false, summary: `${header} — nothing came back (the sub may be private or the query too specific).`, evidence: [] };
  }
  return {
    ok: true,
    summary:
      `${header}\n` +
      posts.map((p, i) => `${i + 1}. [↑${p.score}] r/${p.subreddit}: ${p.title}`).join("\n"),
    evidence: [`reddit json`, `${posts.length} posts`],
  };
}

/** Read posts from a subreddit or search results (public JSON API). */
export async function redditRead(subredditOrQuery: string): Promise<ReadResult> {
  const input = (subredditOrQuery ?? "").trim().replace(/^r\//i, "");
  if (!input) {
    return { ok: false, summary: "Tell me which subreddit to read or what to search on Reddit.", evidence: [] };
  }
  const endpoint = input.includes(" ")
    ? `https://www.reddit.com/search.json?q=${encodeURIComponent(input)}&limit=10`
    : `https://www.reddit.com/r/${encodeURIComponent(input)}/hot.json?limit=10`;
  const gate = isSafePublicUrl(endpoint);
  if (!gate.safe) {
    return { ok: false, summary: "That Reddit address was blocked for safety.", evidence: [] };
  }
  try {
    const raw = await fetchText(endpoint);
    const posts = parseRedditJson(raw, 10);
    return formatPosts(
      posts,
      input.includes(" ") ? `Reddit results for "${input}":` : `Hot posts on r/${input}:`
    );
  } catch (e: any) {
    return {
      ok: false,
      summary: `I couldn't read Reddit — ${e?.message ?? e}. Reddit sometimes blocks bots; I can open it in your browser instead.`,
      evidence: ["reddit json fetch failed"],
    };
  }
}

// ─── RSS / Atom ──────────────────────────────────────────────────────────────

interface FeedEntry {
  title: string;
  link: string;
}

function extractFeedEntries(xml: string, limit: number): FeedEntry[] {
  const out: FeedEntry[] = [];
  const blocks = xml.match(/<(?:item|entry)[\s\S]*?<\/(?:item|entry)>/g) ?? [];
  for (const block of blocks.slice(0, limit)) {
    const title = block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1]?.trim() ?? "";
    const link =
      block.match(/<link[^>]*href="([^"]+)"/)?.[1] ??
      block.match(/<link[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/)?.[1]?.trim() ??
      "";
    if (title) out.push({ title: title.slice(0, 160), link });
  }
  return out;
}

export async function rssRead(rawUrl: string): Promise<ReadResult> {
  const gate = isSafePublicUrl(rawUrl ?? "");
  if (!gate.safe) {
    return { ok: false, summary: "I won't read that feed URL — it doesn't look like a safe public address.", evidence: [] };
  }
  try {
    const xml = await fetchText(gate.url!);
    const entries = extractFeedEntries(xml, 10);
    if (entries.length === 0) {
      return {
        ok: false,
        summary: "That address didn't look like an RSS/Atom feed (no entries found). Check the feed URL.",
        evidence: [`fetched ${gate.url}`],
      };
    }
    return {
      ok: true,
      summary: `Latest from the feed:\n${entries.map((e, i) => `${i + 1}. ${e.title}${e.link ? ` — ${e.link}` : ""}`).join("\n")}`,
      evidence: [`feed: ${gate.url}`, `${entries.length} entries`],
    };
  } catch (e: any) {
    return {
      ok: false,
      summary: `I couldn't read that feed — ${e?.message ?? e}.`,
      evidence: ["feed fetch failed"],
    };
  }
}
