// Quip Execution Engine V2 — Intent Understanding Engine
// ─────────────────────────────────────────────────────────────────────────────
// Natural language → correct intent → correct target → correct action.
//
// Design:
//   1. Normalize (strip filler, keep meaning)
//   2. Extract ACTION (open/play/search/close/focus/type/click/scroll/...)
//   3. Extract TARGET (app / site / folder / URL) via WORD-BOUNDARY matching
//      (fixes the old substring bug where "x" matched "mix playlist")
//   4. What's LEFT is the QUERY ("mitwa", "invoice.pdf")
//   5. Use short-term context for follow-ups: "play it", "search this"
//   6. Multi-step planning: "open youtube and play mitwa" → 2 steps
//   7. Low confidence → orchestrator escalates to the model (compact schema)
// ─────────────────────────────────────────────────────────────────────────────

import type { ExecutionContextState } from "./context-store";

export type ActionType =
  | "open_app"
  | "open_website"
  | "open_url"
  | "open_folder"
  | "open_file"
  | "play_media"
  | "search_web"
  | "search_youtube"
  | "compose_email"
  | "compose_message"
  | "focus_app"
  | "close_app"
  | "type_text"
  | "press_key"
  | "click"
  | "scroll"
  | "clipboard"
  | "read_page"
  | "window_control"
  | "screen"
  | "windows_list"
  | "file_op"
  | "site_search"
  | "system_action"
  | "drag"
  | "mouse_move"
  | "chat";

export interface TaskStep {
  action: ActionType;
  target: string;
  params: Record<string, string>;
  description: string;
}

export interface ParsedIntent {
  original: string;
  normalized: string;
  action: string;
  target: string;
  query: string;
  isTask: boolean;
  isMultiStep: boolean;
  steps: TaskStep[];
  summary: string;
  confidence: number;
  /** true when the deterministic parser is unsure → orchestrator may ask the model */
  needsModelAssist?: boolean;
}

export interface ParseOptions {
  context?: ExecutionContextState;
  workspacePath?: string;
}

// ─── Alias tables ────────────────────────────────────────────────────────────

const APP_HINTS: Record<string, string> = {
  "vs code": "Visual Studio Code",
  vscode: "Visual Studio Code",
  "visual studio code": "Visual Studio Code",
  code: "Visual Studio Code",
  cursor: "Cursor",
  terminal: "Terminal",
  cmd: "Command Prompt",
  "command prompt": "Command Prompt",
  powershell: "PowerShell",
  calculator: "Calculator",
  calc: "Calculator",
  notepad: "Notepad",
  spotify: "Spotify",
  "file explorer": "File Explorer",
  explorer: "File Explorer",
  files: "File Explorer",
  settings: "Settings",
  chrome: "Google Chrome",
  edge: "Microsoft Edge",
  firefox: "Firefox",
  brave: "Brave",
  whatsapp: "WhatsApp",
  discord: "Discord",
  slack: "Slack",
  telegram: "Telegram",
  zoom: "Zoom",
  outlook: "Outlook",
  word: "Microsoft Word",
  excel: "Microsoft Excel",
  powerpoint: "Microsoft PowerPoint",
  teams: "Microsoft Teams",
  steam: "Steam",
  postman: "Postman",
  figma: "Figma",
  "android studio": "Android Studio",
  intellij: "IntelliJ IDEA",
  pycharm: "PyCharm",
  obs: "OBS Studio",
  vlc: "VLC",
  photoshop: "Adobe Photoshop",
};

const SITE_HINTS: Record<string, { url: string; label: string }> = {
  youtube: { url: "https://www.youtube.com", label: "YouTube" },
  yt: { url: "https://www.youtube.com", label: "YouTube" },
  "youtube music": { url: "https://music.youtube.com", label: "YouTube Music" },
  gmail: { url: "https://mail.google.com", label: "Gmail" },
  mail: { url: "https://mail.google.com", label: "Gmail" },
  email: { url: "https://mail.google.com", label: "Gmail" },
  google: { url: "https://www.google.com", label: "Google" },
  github: { url: "https://github.com", label: "GitHub" },
  chatgpt: { url: "https://chat.openai.com", label: "ChatGPT" },
  openai: { url: "https://chat.openai.com", label: "ChatGPT" },
  claude: { url: "https://claude.ai", label: "Claude" },
  whatsapp: { url: "https://web.whatsapp.com", label: "WhatsApp" },
  instagram: { url: "https://www.instagram.com", label: "Instagram" },
  twitter: { url: "https://x.com", label: "X" },
  x: { url: "https://x.com", label: "X" },
  linkedin: { url: "https://www.linkedin.com", label: "LinkedIn" },
  notion: { url: "https://www.notion.so", label: "Notion" },
  figma: { url: "https://www.figma.com", label: "Figma" },
  discord: { url: "https://discord.com/app", label: "Discord" },
  reddit: { url: "https://www.reddit.com", label: "Reddit" },
  netflix: { url: "https://www.netflix.com", label: "Netflix" },
  drive: { url: "https://drive.google.com", label: "Google Drive" },
  "google drive": { url: "https://drive.google.com", label: "Google Drive" },
  docs: { url: "https://docs.google.com", label: "Google Docs" },
  "google docs": { url: "https://docs.google.com", label: "Google Docs" },
  calendar: { url: "https://calendar.google.com", label: "Calendar" },
  maps: { url: "https://www.google.com/maps", label: "Maps" },
  perplexity: { url: "https://www.perplexity.ai", label: "Perplexity" },
};

const FOLDER_HINTS: Record<string, string> = {
  downloads: "downloads",
  download: "downloads",
  desktop: "desktop",
  documents: "documents",
  document: "documents",
  pictures: "pictures",
  photos: "pictures",
  music: "music",
  videos: "videos",
};

// ─── Word-boundary matching (fixes substring false positives) ────────────────

function matchHint(
  text: string,
  table: Record<string, any>
): { key: string; value: any } | null {
  const words = text.split(/\s+/).filter(Boolean);
  // match multi-word keys first
  const keys = Object.keys(table).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (key.includes(" ")) {
      if (text.includes(key)) return { key, value: table[key] };
    }
  }
  for (const word of words) {
    if (table[word]) return { key: word, value: table[word] };
  }
  return null;
}

// ─── Normalization ───────────────────────────────────────────────────────────

const FILLER_WORDS = [
  "can you", "could you", "would you", "please", "kindly",
  "i want to", "i want", "i need to", "i need", "help me", "just",
  "let's", "lets",
];

