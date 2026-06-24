// Quip Execution Engine V2 — Intent Understanding Engine
// ─────────────────────────────────────────────────────────────────────────────
// PROBLEM: Old parser was dumb regex. "open youtube and play mitwa" became
// a search for "open youtube and play mitwa" instead of just "mitwa".
//
// FIX: Proper entity extraction. Think like a human:
//   1. Normalize command (strip filler words)
//   2. Extract ACTION (open, play, search, send)
//   3. Extract PLATFORM/TARGET (youtube, gmail, vs code)
//   4. What's LEFT is the QUERY (mitwa, invoice.pdf, john)
//   5. Plan steps based on action + target + query
//
// Examples:
//   "Can you please open YouTube and play Mitwa"
//     → action: play, platform: youtube, query: "Mitwa"
//     → steps: open youtube, search "Mitwa", play first result
//
//   "open vs code"
//     → action: open, target: vscode (alias resolved)
//     → steps: launch vscode
//
//   "search AI news"
//     → action: search, query: "AI news"
//     → steps: open google search "AI news"
// ─────────────────────────────────────────────────────────────────────────────

export type ActionType =
  | "open_app"
  | "open_website"
  | "open_url"
  | "open_folder"
  | "play_media"
  | "search_web"
  | "compose_email"
  | "compose_message"
  | "system_action"
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
}

// ─── APP ALIASES ─────────────────────────────────────────────────────────────
// Every alias maps to a canonical app ID + label
const APP_ALIASES: Record<string, { id: string; label: string }> = {
  // VS Code
  "vscode": { id: "vscode", label: "VS Code" },
  "vs code": { id: "vscode", label: "VS Code" },
  "visual studio code": { id: "vscode", label: "VS Code" },
  "code editor": { id: "vscode", label: "VS Code" },
  // Cursor
  "cursor": { id: "cursor", label: "Cursor" },
  // Terminal
  "terminal": { id: "terminal", label: "Terminal" },
  "cmd": { id: "cmd", label: "Command Prompt" },
  "command prompt": { id: "cmd", label: "Command Prompt" },
  "powershell": { id: "powershell", label: "PowerShell" },
  // Calculator
  "calculator": { id: "calc", label: "Calculator" },
  "calc": { id: "calc", label: "Calculator" },
  // Notepad
  "notepad": { id: "notepad", label: "Notepad" },
  "text editor": { id: "notepad", label: "Notepad" },
  // Spotify
  "spotify": { id: "spotify", label: "Spotify" },
  // File Explorer
  "file explorer": { id: "explorer", label: "File Explorer" },
  "explorer": { id: "explorer", label: "File Explorer" },
  "files": { id: "explorer", label: "File Explorer" },
  "finder": { id: "explorer", label: "File Explorer" },
  // Settings
  "settings": { id: "settings", label: "Settings" },
  "system settings": { id: "settings", label: "Settings" },
  "preferences": { id: "settings", label: "Settings" },
  "control panel": { id: "settings", label: "Settings" },
  // Browsers
  "chrome": { id: "chrome", label: "Google Chrome" },
  "edge": { id: "edge", label: "Microsoft Edge" },
  "firefox": { id: "firefox", label: "Firefox" },
  "brave": { id: "brave", label: "Brave" },
  "browser": { id: "chrome", label: "Browser" },
};

