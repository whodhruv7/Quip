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

// ─── GitHub (Agent-Reach github channel, public API — no auth needed) ───────

interface RepoSummary {
  full_name: string;
  description: string;
  stars: number;
  forks: number;
  language: string;
  updated: string;
  topics: string[];
}

function parseRepo(data: any): RepoSummary {
  return {
    full_name: String(data?.full_name ?? "?"),
    description: String(data?.description ?? "no description"),
    stars: Number(data?.stargazers_count ?? 0),
    forks: Number(data?.forks_count ?? 0),
    language: String(data?.language ?? "?"),
    updated: String(data?.pushed_at ?? data?.updated_at ?? "?").slice(0, 10),
    topics: Array.isArray(data?.topics) ? data.topics.slice(0, 6) : [],
  };
}

function formatRepo(r: RepoSummary): string {
  const topics = r.topics.length ? ` | topics: ${r.topics.join(", ")}` : "";
  return `${r.full_name} — ★${r.stars} · forks ${r.forks} · ${r.language} · pushed ${r.updated}${topics}\n${r.description}`;
}

/**
 * Read a GitHub repo (metadata + README head) or search repos.
 * Public API, real HTTP — an upgrade over Agent-Reach's gh-CLI-only channel
 * because it needs zero local tools.
 */
export async function githubRead(queryOrUrl: string): Promise<ReadResult> {
  const input = (queryOrUrl ?? "").trim();
  if (!input) {
    return { ok: false, summary: "Give me a GitHub repo link or something to search for.", evidence: [] };
  }

  // owner/repo or a github.com URL → repo metadata + README head.
  const urlMatch = input.match(/github\.com\/([\w.-]+)\/([\w.-]+)/);
  const repoMatch = urlMatch ?? input.match(/^([\w.-]+)\/([\w.-]+)$/);

  if (repoMatch) {
    const owner = repoMatch[1].replace(/\.git$/, "");
    const repo = repoMatch[2].replace(/\.git$/, "");
    const metaUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const gate = isSafePublicUrl(metaUrl);
    if (!gate.safe) return { ok: false, summary: "That GitHub address was blocked for safety.", evidence: [] };
    try {
      const data = JSON.parse(await fetchText(gate.url!, { headers: { Accept: "application/vnd.github+json" } }));
      if (data?.message) throw new Error(data.message);
      const r = parseRepo(data);
      let readme = "";
      try {
        const raw = await fetchText(`https://raw.githubusercontent.com/${r.full_name}/HEAD/README.md`);
        readme = `\n\nREADME (first part):\n${truncate(raw.replace(/\s+\n/g, "\n"), 900)}`;
      } catch {
        /* README optional */
      }
      return {
        ok: true,
        summary: `${formatRepo(r)}${readme}`,
        evidence: ["github api", r.full_name],
      };
    } catch (e: any) {
      const notFound = /not found|404/i.test(String(e?.message ?? e));
      return {
        ok: false,
        summary: notFound
          ? `I couldn't find ${owner}/${repo} — check the owner/repo spelling (private repos aren't readable without a token).`
          : `GitHub read failed — ${e?.message ?? e}.`,
        evidence: ["github api fetch failed"],
      };
    }
  }

  // Otherwise: repo search.
  const searchUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(input)}&per_page=6&sort=stars`;
  const gate = isSafePublicUrl(searchUrl);
  if (!gate.safe) return { ok: false, summary: "That search was blocked for safety.", evidence: [] };
  try {
    const data = JSON.parse(await fetchText(gate.url!, { headers: { Accept: "application/vnd.github+json" } }));
    const items: RepoSummary[] = (data?.items ?? []).map(parseRepo);
    if (items.length === 0) {
      return { ok: false, summary: `No GitHub repos matched "${input}".`, evidence: ["github search"] };
    }
    return {
      ok: true,
      summary:
        `Top GitHub repos for "${input}":\n` +
        items.map((r, i) => `${i + 1}. ${formatRepo(r)}`).join("\n"),
      evidence: ["github search api", `${items.length} repos`],
    };
  } catch (e: any) {
    return {
      ok: false,
      summary: `GitHub search failed — ${e?.message ?? e}. GitHub rate-limits anonymous searches; try again in a bit.`,
      evidence: ["github search fetch failed"],
    };
  }
}

// ─── V2EX (Agent-Reach v2ex channel — public API) ────────────────────────────

/** Hot topics or a node's latest topics on V2EX. */
export async function v2exRead(nodeOrEmpty: string): Promise<ReadResult> {
  const node = (nodeOrEmpty ?? "").trim().replace(/^\/?node\//i, "");
  const endpoint = node
    ? `https://www.v2ex.com/api/topics/show.json?node_name=${encodeURIComponent(node)}`
    : "https://www.v2ex.com/api/topics/hot.json";
  const gate = isSafePublicUrl(endpoint);
  if (!gate.safe) return { ok: false, summary: "That V2EX address was blocked for safety.", evidence: [] };
  try {
    const data = JSON.parse(await fetchText(gate.url!)) as any[];
    const topics = (Array.isArray(data) ? data : []).slice(0, 10).map((t) => ({
      title: String(t?.title ?? "").slice(0, 140),
      replies: Number(t?.replies ?? 0),
      node: String(t?.node?.title ?? t?.node?.name ?? ""),
      url: String(t?.url ?? ""),
      content: String(t?.content ?? "").slice(0, 120),
    }));
    if (topics.length === 0) {
      return { ok: false, summary: node ? `No V2EX topics found for node "${node}".` : "V2EX returned no hot topics right now.", evidence: ["v2ex api"] };
    }
    return {
      ok: true,
      summary:
        (node ? `Latest on V2EX node "${node}":` : "V2EX hot topics:") + "\n" +
        topics.map((t, i) => `${i + 1}. [${t.node}] ${t.title} (${t.replies} replies)`).join("\n"),
      evidence: ["v2ex public api", `${topics.length} topics`],
    };
  } catch (e: any) {
    return {
      ok: false,
      summary: `I couldn't read V2EX — ${e?.message ?? e}. It may be blocked from your network.`,
      evidence: ["v2ex fetch failed"],
    };
  }
}