function normalizeCommand(raw: string): string {
  let text = raw.toLowerCase().trim();
  // Strip polite fillers ONLY at the start (and a trailing "please").
  // A global strip corrupts content — "play i want it that way" must keep
  // the song name intact, not lose "i want".
  let changed = true;
  while (changed) {
    changed = false;
    for (const filler of FILLER_WORDS) {
      if (text === filler) {
        text = "";
        changed = true;
        break;
      }
      if (text.startsWith(filler + " ")) {
        text = text.slice(filler.length + 1);
        changed = true;
      }
    }
  }
  text = text.replace(/\s+please$/, "");
  text = text.replace(/["“”]/g, "").replace(/\s+/g, " ").trim();
  text = text.replace(/[.!?]+$/, "");
  return text;
}

function removeWords(text: string, words: string[]): string {
  let result = text;
  for (const w of words) {
    result = result.replace(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), " ");
  }
  return result.replace(/\s+/g, " ").trim();
}

const URL_RE = /^https?:\/\/\S+$/i;

const PLAY_WORDS = ["play", "baja", "bajao", "listen to", "listen"];
// Play detection is WORD-BOUNDARY + POSITION-guarded (see the PLAY MEDIA
// section). A substring check here was the source of spontaneous commands:
// "display" contains "play", so "display settings" used to trigger YouTube
// playback.
const OPEN_WORDS = ["open", "launch", "start", "khol", "chala", "chalao", "go to", "goto"];
const SEARCH_WORDS = ["search", "find", "look up", "google"];
const CLOSE_WORDS = ["close", "quit", "kill", "exit"];
const FOCUS_WORDS = ["focus", "switch to", "bring", "show"];

/** Local-file-looking queries must never leak into a web search. */
function looksLikeLocalFileQuery(q: string): boolean {
  return (
    /\.(pdf|docx?|txt|xlsx?|pptx?|png|jpe?g|gif|mp3|mp4|zip|csv|json|md)\b/i.test(q) ||
    /\b(file|files|folder|documents?|photos?|screenshots?|pdf|spreadsheet|presentation|invoice|resume)\b/i.test(q) ||
    /\b(on|in|under)\s+(?:my\s+|the\s+)?(desktop|downloads|documents|pictures|music|videos)\b/i.test(q)
  );
}

function startsWithAny(text: string, words: string[]): string | null {
  for (const w of words) {
    if (text === w || text.startsWith(w + " ")) return w;
  }
  return null;
}

// ─── Open-clause routing (shared by the single OPEN path + multi-step chains) ─

/** Route one normalized clause that starts with an open verb → a TaskStep. */
function routeOpenClause(clause: string): TaskStep | null {
  const verb = startsWithAny(clause, OPEN_WORDS);
  if (!verb) return null;
  // Trim BEFORE stripping articles — the slice leaves a leading space.
  const rest = clause.slice(verb.length).trim().replace(/^(the|my|a|an)\s+/, "").trim();

  // Folder hints ("open downloads")
  for (const word of rest.split(/\s+/)) {
    const folder = FOLDER_HINTS[word];
    if (folder) {
      return {
        action: "open_folder",
        target: folder,
        params: { location: folder },
        description: `Open the ${folder} folder`,
      };
    }
  }

  // Installed app hint FIRST ("open vs code" → desktop app, never a website)
  const appHint = matchHint(rest, APP_HINTS);
  if (appHint) {
    return {
      action: "open_app",
      target: appHint.value,
      params: { appName: appHint.value, query: rest },
      description: `Open ${appHint.value}`,
    };
  }

  // Website hints ("open youtube", "open gmail") — but NOT when the user
  // asked for a local folder that happens to share a name ("open my docs folder")
  const mentionsFolder = /\b(folder|directory)\b/.test(rest);
  const site = mentionsFolder ? null : matchHint(rest, SITE_HINTS);
  if (site) {
    return {
      action: "open_website",
      target: site.key,
      params: { url: site.value.url, label: site.value.label },
      description: `Open ${site.value.label}`,
    };
  }

  // Project / folder / file by name ("open my quip project", "open resume.docx")
  const projectMatch = rest.match(/(.+?)\s+(?:project|folder|file|document|doc|pdf)$/);
  const targetName = (projectMatch ? projectMatch[1] : rest).replace(/\b(project|folder|file)\b/g, "").trim();
  if (targetName && targetName.length > 1) {
    const isLikelyFile = /\.(docx?|pdf|txt|xlsx?|pptx?|png|jpe?g|mp3|mp4|md)$/i.test(targetName) || /\bfile\b/.test(rest);
    return {
      action: isLikelyFile ? "open_file" : "open_folder",
      target: targetName,
      params: { query: targetName, kind: isLikelyFile ? "file" : "folder" },
      description: `Open ${isLikelyFile ? "the file" : "the folder / project"} "${targetName}"`,
    };
  }

  // "open my project folder" with no concrete name → folder lookup via context
  if (/\b(project|folder|directory)\b/.test(rest)) {
    return {
      action: "open_folder",
      target: rest,
      params: { query: rest, kind: "folder" },
      description: `Open ${rest}`,
    };
  }

  // Unknown app name — still a task; execution resolves via discovery or web
  if (rest && rest.length > 1 && rest.split(" ").length <= 4) {
    return {
      action: "open_app",
      target: rest,
      params: { appName: rest, query: rest },
      description: `Open ${rest}`,
    };
  }
  return null;
}

// ─── MAIN PARSER ─────────────────────────────────────────────────────────────

// ─── Hinglish trailing-verb rewrite ─────────────────────────────────────────
// Natural Hinglish often places the verb AFTER the object ("vs code kholo",
// "mitwa bajao", "chrome band karo", "resume dhundo"). Rewrite those into the
// leading-verb English form the parser understands. Bare verbs never rewrite
// (no guessing), and "chalao" only maps to play when a media noun is present.

const TRAILING_HINGLISH: Array<{ re: RegExp; to: (rest: string) => string }> = [
  { re: /\s+(?:kholo|khol do|khol na|khol de|chala do|chalu karo)\s*$/i, to: (r) => `open ${r}` },
  { re: /\s+(?:bajao|baja do|baja de)\s*$/i, to: (r) => `play ${r}` },
  {
    re: /\s+(?:chalao|chalu kar)\s*$/i,
    to: (r) =>
      /\b(gaana|song|music|video|movie|playlist|trailer|film)\b/i.test(r) ? `play ${r}` : `open ${r}`,
  },
  { re: /\s+(?:band karo|band kar do|band kardo|band kr do|band kar)\s*$/i, to: (r) => `close ${r}` },
  { re: /\s+(?:dhundo|dhoondo|dhund lo|dhund)\s*$/i, to: (r) => `find ${r}` },
];

function rewriteTrailingHinglishVerb(text: string): string | null {
  for (const { re, to } of TRAILING_HINGLISH) {
    const m = text.match(re);
    if (m && m.index !== undefined) {
      const rest = text.slice(0, m.index).trim();
      if (!rest) return null; // bare verb — do not guess a target
      return to(rest);
    }
  }
  return null;
}

export function parseIntentV2(raw: string, opts: ParseOptions = {}): ParsedIntent {
  const normalized = normalizeCommand(raw);
  const text = normalized;
  const context: ExecutionContextState = opts.context ?? { updatedAt: 0 };
  const base = { original: raw, normalized: text };

  // ─── Direct URL ──────────────────────────────────────────────────────────
  const urlInRaw = raw.match(/https?:\/\/[^\s"<>]+/i);
  if (urlInRaw && startsWithAny(text, OPEN_WORDS)) {
    const url = urlInRaw[0].replace(/[.,;]+$/, "");
    return {
      ...base,
      action: "open",
      target: url,
      query: "",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "open_url",
        target: url,
        params: { url },
        description: `Open ${url}`,
      }],
      summary: `Opened ${url}`,
      confidence: 0.98,
    };
  }
  if (URL_RE.test(text) && urlInRaw) {
    return {
      ...base,
      action: "open",
      target: urlInRaw[0],
      query: "",
      isTask: true,
      isMultiStep: false,
      steps: [{ action: "open_url", target: urlInRaw[0], params: { url: urlInRaw[0] }, description: `Open ${urlInRaw[0]}` }],
      summary: `Opened ${urlInRaw[0]}`,
      confidence: 0.98,
    };
  }

  // ─── MULTI-STEP CHAINS (open/search/play/close/… sequences) ─────────────
  // "Open VS Code and open my Quip project." → 2 steps
  // "Open Chrome, go to YouTube, search for Mitwa and play it." → 4 steps
  // "Open Reddit and search for quip tips." → site-aware search step
  const rawClauses = text
    .split(/\s+(?:and|then|aur|phir)\s+|,\s+/)
    .map((s) => s.trim().replace(/^then\s+/, ""))
    .filter(Boolean);
  if (rawClauses.length > 1) {
    const chainSteps: TaskStep[] = [];
    let chainOk = true;
    let lastQuery = context.lastMediaQuery ?? "";
    let lastSite: string | null = null;

    for (const clause of rawClauses) {
      let step: TaskStep | null = null;

      if (startsWithAny(clause, OPEN_WORDS)) {
        step = routeOpenClause(clause);
        if (step?.action === "open_website") lastSite = step.target;
      } else if (/^(play|listen(?:\s+to)?|baja|bajao)\b/.test(clause)) {
        let q = removeWords(clause, [...PLAY_WORDS, "song", "gaana", "music", "video", "on", "youtube", "spotify", "yt"]);
        if (!q || q === "it" || q === "that" || q === "this") q = lastQuery;
        if (q) {
          step = /\bspotify\b/.test(clause)
            ? { action: "play_media", target: "spotify", params: { url: `https://open.spotify.com/search/${encodeURIComponent(q)}`, query: q }, description: `Play "${q}" on Spotify` }
            : { action: "play_media", target: "youtube", params: { query: q, youtube: "true" }, description: `Play "${q}" on YouTube` };
          lastQuery = q;
        }
      } else if (/^(search|find|look\s+up|google)\b/.test(clause)) {
        const q = removeWords(clause, [...SEARCH_WORDS, "look", "up", "for", "web", "internet"]);
        const vague = !q || q.replace(/\b(this|that|it|them|the|a|an|post|page|article)\b/g, "").trim().length < 3;
        // Local-file-looking queries must NOT become web searches — bail the
        // chain and let the dedicated local-first file-search block handle it.
        if (looksLikeLocalFileQuery(q)) { chainOk = false; break; }
        if (!vague) {
          const siteForSearch = lastSite && ["reddit", "x", "twitter", "github", "youtube"].includes(lastSite)
            ? (lastSite === "twitter" ? "x" : lastSite)
            : null;
          if (siteForSearch) {
            step = {
              action: "site_search",
              target: siteForSearch,
              params: { site: siteForSearch, query: q },
              description: `Search ${siteForSearch === "x" ? "X" : siteForSearch[0].toUpperCase() + siteForSearch.slice(1)} for "${q}"`,
            };
          } else if (lastSite === "youtube") {
            step = {
              action: "search_youtube",
              target: "youtube",
              params: { url: `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, query: q },
              description: `Search YouTube for "${q}"`,
            };
          } else {
            step = {
              action: "search_web",
              target: "google",
              params: { url: `https://www.google.com/search?q=${encodeURIComponent(q)}`, query: q },
              description: `Search for "${q}"`,
            };
          }
          lastQuery = q;
        }
      } else if (/^close\b/.test(clause)) {
        const rest = clause.replace(/^close\s*/, "").replace(/^(the|my)\s+/, "").trim();
        const appHint = matchHint(rest, APP_HINTS);
        const target = appHint ? appHint.value : rest;
        if (target.length > 1) {
          step = { action: "close_app", target, params: { target }, description: `Close ${target}` };
        }
      } else if (/^(focus|switch\s+to)\b/.test(clause)) {
        const rest = clause.replace(/^(?:focus|switch\s+to)\s*/, "").replace(/^(the|my)\s+/, "").trim();
        const appHint = matchHint(rest, APP_HINTS);
        const target = appHint ? appHint.value : rest;
        if (target.length > 1) {
          step = { action: "focus_app", target, params: { target }, description: `Focus ${target}` };
        }
      } else if (/^type\b/.test(clause)) {
        const content = clause.replace(/^type\s*/, "").trim();
        if (content) {
          step = { action: "type_text", target: "", params: { text: content }, description: `Type "${content}"` };
        }
      } else if (/^press\b/.test(clause)) {
        const keys = clause.replace(/^press\s*/, "").split(/\s*(?:\+|\s)\s*/).filter(Boolean).slice(0, 4);
        if (keys.length) {
          step = { action: "press_key", target: keys.join("+"), params: { keys: keys.join(",") }, description: `Press ${keys.join("+")}` };
        }
      } else if (/^scroll\b/.test(clause)) {
        const dir = /\bup\b/.test(clause) ? "up" : "down";
        const mag = clause.match(/(\d+)/);
        const amount = mag ? parseInt(mag[1], 10) : 360;
        const deltaY = dir === "up" ? String(amount) : String(-amount);
        step = { action: "scroll", target: dir, params: { deltaY }, description: `Scroll ${dir}` };
      } else if (/^(?:left\s+)?click\b/.test(clause)) {
        const cm = clause.match(/(\d+)\s*[,\s]\s*(\d+)/);
        step = cm
          ? { action: "click", target: `${cm[1]},${cm[2]}`, params: { x: cm[1], y: cm[2] }, description: `Click at (${cm[1]}, ${cm[2]})` }
          : { action: "click", target: "cursor", params: {}, description: "Click at the current cursor position" };
      }

      if (!step) { chainOk = false; break; }
      chainSteps.push(step);
    }

    if (chainOk && chainSteps.length > 1) {
      const lastStep = chainSteps[chainSteps.length - 1];
      const isPlay = lastStep.action === "play_media";
      return {
        ...base,
        action: isPlay ? "play" : "open",
        target: isPlay ? lastStep.target || "youtube" : lastStep.target,
        query: lastQuery,
        isTask: true,
        isMultiStep: true,
        steps: chainSteps,
        summary: chainSteps.map((s) => s.description).join(" → "),
        confidence: 0.85,
      };
    }
  }

  // ─── PLAY MEDIA (handles "open youtube and play mitwa" correctly) ───────
  // Word-boundary + POSITION check: the play verb must LEAD the request
  // (possibly after "go and / and / then"). Mid-sentence "play" — "the play
  // was amazing", "I listen to music while working" — is conversation, and
  // auto-executing it was exactly the spontaneous-command chaos.
  const playLead =
    !!startsWithAny(text, PLAY_WORDS) ||
    /^(?:go\s+(?:and|then)\s+|and\s+|then\s+)\s*(?:play|baja|bajao|listen)/.test(text);
  if (playLead) {
    const site = matchHint(text, SITE_HINTS);
    const useSpotifyApp = /\bspotify\b/.test(text) && !/\bweb\b/.test(text);
    const cleanQuery = removeWords(text, [
      ...PLAY_WORDS, "song", "gaana", "music", "video",
      ...OPEN_WORDS, "on", "and", "then", "in",
      "youtube", "yt", "spotify", "youtube music",
    ]);

    if (useSpotifyApp) {
      return {
        ...base,
        action: "play",
        target: "spotify",
        query: cleanQuery,
        isTask: true,
        isMultiStep: false,
        steps: [{
          action: "play_media",
          target: "spotify",
          params: { url: `https://open.spotify.com/search/${encodeURIComponent(cleanQuery)}`, query: cleanQuery },
          description: `Play "${cleanQuery}" on Spotify`,
        }],
        summary: `Playing ${cleanQuery} on Spotify`,
        confidence: 0.92,
      };
    }

    // Multi-step: open YouTube (if mentioned / not currently there) + play query.
    // Follow-up: "play it" reuses lastMediaQuery from context.
    let query = cleanQuery;
    let reusedFromContext = false;
    if (!query || query === "it" || query === "that" || query === "this") {
      query = context.lastMediaQuery ?? "";
      reusedFromContext = !!query;
    }
    const youtubeMentioned = /\b(youtube|yt)\b/.test(text);
    const alreadyOnYouTube = context.activeWebsite === "youtube";

    const steps: TaskStep[] = [];
    if (youtubeMentioned && !alreadyOnYouTube) {
      steps.push({
        action: "open_website",
        target: "youtube",
        params: { url: "https://www.youtube.com", label: "YouTube" },
        description: "Open YouTube",
      });
    }
    steps.push({
      action: "play_media",
      target: "youtube",
      params: { query, youtube: "true" },
      description: `Search "${query}" on YouTube and play`,
    });

    return {
      ...base,
      action: "play",
      target: "youtube",
      query,
      isTask: true,
      isMultiStep: steps.length > 1,
      steps,
      summary: `Playing ${query} on YouTube`,
      confidence: reusedFromContext ? 0.85 : 0.95,
    };
  }

  // ─── FOLLOW-UP: search/play referencing context ──────────────────────────
  if (/^(search|find|look up|play)\b/.test(text) && /\b(it|that|this|them|the same)\b/.test(text)) {
    const lastQuery = context.lastMediaQuery;
    const lastSite = context.activeWebsite;
    if (lastQuery) {
      const cleanQuery = removeWords(text, [...SEARCH_WORDS, ...PLAY_WORDS, "it", "that", "this", "them", "the same", "for"]);
      const query = cleanQuery ? `${cleanQuery} ${lastQuery}`.trim() : lastQuery;
      const target = lastSite === "youtube" || lastQuery ? "youtube" : "google";
      return {
        ...base,
        action: "search",
        target,
        query,
        isTask: true,
        isMultiStep: false,
        steps: [{
          action: target === "youtube" ? "play_media" : "search_web",
          target,
          params: target === "youtube"
            ? { query, youtube: "true" }
            : { url: `https://www.google.com/search?q=${encodeURIComponent(query)}`, query },
          description: `${target === "youtube" ? "Play" : "Search for"} "${query}"`,
        }],
        summary: `Using "${query}" from earlier`,
        confidence: 0.8,
      };
    }
  }

  // ─── DESKTOP ACTIONS ─────────────────────────────────────────────────────
  if (/\bclipboard\b/.test(text)) {
    const write = /\b(copy|write|put|set)\b/.test(text) || /\bcopy\b/.test(text);
    const read = /\b(read|show|paste|what'?s|what is|get)\b/.test(text);
    if (write && !read) {
      const quoted = raw.match(/\bcopy\s+"([^"]+)"/i);
      const plain = quoted ? null : text.match(/^copy\s+(.+?)\s+(?:to|into)\s+(?:the\s+)?clipboard$/);
      const content = quoted?.[1] ?? plain?.[1] ?? "";
      if (!content.trim() || /^(this|that|it|the selection|selection|them)$/i.test(content.trim())) {
        // No extractable content ("copy this to clipboard") → copy the
        // CURRENT SELECTION via ctrl+c. Never write an empty clipboard and
        // claim success.
        return {
          ...base,
          action: "key",
          target: "ctrl+c",
          query: "",
          isTask: true,
          isMultiStep: false,
          steps: [{
            action: "press_key",
            target: "ctrl+c",
            params: { keys: "ctrl,c" },
            description: "Copy the current selection",
          }],
          summary: "Copied the selection",
          confidence: 0.75,
        };
      }
      return {
        ...base,
        action: "clipboard",
        target: "write",
        query: content,
        isTask: true,
        isMultiStep: false,
        steps: [{
          action: "clipboard",
          target: "write",
          params: { text: content, mode: "write" },
          description: `Copy "${content}" to the clipboard`,
        }],
        summary: "Copied to clipboard",
        confidence: 0.85,
      };
    }
    return {
      ...base,
      action: "clipboard",
      target: "read",
      query: "",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "clipboard",
        target: "read",
        params: { mode: "read" },
        description: "Read the clipboard",
      }],
      summary: "Reading clipboard",
      confidence: 0.85,
    };
  }

  // Natural paste: "paste this/that/it" → real ctrl+v into the focused window
  if (/^paste\b/.test(text)) {
    return {
      ...base,
      action: "key",
      target: "ctrl+v",
      query: "",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "press_key",
        target: "ctrl+v",
        params: { keys: "ctrl,v" },
        description: "Paste from the clipboard",
      }],
      summary: "Pasted from the clipboard",
      confidence: 0.8,
    };
  }
  // Natural copy selection: "copy this/that/it" → real ctrl+c on the focused window
  if (/^copy\s+(this|that|it|the\s+selection|selection)\b/.test(text) && !/\b(file|folder|clipboard)\b/.test(text)) {
    return {
      ...base,
      action: "key",
      target: "ctrl+c",
      query: "",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "press_key",
        target: "ctrl+c",
        params: { keys: "ctrl,c" },
        description: "Copy the current selection",
      }],
      summary: "Copied the selection",
      confidence: 0.8,
    };
  }

  // ─── LIST WINDOWS ───────────────────────────────────────────────────────
  if (/\b(list|show|what|which)\b/.test(text) && /\bopen windows\b|\bwindows (?:are )?(?:open|running)\b|\blist windows\b/.test(text)) {
    return {
      ...base,
      action: "windows_list",
      target: "windows",
      query: "",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "windows_list",
        target: "windows",
        params: {},
        description: "List the open windows",
      }],
      summary: "Listing open windows",
      confidence: 0.85,
    };
  }

  // "show me the file X" / "show my documents" — BEFORE the focus loop.
  // ("show" used to be a focus verb, so "show me the file notes.txt" became
  //  focus_app("me the file notes.txt") — a wrong-window action.)
  const fileReadEarly = text.match(/^(?:read|show me)\s+(?:the\s+)?file\s+(.+)$/);
  if (fileReadEarly) {
    const p = fileReadEarly[1].replace(/^(?:the|my)\s+/, "").trim();
    return {
      ...base,
      action: "file_op",
      target: p,
      query: "read",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "file_op",
        target: p,
        params: { op: "read", path: p },
        description: `Read file "${p}"`,
      }],
      summary: "Reading file",
      confidence: 0.85,
    };
  }
  const showFolder = text.match(/^show(?:\s+me)?\s+(?:my\s+|the\s+)?(downloads?|documents?|pictures|photos|music|videos|desktop)\s*(?:folder)?$/);
  if (showFolder) {
    const folder = FOLDER_HINTS[showFolder[1]] ?? "downloads";
    return {
      ...base,
      action: "open_folder",
      target: folder,
      query: "",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "open_folder",
        target: folder,
        params: { location: folder },
        description: `Open the ${folder} folder`,
      }],
      summary: `Opened the ${folder} folder`,
      confidence: 0.85,
    };
  }

  // Close / focus apps: "close vs code", "focus chrome", "quit chrome".
  // startsWithAny is word-safe; the old substring fallback here turned
  // "quit chrome" into target "ed chrome" — it is gone for good.
  for (const [words, action] of [[CLOSE_WORDS, "close_app"], [FOCUS_WORDS, "focus_app"]] as const) {
    const verb = startsWithAny(text, words as unknown as string[]);
    if (verb) {
      const rest = text.slice(verb.length).replace(/^(the|my)\s+/, "").trim();
      if (verb === "show") {
        // "show" only ever focuses a NAMED app ("show chrome"). Anything
        // else ("show me the weather") is a question, not a device command.
        const namedApp = matchHint(rest, APP_HINTS);
        if (!namedApp) continue;
        return {
          ...base,
          action: "focus_app",
          target: namedApp.value,
          query: "",
          isTask: true,
          isMultiStep: false,
          steps: [{
            action: "focus_app",
            target: namedApp.value,
            params: { target: namedApp.value },
            description: `Focus ${namedApp.value}`,
          }],
          summary: `Focused ${namedApp.value}`,
          confidence: 0.8,
        };
      }
      const appHint = matchHint(rest, APP_HINTS);
      const target = appHint ? appHint.value : rest;
      if (target && target.length > 1) {
        return {
          ...base,
          action: action as string,
          target,
          query: "",
          isTask: true,
          isMultiStep: false,
          steps: [{
            action: action as ActionType,
            target,
            params: { target },
            description: `${action === "close_app" ? "Close" : "Focus"} ${target}`,
          }],
          summary: `${action === "close_app" ? "Closed" : "Focused"} ${target}`,
          confidence: 0.85,
        };
      }
    }
  }

  // Type text: "type hello world" / "write hello in notepad"
  const typeMatch = text.match(/^(?:type|write)\s+(.+)$/);
  if (typeMatch && !/\bemail|message|mail\b/.test(text)) {
    let content = typeMatch[1].trim();
    const inMatch = content.match(/\s+(?:in|into|on)\s+(\w[\w\s]*)$/);
    if (inMatch) content = content.slice(0, inMatch.index).trim();
    return {
      ...base,
      action: "type",
      target: inMatch?.[1]?.trim() ?? "",
      query: content,
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "type_text",
        target: inMatch?.[1]?.trim() ?? "",
        params: { text: content },
        description: `Type "${content}"`,
      }],
      summary: "Typed the text",
      confidence: 0.8,
    };
  }

  // Press keys: "press enter", "press ctrl+c"
  const keyMatch = text.match(/^press\s+(.+)$/);
  if (keyMatch) {
    const keys = keyMatch[1].split(/\s*(?:\+|\s)\s*/).filter(Boolean).slice(0, 4);
    return {
      ...base,
      action: "key",
      target: keys.join("+"),
      query: "",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "press_key",
        target: keys.join("+"),
        params: { keys: keys.join(",") },
        description: `Press ${keys.join("+")}`,
      }],
      summary: `Pressed ${keys.join("+")}`,
      confidence: 0.85,
    };
  }

  // Click / scroll
  const clickMatch = text.match(/^click(?:\s+at)?\s+(\d+)\s*[,\s]\s*(\d+)$/);
  if (clickMatch) {
    return {
      ...base,
      action: "click",
      target: `${clickMatch[1]},${clickMatch[2]}`,
      query: "",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "click",
        target: `${clickMatch[1]},${clickMatch[2]}`,
        params: { x: clickMatch[1], y: clickMatch[2] },
        description: `Click at (${clickMatch[1]}, ${clickMatch[2]})`,
      }],
      summary: "Clicked",
      confidence: 0.9,
    };
  }
  // "click" / "click this" — click at the CURRENT cursor position (real, honest)
  if (/^click(?:\s+(?:this|that|here|it))?$/.test(text)) {
    return {
      ...base,
      action: "click",
      target: "cursor",
      query: "",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "click",
        target: "cursor",
        params: {},
        description: "Click at the current cursor position",
      }],
      summary: "Clicked",
      confidence: 0.75,
    };
  }
  const scrollMatch = text.match(/^scroll\s*(up|down)?(?:\s+(\d+))?$/);
  if (scrollMatch) {
    const dir = scrollMatch[1] === "up" ? 1 : -1;
    const magnitude = scrollMatch[2] ? parseInt(scrollMatch[2], 10) : 360;
    return {
      ...base,
      action: "scroll",
      target: scrollMatch[1] ?? "down",
      query: "",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "scroll",
        target: scrollMatch[1] ?? "down",
        params: { deltaY: String(dir * magnitude) },
        description: `Scroll ${scrollMatch[1] ?? "down"}`,
      }],
      summary: `Scrolled ${scrollMatch[1] ?? "down"}`,
      confidence: 0.9,
    };
  }

  // ─── SCREENSHOT ─────────────────────────────────────────────────────────
  if (/\b(screenshot|screen ?shot|capture (?:the )?screen|grab (?:the )?screen)\b/.test(text)) {
    return {
      ...base,
      action: "screen",
      target: "screen",
      query: "",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "screen",
        target: "screen",
        params: {},
        description: "Capture the screen",
      }],
      summary: "Capturing the screen",
      confidence: 0.9,
    };
  }

  // ─── WINDOW CONTROLS (minimize / maximize / restore / move / resize) ────
  // MOUSE MOVE — BEFORE window controls: "move mouse to 500,300" must move
  // the cursor, not "move the window called mouse".
  const mouseMove = text.match(/^(?:move\s+)?(?:the\s+)?mouse(?:\s+cursor)?\s+(?:to\s+)?(\d+)\s*[,\s]\s*(\d+)$/);
  if (mouseMove) {
    const [, mx, my] = mouseMove;
    return {
      ...base,
      action: "mouse_move",
      target: `${mx},${my}`,
      query: "",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "mouse_move",
        target: `${mx},${my}`,
        params: { x: mx, y: my },
        description: `Move the mouse to (${mx}, ${my})`,
      }],
      summary: "Moved the mouse",
      confidence: 0.85,
    };
  }
  const winVerb = text.match(/^(minimize|maximize|restore|unmaximize)\s+(?:the\s+|my\s+)?([\w\s.-]*?)(?:\s+window)?$/);
  if (winVerb) {
    const op = winVerb[1] === "unmaximize" ? "restore" : winVerb[1];
    const target = winVerb[2].replace(/^(the|my)\s+/, "").replace(/\s+window$/, "").trim();
    return {
      ...base,
      action: "window_control",
      target: target || "foreground",
      query: op,
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "window_control",
        target: target || "foreground",
        params: { op, target },
        description: `${op[0].toUpperCase() + op.slice(1)} ${target ? `"${target}"` : "the foreground"} window`,
      }],
      summary: `${op} window`,
      confidence: 0.85,
    };
  }
  const winMove = text.match(/^move\s+(?:the\s+)?(.+?)\s+(?:window\s+)?to\s+(\d+)\s*[,\s]\s*(\d+)$/);
  if (winMove) {
    const target = winMove[1].replace(/^(the|my)\s+/, "").replace(/\s+window$/, "").trim();
    return {
      ...base,
      action: "window_control",
      target,
      query: "move",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "window_control",
        target,
        params: { op: "move", target, x: winMove[2], y: winMove[3] },
        description: `Move the "${target}" window to (${winMove[2]}, ${winMove[3]})`,
      }],
      summary: "Moving window",
      confidence: 0.8,
    };
  }
  const winResize = text.match(/^resize\s+(?:the\s+)?(.+?)\s+window\s+to\s+(\d+)\s*(?:x|\u00d7|by|,|\s)\s*(\d+)$/);
  if (winResize) {
    const target = winResize[1].replace(/^(the|my)\s+/, "").trim();
    return {
      ...base,
      action: "window_control",
      target,
      query: "resize",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "window_control",
        target,
        params: { op: "resize", target, width: winResize[2], height: winResize[3] },
        description: `Resize the "${target}" window to ${winResize[2]}×${winResize[3]}`,
      }],
      summary: "Resizing window",
      confidence: 0.8,
    };
  }

  // ─── DRAG & DROP ─────────────────────────────────────────────────────
  const dragMatch = text.match(/^drag(?:\s+from)?\s+(\d+)\s*[,\s]\s*(\d+)\s+(?:to|into)\s+(\d+)\s*[,\s]\s*(\d+)$/);
  if (dragMatch) {
    const [, fx, fy, tx, ty] = dragMatch;
    return {
      ...base,
      action: "drag",
      target: `${fx},${fy}->${tx},${ty}`,
      query: "",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "drag",
        target: `${fx},${fy}->${tx},${ty}`,
        params: { fromX: fx, fromY: fy, toX: tx, toY: ty },
        description: `Drag from (${fx}, ${fy}) to (${tx}, ${ty})`,
      }],
      summary: `Dragged to (${tx}, ${ty})`,
      confidence: 0.85,
    };
  }

  // ─── CLICK VARIANTS (double / right) ─────────────────────────────────────
  const clickVar = text.match(/^(double|right)\s+click(?:\s+at)?\s+(\d+)\s*[,\s]\s*(\d+)$/);
  if (clickVar) {
    return {
      ...base,
      action: "click",
      target: `${clickVar[2]},${clickVar[3]}`,
      query: clickVar[1],
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "click",
        target: `${clickVar[2]},${clickVar[3]}`,
        params: { x: clickVar[2], y: clickVar[3], variant: clickVar[1] === "double" ? "double" : "right" },
        description: `${clickVar[1] === "double" ? "Double-click" : "Right-click"} at (${clickVar[2]}, ${clickVar[3]})`,
      }],
      summary: "Clicked",
      confidence: 0.9,
    };
  }

  // ─── FILE OPERATIONS ─────────────────────────────────────────────────────
  const folderCreate = text.match(/^(?:create|make|new)\s+(?:a\s+)?(?:new\s+)?(?:folder|directory)\s+(?:called\s+|named\s+)?(.+)$/);
  if (folderCreate) {
    const p = folderCreate[1].replace(/^(?:the|my)\s+/, "").trim();
    return {
      ...base,
      action: "file_op",
      target: p,
      query: "mkdir",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "file_op",
        target: p,
        params: { op: "mkdir", path: p },
        description: `Create folder "${p}"`,
      }],
      summary: "Creating folder",
      confidence: 0.85,
    };
  }
  const fileCreate = text.match(/^(?:create|make|new)\s+(?:a\s+)?(?:new\s+)?file\s+(?:called\s+|named\s+)?(.+)$/);
  if (fileCreate) {
    const p = fileCreate[1].replace(/^(?:the|my)\s+/, "").trim();
    return {
      ...base,
      action: "file_op",
      target: p,
      query: "write",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "file_op",
        target: p,
        params: { op: "write", path: p, content: "" },
        description: `Create file "${p}"`,
      }],
      summary: "Creating file",
      confidence: 0.85,
    };
  }
  // (file READ is handled earlier — it must win over the "show"/focus verbs)
  const fileDelete = text.match(/^(?:delete|remove)\s+(?:the\s+)?(?:file|folder)\s+(.+)$/);
  if (fileDelete) {
    const p = fileDelete[1].replace(/^(?:the|my)\s+/, "").trim();
    return {
      ...base,
      action: "file_op",
      target: p,
      query: "delete",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "file_op",
        target: p,
        params: { op: "delete", path: p },
        description: `Delete "${p}"`,
      }],
      summary: "Deleting",
      confidence: 0.85,
    };
  }
  const fileCopy = text.match(/^copy\s+(?:the\s+)?(?:file\s+|folder\s+)?(.+?)\s+to\s+(.+)$/);
  if (fileCopy && !/\bclipboard\b/.test(text)) {
    const from = fileCopy[1].replace(/^(?:the|my)\s+/, "").trim();
    const to = fileCopy[2].trim();
    if (/\bfile\b|\bfolder\b|\.(txt|md|pdf|docx?|xlsx?|pptx?|png|jpe?g|csv|json|zip|log)\b/i.test(raw)) {
      return {
        ...base,
        action: "file_op",
        target: from,
        query: "copy",
        isTask: true,
        isMultiStep: false,
        steps: [{
          action: "file_op",
          target: from,
          params: { op: "copy", from, to },
          description: `Copy "${from}" to "${to}"`,
        }],
        summary: "Copying",
        confidence: 0.8,
      };
    }
  }
  const fileMove = text.match(/^move\s+(?:the\s+)?(?:file|folder)\s+(.+?)\s+to\s+(.+)$/);
  if (fileMove) {
    const from = fileMove[1].replace(/^(?:the|my)\s+/, "").trim();
    const to = fileMove[2].trim();
    return {
      ...base,
      action: "file_op",
      target: from,
      query: "move",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "file_op",
        target: from,
        params: { op: "move", from, to },
        description: `Move "${from}" to "${to}"`,
      }],
      summary: "Moving",
      confidence: 0.8,
    };
  }
  const fileSearch = text.match(/^(?:find|locate|search\s+for)\s+(?:a\s+)?files?\s+(?:called\s+|named\s+|with\s+)?(.+?)\s*(?:on|in|under)\s+(desktop|downloads|documents|pictures|music|videos|[a-z]:\\\\[\w\\ ]+|~[\w\/-]*)$/i);
  const fileSearchPlain = !fileSearch ? text.match(/^(?:find|locate|search\s+for)\s+(?:a\s+)?files?\s+(?:called\s+|named\s+|with\s+)?(.+)$/) : null;
  if (fileSearch || fileSearchPlain) {
    const src = fileSearch ?? fileSearchPlain!;
    const q = src[1].replace(/^(?:the|my)\s+/, "").replace(/[?]+$/, "").trim();
    const searchBase = fileSearch ? fileSearch[2] : undefined;
    return {
      ...base,
      action: "file_op",
      target: q,
      query: "search",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "file_op",
        target: q,
        params: { op: "search", query: q, ...(searchBase ? { base: searchBase } : {}) },
        description: searchBase
          ? `Search for files matching "${q}" in ${searchBase}`
          : `Search for files matching "${q}"`,
      }],
      summary: "Searching files",
      confidence: 0.8,
    };
  }

  // ─── BROAD LOCAL FILE SEARCH (local-first — never google a local file) ──
  // "find the pdf on my desktop" / "find resume.pdf" /
  // "Find the PDF on my Desktop and open it." (opens the first hit)
  const broadFind = text.match(/^(?:find|locate)\s+(.+)$/);
  if (broadFind && !/\b(?:app|website|site|windows?)\b/.test(text)) {
    let fq = broadFind[1].replace(/[?.!]+$/, "").trim();
    const openAfter = /\s+(?:and|then)\s+(?:open|show|display)\s+(?:it|that|this|them)$/.test(fq);
    if (openAfter) fq = fq.replace(/\s+(?:and|then)\s+(?:open|show|display)\s+(?:it|that|this|them)$/, "").trim();
    let searchBase: string | undefined;
    const baseMatch = fq.match(/\s+(?:on|in|under|from)\s+(?:my\s+|the\s+)?(desktop|downloads|documents|pictures|music|videos|photos)$/);
    if (baseMatch) {
      searchBase = baseMatch[1];
      fq = fq.slice(0, baseMatch.index).trim();
    }
    fq = fq.replace(/^(?:the|my|a|an)\s+/, "").trim();
    const looksLocal =
      !!searchBase ||
      /\.(pdf|docx?|txt|xlsx?|pptx?|png|jpe?g|gif|mp3|mp4|zip|csv|json|md|ipynb|ps1|py|ts|tsx|js|jsx)\b/i.test(fq) ||
      /\b(file|files|folder|documents?|photos?|screenshots?|pdf|spreadsheet|presentation|invoice|resume)\b/i.test(fq);
    if (looksLocal && fq) {
      return {
        ...base,
        action: "file_op",
        target: fq,
        query: "search",
        isTask: true,
        isMultiStep: false,
        steps: [{
          action: "file_op",
          target: fq,
          params: {
            op: "search",
            query: fq,
            ...(searchBase ? { base: searchBase } : {}),
            ...(openAfter ? { openFirst: "true" } : {}),
          },
          description: searchBase
            ? `Search for "${fq}" in ${searchBase}${openAfter ? " and open the first result" : ""}`
            : `Search for files matching "${fq}"${openAfter ? " and open the first result" : ""}`,
        }],
        summary: "Searching files",
        confidence: 0.8,
      };
    }
  }

  // ─── SITE SEARCH (reddit / x / github / youtube) ─────────────────────────
  const siteSearch = text.match(/\bsearch\s+(reddit|x|twitter|github|youtube)\s+for\s+(.+)$/);
  if (siteSearch) {
    const site = siteSearch[1] === "twitter" ? "x" : siteSearch[1];
    const q = siteSearch[2].replace(/[?]+$/, "").trim();
    return {
      ...base,
      action: "site_search",
      target: site,
      query: q,
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "site_search",
        target: site,
        params: { site, query: q },
        description: `Search ${site === "x" ? "X" : site[0].toUpperCase() + site.slice(1)} for "${q}"`,
      }],
      summary: `Searching ${site}`,
      confidence: 0.9,
    };
  }

  // ─── READ PAGE ───────────────────────────────────────────────────────────
  if (/\b(read|summarize|summarise)\b/.test(text) && (urlInRaw || /\b(this|that|the)\s+[\w-]*\s*(page|article|site|website|link)\b/.test(text))) {
    // Resolve what to read, in order: explicit URL → last opened page →
    // a site named in the sentence itself ("read this reddit page").
    const siteHint = matchHint(text, SITE_HINTS);
    const url = urlInRaw?.[0] ?? context.activeUrl ?? siteHint?.value?.url ?? "";
    if (url) {
      return {
        ...base,
        action: "read",
        target: url,
        query: "",
        isTask: true,
        isMultiStep: false,
        steps: [{
          action: "read_page",
          target: url,
          params: { url },
          description: `Read ${url}`,
        }],
        summary: "Reading the page",
        confidence: 0.85,
      };
    }
  }

  // ─── SEARCH WEB ──────────────────────────────────────────────────────────
  const searchVerb = startsWithAny(text, SEARCH_WORDS);
  if (searchVerb && !/\b(file|folder|downloads|app)\b/.test(text)) {
    const query = removeWords(text, [...SEARCH_WORDS, "look", "up", "web", "internet", "for", "on", "youtube"]);
    const onYouTube = /\byoutube|yt\b/.test(text);
    if (onYouTube && query) {
      return {
        ...base,
        action: "search",
        target: "youtube",
        query,
        isTask: true,
        isMultiStep: false,
        steps: [{
          action: "search_youtube",
          target: "youtube",
          params: { url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, query },
          description: `Search YouTube for "${query}"`,
        }],
        summary: `Searched YouTube for ${query}`,
        confidence: 0.9,
      };
    }
    if (query && looksLikeLocalFileQuery(query)) {
      // "search for my invoice" → local file search, never a Google search.
      return {
        ...base,
        action: "file_op",
        target: query,
        query: "search",
        isTask: true,
        isMultiStep: false,
        steps: [{
          action: "file_op",
          target: query,
          params: { op: "search", query },
          description: `Search for files matching "${query}"`,
        }],
        summary: "Searching files",
        confidence: 0.8,
      };
    }
    if (query) {
      return {
        ...base,
        action: "search",
        target: "google",
        query,
        isTask: true,
        isMultiStep: false,
        steps: [{
          action: "search_web",
          target: "google",
          params: { url: `https://www.google.com/search?q=${encodeURIComponent(query)}`, query },
          description: `Search the web for "${query}"`,
        }],
        summary: `Searched for ${query}`,
        confidence: 0.9,
      };
    }
  }

  // ─── COMPOSE EMAIL / MESSAGE ─────────────────────────────────────────────
  if (/\b(gmail|mail|email)\b/.test(text) && /\b(write|compose|draft|send|reply)\b/.test(text)) {
    const toMatch = raw.match(/\bto\s+([^,.;]+?)(?:\s+(?:about|subject|with|regarding|saying)\b|$)/i);
    const subjectMatch = raw.match(/\b(?:subject|about|regarding)\s+([^,.;]+?)(?:\s+(?:body|message|content|saying)\b|$)/i);
    return {
      ...base,
      action: "compose",
      target: "gmail",
      query: subjectMatch?.[1]?.trim() ?? "",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "compose_email",
        target: "gmail",
        params: {
          url: "https://mail.google.com/mail/?view=cm&fs=1",
          to: toMatch?.[1]?.trim() ?? "",
          subject: subjectMatch?.[1]?.trim() ?? "",
        },
        description: `Draft an email${toMatch?.[1] ? ` to ${toMatch[1].trim()}` : ""}`,
      }],
      summary: "Drafted an email",
      confidence: 0.85,
    };
  }

  if (/\bwhatsapp\b/.test(text) && /\b(send|message|text|msg)\b/.test(text)) {
    const personMatch = raw.match(/\b(?:to|msg|message)\s+([^,.;]+?)(?:\s+(?:saying|about|with)\b|$)/i);
    return {
      ...base,
      action: "send",
      target: "whatsapp",
      query: personMatch?.[1]?.trim() ?? "",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "compose_message",
        target: "whatsapp",
        params: { url: "https://web.whatsapp.com", person: personMatch?.[1]?.trim() ?? "" },
        description: `Open WhatsApp${personMatch?.[1] ? ` to message ${personMatch[1].trim()}` : ""}`,
      }],
      summary: "Opened WhatsApp",
      confidence: 0.8,
    };
  }

  // ─── OPEN: apps (installed first) / sites / folders / projects ───────────
  const openVerb = startsWithAny(text, OPEN_WORDS);
  if (openVerb) {
    const step = routeOpenClause(text);
    if (step) {
      const confidence =
        step.action === "open_app" && step.params.appName === step.params.query
          ? 0.6 // unknown app name — resolved at execution time via discovery
          : step.action === "open_app" || step.action === "open_website" || step.action === "open_folder"
            ? 0.9
            : 0.8;
      return {
        ...base,
        action: "open",
        target: step.target,
        query: step.action === "open_app" ? step.params.query ?? "" : "",
        isTask: true,
        isMultiStep: false,
        steps: [step],
        summary: step.description.replace(/^Open /, "Opened "),
        confidence,
        needsModelAssist: false,
      };
    }
  }

  // ─── SYSTEM SETTINGS ─────────────────────────────────────────────────────
  if (/\b(settings|preferences|control panel)\b/.test(text) && !openVerb) {
    return {
      ...base,
      action: "open",
      target: "settings",
      query: "",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "system_action",
        target: "settings",
        params: {},
        description: "Open system settings",
      }],
      summary: "Opened settings",
      confidence: 0.85,
    };
  }

  // ─── DEFAULT: CHAT (not a task) ──────────────────────────────────────────
  // ─── HINGLISH TRAILING VERBS ("youtube kholo", "mitwa bajao") ────────────
  // Natural Hinglish places the verb after the object. Rewrite into the
  // leading-verb form the parser already understands, then re-parse.
  const rewritten = rewriteTrailingHinglishVerb(text);
  if (rewritten) {
    const reparsed = parseIntentV2(rewritten, opts);
    if (reparsed.isTask) {
      return { ...reparsed, confidence: Math.min(reparsed.confidence, 0.8) };
    }
  }

  return {
    ...base,
    action: "chat",
    target: "",
    query: "",
    isTask: false,
    isMultiStep: false,
    steps: [],
    summary: "",
    confidence: 0.3,
  };
}