// ─── WEBSITE ALIASES ─────────────────────────────────────────────────────────
const SITE_ALIASES: Record<string, { url: string; label: string }> = {
  "youtube": { url: "https://www.youtube.com", label: "YouTube" },
  "yt": { url: "https://www.youtube.com", label: "YouTube" },
  "youtube music": { url: "https://music.youtube.com", label: "YouTube Music" },
  "gmail": { url: "https://mail.google.com", label: "Gmail" },
  "mail": { url: "https://mail.google.com", label: "Gmail" },
  "email": { url: "https://mail.google.com", label: "Gmail" },
  "google": { url: "https://www.google.com", label: "Google" },
  "github": { url: "https://github.com", label: "GitHub" },
  "chatgpt": { url: "https://chat.openai.com", label: "ChatGPT" },
  "openai": { url: "https://chat.openai.com", label: "ChatGPT" },
  "open ai": { url: "https://chat.openai.com", label: "ChatGPT" },
  "claude": { url: "https://claude.ai", label: "Claude" },
  "spotify web": { url: "https://open.spotify.com", label: "Spotify" },
  "whatsapp": { url: "https://web.whatsapp.com", label: "WhatsApp" },
  "wa": { url: "https://web.whatsapp.com", label: "WhatsApp" },
  "instagram": { url: "https://www.instagram.com", label: "Instagram" },
  "insta": { url: "https://www.instagram.com", label: "Instagram" },
  "twitter": { url: "https://x.com", label: "X" },
  "x": { url: "https://x.com", label: "X" },
  "linkedin": { url: "https://www.linkedin.com", label: "LinkedIn" },
  "notion": { url: "https://www.notion.so", label: "Notion" },
  "figma": { url: "https://www.figma.com", label: "Figma" },
  "discord": { url: "https://discord.com/app", label: "Discord" },
  "slack": { url: "https://slack.com/signin", label: "Slack" },
  "reddit": { url: "https://www.reddit.com", label: "Reddit" },
  "netflix": { url: "https://www.netflix.com", label: "Netflix" },
  "drive": { url: "https://drive.google.com", label: "Google Drive" },
  "google drive": { url: "https://drive.google.com", label: "Google Drive" },
  "docs": { url: "https://docs.google.com", label: "Google Docs" },
  "google docs": { url: "https://docs.google.com", label: "Google Docs" },
  "calendar": { url: "https://calendar.google.com", label: "Calendar" },
  "maps": { url: "https://www.google.com/maps", label: "Maps" },
  "perplexity": { url: "https://www.perplexity.ai", label: "Perplexity" },
  "codex": { url: "https://chatgpt.com/codex", label: "Codex" },
};

// ─── FOLDER ALIASES ──────────────────────────────────────────────────────────
const FOLDER_ALIASES: Record<string, string> = {
  "downloads": "downloads",
  "download": "downloads",
  "desktop": "desktop",
  "documents": "documents",
  "document": "documents",
  "docs folder": "documents",
  "pictures": "pictures",
  "photos": "pictures",
  "music": "music",
  "videos": "videos",
};

// ─── Filler words to strip ───────────────────────────────────────────────────
const FILLER_WORDS = [
  "can you", "could you", "would you", "please", "kindly",
  "the", "a", "an", "my", "me", "for", "to", "of",
  "i want", "i need", "help me", "just",
];

