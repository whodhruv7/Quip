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
];

function normalizeCommand(raw: string): string {
  let text = raw.toLowerCase().trim();
  for (const filler of FILLER_WORDS) {
    text = text.replace(new RegExp(`\\b${filler}\\b`, "gi"), " ");
  }
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
const OPEN_WORDS = ["open", "launch", "start", "khol", "chala", "chalao", "go to", "goto"];
const SEARCH_WORDS = ["search", "find", "look up", "google"];
const CLOSE_WORDS = ["close", "quit", "kill", "exit"];
const FOCUS_WORDS = ["focus", "switch to", "bring", "show"];

function startsWithAny(text: string, words: string[]): string | null {
  for (const w of words) {
    if (text === w || text.startsWith(w + " ")) return w;
  }
  return null;
}

// ─── MAIN PARSER ─────────────────────────────────────────────────────────────

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

  // ─── PLAY MEDIA (handles "open youtube and play mitwa" correctly) ───────
  const hasPlay = PLAY_WORDS.some((w) => text.includes(w));
  if (hasPlay) {
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
      const content = raw.match(/\bcopy\s+"([^"]+)"|\bcopy\s+(?:the\s+)?text\s+(.+)$/i);
      return {
        ...base,
        action: "clipboard",
        target: "write",
        query: content?.[1] ?? content?.[2] ?? "",
        isTask: true,
        isMultiStep: false,
        steps: [{
          action: "clipboard",
          target: "write",
          params: { text: content?.[1] ?? content?.[2] ?? "", mode: "write" },
          description: "Copy text to the clipboard",
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

  // Close / focus apps: "close vs code", "focus chrome"
  for (const [words, action] of [[CLOSE_WORDS, "close_app"], [FOCUS_WORDS, "focus_app"]] as const) {
    const verb = startsWithAny(text, words as unknown as string[]) ?? (words.some((w) => text.startsWith(w)) ? words[0] : null);
    if (verb) {
      const rest = text.slice(verb.length).replace(/^(the|my)\s+/, "").trim();
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
            description: `${verb === "close" || CLOSE_WORDS.includes(verb) ? "Close" : "Focus"} ${target}`,
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
  const winMove = text.match(/^move\s+(?:the\s+)?(.+?)\s+window\s+to\s+(\d+)\s*[,\s]\s*(\d+)$/);
  if (winMove) {
    const target = winMove[1].replace(/^(the|my)\s+/, "").trim();
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
  const fileRead = text.match(/^(?:read|show me)\s+(?:the\s+)?file\s+(.+)$/);
  if (fileRead) {
    const p = fileRead[1].replace(/^(?:the|my)\s+/, "").trim();
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
  const fileSearch = text.match(/^(?:find|locate|search\s+for)\s+(?:a\s+)?files?\s+(?:called\s+|named\s+|with\s+)?(.+)$/);
  if (fileSearch) {
    const q = fileSearch[1].replace(/^(?:the|my)\s+/, "").replace(/[?]+$/, "").trim();
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
        params: { op: "search", query: q },
        description: `Search for files matching "${q}"`,
      }],
      summary: "Searching files",
      confidence: 0.8,
    };
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
  if (/\b(read|summarize|summarise)\b/.test(text) && (urlInRaw || /\b(this|that|the)\s+(page|article|site|website|link)\b/.test(text))) {
    const url = urlInRaw?.[0] ?? context.activeUrl ?? "";
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
    const rest = text.slice(openVerb.length).replace(/^(the|my|a|an)\s+/, "").trim();

    // Folder hints ("open downloads")
    for (const word of rest.split(/\s+/)) {
      const folder = FOLDER_HINTS[word];
      if (folder) {
        return {
          ...base,
          action: "open",
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
          summary: `Opened ${folder}`,
          confidence: 0.9,
        };
      }
    }

    // Installed app hint FIRST ("open vs code" → desktop app, never a website)
    const appHint = matchHint(rest, APP_HINTS);
    if (appHint) {
      return {
        ...base,
        action: "open",
        target: appHint.value,
        query: rest,
        isTask: true,
        isMultiStep: false,
        steps: [{
          action: "open_app",
          target: appHint.value,
          params: { appName: appHint.value, query: rest },
          description: `Open ${appHint.value}`,
        }],
        summary: `Opened ${appHint.value}`,
        confidence: 0.9,
      };
    }

    // Website hints ("open youtube", "open gmail")
    const site = matchHint(rest, SITE_HINTS);
    if (site) {
      return {
        ...base,
        action: "open",
        target: site.key,
        query: "",
        isTask: true,
        isMultiStep: false,
        steps: [{
          action: "open_website",
          target: site.key,
          params: { url: site.value.url, label: site.value.label },
          description: `Open ${site.value.label}`,
        }],
        summary: `Opened ${site.value.label}`,
        confidence: 0.9,
      };
    }

    // Project / folder / file by name ("open my quip project", "open resume.docx")
    const projectMatch = rest.match(/(.+?)\s+(?:project|folder|file|document|doc|pdf)$/);
    const targetName = (projectMatch ? projectMatch[1] : rest).replace(/\b(project|folder|file)\b/g, "").trim();
    if (targetName && targetName.length > 1) {
      const isLikelyFile = /\.(docx?|pdf|txt|xlsx?|pptx?|png|jpe?g|mp3|mp4|md)$/i.test(targetName) || /\bfile\b/.test(rest);
      return {
        ...base,
        action: "open",
        target: targetName,
        query: "",
        isTask: true,
        isMultiStep: false,
        steps: [{
          action: isLikelyFile ? "open_file" : "open_folder",
          target: targetName,
          params: { query: targetName, kind: isLikelyFile ? "file" : "folder" },
          description: `Open ${isLikelyFile ? "the file" : "the folder / project"} "${targetName}"`,
        }],
        summary: `Opened ${targetName}`,
        confidence: 0.8,
      };
    }

    // Unknown app name — still a task; execution resolves via discovery or web
    if (rest && rest.length > 1 && rest.split(" ").length <= 4) {
      return {
        ...base,
        action: "open",
        target: rest,
        query: rest,
        isTask: true,
        isMultiStep: false,
        steps: [{
          action: "open_app",
          target: rest,
          params: { appName: rest, query: rest },
          description: `Open ${rest}`,
        }],
        summary: `Opened ${rest}`,
        confidence: 0.6,
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