// ─── Bilibili (Agent-Reach bilibili channel — public search API backend) ────

/** Search Bilibili videos (public search API; subtitles need a login — honest). */
export async function bilibiliRead(query: string): Promise<ReadResult> {
  const q = (query ?? "").trim();
  if (!q) return { ok: false, summary: "Tell me what to search on Bilibili.", evidence: [] };
  const endpoint = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(q)}`;
  const gate = isSafePublicUrl(endpoint);
  if (!gate.safe) return { ok: false, summary: "That Bilibili request was blocked for safety.", evidence: [] };
  try {
    const raw = await fetchText(gate.url!, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Quip/1.0", Referer: "https://www.bilibili.com" },
    });
    const data = JSON.parse(raw);
    if (Number(data?.code) !== 0) throw new Error(String(data?.message ?? `api code ${data?.code}`));
    const rows: any[] = data?.data?.result ?? [];
    const videos = rows.slice(0, 8).map((v) => ({
      title: String(v?.title ?? "").replace(/<[^>]+>/g, "").slice(0, 120),
      author: String(v?.author ?? ""),
      play: Number(v?.play ?? 0),
      bvid: String(v?.bvid ?? ""),
    }));
    if (videos.length === 0) {
      return { ok: false, summary: `No Bilibili videos matched "${q}".`, evidence: ["bilibili api"] };
    }
    return {
      ok: true,
      summary:
        `Top Bilibili videos for "${q}":\n` +
        videos
          .map((v, i) => `${i + 1}. ${v.title} — ${v.author} · ${v.play} plays${v.bvid ? ` · https://bilibili.com/video/${v.bvid}` : ""}`)
          .join("\n") +
        "\n(Subtitles need a Bilibili login — I can't read them without one.)",
      evidence: ["bilibili search api", `${videos.length} videos`],
    };
  } catch (e: any) {
    return {
      ok: false,
      summary: `Bilibili search failed — ${e?.message ?? e}. Their API sometimes challenges bots; I can open it in your browser instead.`,
      evidence: ["bilibili fetch failed"],
    };
  }
}

// ─── X / Twitter single tweet (Agent-Reach twitter channel, no-auth backend) ─

/** Read one tweet by link via the public syndication endpoint, with an
 *  honest fallback note. Search/timelines still need a paid API — refused. */
export async function tweetRead(queryOrUrl: string): Promise<ReadResult> {
  const input = (queryOrUrl ?? "").trim();
  const idMatch = input.match(/(?:x\.com|twitter\.com)\/[\w]+\/(?:status|statuses)\/(\d{5,25})/);
  if (!idMatch) {
    return {
      ok: false,
      summary: "I can read a single tweet if you paste its link (x.com/…/status/…). Searching all of X needs a paid API I don't have — that one I can't do.",
      evidence: [],
    };
  }
  const id = idMatch[1];
  // Public syndication endpoint (what X embeds use) — no key needed.
  const gate = isSafePublicUrl(`https://cdn.syndication.twimg.com/tweet-result`);
  if (!gate.safe) return { ok: false, summary: "That tweet address was blocked for safety.", evidence: [] };
  for (const token of ["a", "x"]) {
    try {
      const raw = await fetchText(
        `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}&lang=en`,
        { headers: { Accept: "application/json" } }
      );
      const data = JSON.parse(raw);
      if (data?.text) {
        const author = String(data?.user?.name ?? data?.user?.screen_name ?? "unknown");
        const when = String(data?.created_at ?? "");
        return {
          ok: true,
          summary: `Tweet by ${author}${when ? ` (${when.slice(0, 10)})` : ""}:\n${truncate(String(data.text), 800)}`,
          evidence: ["x syndication endpoint", `id ${id}`],
        };
      }
    } catch {
      /* try next token shape */
    }
  }
  // Fallback: read the embed page through the Agent-Reach reader recipe.
  try {
    const text = await fetchText(`https://r.jina.ai/https://x.com/_/status/${id}`);
    if (text && text.length > 40) {
      return {
        ok: true,
        summary: `Tweet content (via reader):\n${truncate(text.replace(/\s+\n/g, "\n"), 800)}`,
        evidence: ["r.jina.ai fallback"],
      };
    }
  } catch {
    /* honest failure below */
  }
  return {
    ok: false,
    summary: "I couldn't read that tweet — X blocks most no-key readers. Opening it in your browser will work.",
    evidence: ["syndication + reader failed"],
  };
}