// ─── Normalize command ───────────────────────────────────────────────────────
function normalizeCommand(raw: string): string {
  let text = raw.toLowerCase().trim();
  // Remove filler phrases
  for (const filler of FILLER_WORDS) {
    text = text.replace(new RegExp(`\\b${filler}\\b`, "gi"), " ");
  }
  // Clean up
  text = text.replace(/["""]/g, "").replace(/\s+/g, " ").trim();
  // Remove trailing punctuation
  text = text.replace(/[.!?]+$/, "");
  return text;
}

// ─── Resolve app alias ───────────────────────────────────────────────────────
function resolveApp(text: string): { id: string; label: string } | null {
  // Check longer aliases first (e.g. "visual studio code" before "vs code")
  const sortedKeys = Object.keys(APP_ALIASES).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (text.includes(key)) {
      return APP_ALIASES[key];
    }
  }
  return null;
}

// ─── Resolve site alias ──────────────────────────────────────────────────────
function resolveSite(text: string): { key: string; url: string; label: string } | null {
  const sortedKeys = Object.keys(SITE_ALIASES).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (text.includes(key)) {
      return { key, ...SITE_ALIASES[key] };
    }
  }
  return null;
}

// ─── Resolve folder alias ────────────────────────────────────────────────────
function resolveFolder(text: string): string | null {
  const sortedKeys = Object.keys(FOLDER_ALIASES).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (text.includes(key)) {
      return FOLDER_ALIASES[key];
    }
  }
  return null;
}

// ─── Extract query (what the user actually wants to search/play) ─────────────
// This is the KEY fix. Instead of removing words from the raw string,
// we identify what the action+target is, then what's LEFT is the query.
function extractQuery(
  text: string,
  actionWords: string[],
  targetWords: string[]
): string {
  let result = text;
  // Remove action words
  for (const w of actionWords) {
    result = result.replace(new RegExp(`\\b${w}\\b`, "gi"), " ");
  }
  // Remove target/platform words
  for (const w of targetWords) {
    result = result.replace(new RegExp(`\\b${w}\\b`, "gi"), " ");
  }
  // Remove remaining filler
  const extraFiller = ["and", "then", "on", "in", "at", "some", "of", "it", "that", "this", "with", "about"];
  for (const w of extraFiller) {
    result = result.replace(new RegExp(`\\b${w}\\b`, "gi"), " ");
  }
  return result.replace(/\s+/g, " ").trim();
}

const URL_RE = /^https?:\/\/\S+$/i;

// ─── MAIN PARSER ─────────────────────────────────────────────────────────────
export function parseIntentV2(raw: string): ParsedIntent {
  const normalized = normalizeCommand(raw);
  const text = normalized;

  // ─── Direct URL ────────────────────────────────────────────────────────────
  if (URL_RE.test(text)) {
    return {
      original: raw,
      normalized: text,
      action: "open",
      target: text,
      query: "",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "open_url" as ActionType,
        target: text,
        params: { url: text },
        description: `Open ${text}`,
      }],
      summary: `Opened ${text}`,
      confidence: 1,
    };
  }

  // ─── PLAY MEDIA (most important fix) ───────────────────────────────────────
  // "open youtube and play mitwa" → action: play, platform: youtube, query: mitwa
  // "play mitwa" → action: play, platform: youtube (default), query: mitwa
  // "play mitwa on spotify" → action: play, platform: spotify, query: mitwa
  const playWords = ["play", "baja", "bajao", "listen"];
  const hasPlay = playWords.some((w) => text.includes(w));

  if (hasPlay) {
    const site = resolveSite(text);
    const useSpotify = site?.key === "spotify" || text.includes("spotify");

    // Extract query: remove play words + open/launch words + platform names + filler
    const platformWords = site ? [site.key] : ["youtube", "yt", "spotify"];
    const allRemoveWords = [
      ...playWords, "song", "gaana", "music",
      "open", "launch", "start", "khol", "chala", "chalao",
      ...platformWords,
    ];
    const query = extractQuery(text, allRemoveWords, platformWords);

    if (useSpotify) {
      return {
        original: raw,
        normalized: text,
        action: "play",
        target: "spotify",
        query,
        isTask: true,
        isMultiStep: false,
        steps: [{
          action: "play_media" as ActionType,
          target: "spotify",
          params: {
            url: `https://open.spotify.com/search/${encodeURIComponent(query)}`,
            query,
          },
          description: `Play "${query}" on Spotify`,
        }],
        summary: `Playing ${query} on Spotify`,
        confidence: 0.95,
      };
    }

    // YouTube: search for just the song name, not the whole command
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    return {
      original: raw,
      normalized: text,
      action: "play",
      target: "youtube",
      query,
      isTask: true,
      isMultiStep: true,
      steps: [
        {
          action: "play_media" as ActionType,
          target: "youtube",
          params: { url: searchUrl, query, youtube: "true" },
          description: `Search "${query}" on YouTube and play`,
        },
      ],
      summary: `Playing ${query} on YouTube`,
      confidence: 0.95,
    };
  }

  // ─── SEARCH WEB ────────────────────────────────────────────────────────────
  const searchWords = ["search", "find", "look up", "google", "browse"];
  const hasSearch = searchWords.some((w) => text.includes(w));
  if (hasSearch && !text.includes("file") && !text.includes("folder") && !text.includes("downloads")) {
    const query = extractQuery(text, [...searchWords, "look", "up", "web", "internet", "for"], []);
    return {
      original: raw,
      normalized: text,
      action: "search",
      target: "google",
      query,
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "search_web" as ActionType,
        target: "google",
        params: { url: `https://www.google.com/search?q=${encodeURIComponent(query)}`, query },
        description: `Search the web for "${query}"`,
      }],
      summary: `Searched for ${query}`,
      confidence: 0.9,
    };
  }

  // ─── OPEN APP ──────────────────────────────────────────────────────────────
  const app = resolveApp(text);
  const openWords = ["open", "launch", "start", "khol", "chala", "chalao"];
  const hasOpen = openWords.some((w) => text.includes(w));

  if (app && hasOpen) {
    return {
      original: raw,
      normalized: text,
      action: "open",
      target: app.id,
      query: "",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "open_app" as ActionType,
        target: app.id,
        params: { appId: app.id, appName: app.label },
        description: `Open ${app.label}`,
      }],
      summary: `Opened ${app.label}`,
      confidence: 0.9,
    };
  }

  // ─── OPEN WEBSITE ──────────────────────────────────────────────────────────
  const site = resolveSite(text);
  if (site && hasOpen) {
    return {
      original: raw,
      normalized: text,
      action: "open",
      target: site.key,
      query: "",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "open_website" as ActionType,
        target: site.key,
        params: { url: site.url, label: site.label },
        description: `Open ${site.label}`,
      }],
      summary: `Opened ${site.label}`,
      confidence: 0.9,
    };
  }

  // ─── OPEN FOLDER ───────────────────────────────────────────────────────────
  const folder = resolveFolder(text);
  if (folder && (hasOpen || text.includes("go") || text.includes("show"))) {
    return {
      original: raw,
      normalized: text,
      action: "open",
      target: folder,
      query: "",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "open_folder" as ActionType,
        target: folder,
        params: { location: folder },
        description: `Open ${folder} folder`,
      }],
      summary: `Opened ${folder}`,
      confidence: 0.85,
    };
  }

  // ─── COMPOSE EMAIL ─────────────────────────────────────────────────────────
  if ((text.includes("gmail") || text.includes("mail") || text.includes("email")) &&
      (text.includes("write") || text.includes("compose") || text.includes("draft") || text.includes("send") || text.includes("reply"))) {
    const toMatch = raw.match(/\bto\s+([^,.;]+?)(?:\s+(?:about|subject|with|regarding)\b|$)/i);
    const subjectMatch = raw.match(/\b(?:subject|about|regarding)\s+([^,.;]+?)(?:\s+(?:body|message|content)\b|$)/i);
    return {
      original: raw,
      normalized: text,
      action: "compose",
      target: "gmail",
      query: subjectMatch?.[1]?.trim() ?? "",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "compose_email" as ActionType,
        target: "gmail",
        params: {
          url: "https://mail.google.com/mail/?view=cm&fs=1",
          to: toMatch?.[1]?.trim() ?? "",
          subject: subjectMatch?.[1]?.trim() ?? "",
        },
        description: `Draft an email${toMatch?.[1] ? ` to ${toMatch[1].trim()}` : ""}`,
      }],
      summary: `Drafted an email`,
      confidence: 0.85,
    };
  }

  // ─── SEND MESSAGE (WhatsApp) ───────────────────────────────────────────────
  if ((text.includes("whatsapp") || text.includes("wa") || text.includes("message") || text.includes("msg")) &&
      (text.includes("send") || text.includes("write") || text.includes("text"))) {
    const personMatch = raw.match(/\b(?:to|msg|message)\s+([^,.;]+?)(?:\s+(?:saying|about|with)\b|$)/i);
    return {
      original: raw,
      normalized: text,
      action: "send",
      target: "whatsapp",
      query: personMatch?.[1]?.trim() ?? "",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "compose_message" as ActionType,
        target: "whatsapp",
        params: {
          url: "https://web.whatsapp.com",
          person: personMatch?.[1]?.trim() ?? "",
        },
        description: `Open WhatsApp${personMatch?.[1] ? ` to message ${personMatch[1].trim()}` : ""}`,
      }],
      summary: `Opened WhatsApp`,
      confidence: 0.8,
    };
  }

  // ─── SYSTEM SETTINGS ───────────────────────────────────────────────────────
  if (text.includes("settings") || text.includes("preferences") || text.includes("control panel")) {
    return {
      original: raw,
      normalized: text,
      action: "open",
      target: "settings",
      query: "",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "system_action" as ActionType,
        target: "settings",
        params: {},
        description: "Open system settings",
      }],
      summary: "Opened settings",
      confidence: 0.85,
    };
  }

  // ─── DEFAULT: CHAT (not a task) ────────────────────────────────────────────
  return {
    original: raw,
    normalized: text,
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
