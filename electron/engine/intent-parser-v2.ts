// Quip Execution Engine V2 — Intent Parser
// ─────────────────────────────────────────────────────────────────────────────
// Decomposes natural language into structured intent.
// Extracts: action, target, goal, params, steps (if multi-step detected).
//
// This is the FIRST step in the execution pipeline:
//   User Input → Intent Parser → Planner → Task Graph → Execution
//
// Unlike V1 (which only detected single intents), V2 detects:
//   - Multi-step commands ("open Gmail and send PDF from Downloads")
//   - Chained actions ("go to YouTube and play Mitwa")
//   - Complex goals ("organize downloads, find duplicates, create folders")
// ─────────────────────────────────────────────────────────────────────────────

export type ActionType =
  | "open_app"
  | "open_website"
  | "open_url"
  | "open_folder"
  | "open_file"
  | "play_media"
  | "search_web"
  | "search_in_app"
  | "compose_message"
  | "compose_email"
  | "write_text"
  | "copy_paste"
  | "create_folder"
  | "move_file"
  | "delete_file"
  | "organize_files"
  | "system_action"
  | "chain_tasks"
  | "chat";

export interface IntentStep {
  action: ActionType;
  target: string;
  params: Record<string, string>;
  description: string;
}

export interface ParsedIntentV2 {
  original: string;
  isTask: boolean;
  isMultiStep: boolean;
  steps: IntentStep[];
  summary: string;
  confidence: number;
}

// ─── Known sites ─────────────────────────────────────────────────────────────
const SITES: Record<string, { url: string; label: string }> = {
  youtube: { url: "https://www.youtube.com", label: "YouTube" },
  "youtube music": { url: "https://music.youtube.com", label: "YouTube Music" },
  gmail: { url: "https://mail.google.com", label: "Gmail" },
  google: { url: "https://www.google.com", label: "Google" },
  github: { url: "https://github.com", label: "GitHub" },
  chatgpt: { url: "https://chat.openai.com", label: "ChatGPT" },
  "open ai": { url: "https://chat.openai.com", label: "ChatGPT" },
  openai: { url: "https://chat.openai.com", label: "ChatGPT" },
  claude: { url: "https://claude.ai", label: "Claude" },
  spotify: { url: "https://open.spotify.com", label: "Spotify" },
  whatsapp: { url: "https://web.whatsapp.com", label: "WhatsApp" },
  instagram: { url: "https://www.instagram.com", label: "Instagram" },
  twitter: { url: "https://x.com", label: "X" },
  x: { url: "https://x.com", label: "X" },
  linkedin: { url: "https://www.linkedin.com", label: "LinkedIn" },
  notion: { url: "https://www.notion.so", label: "Notion" },
  figma: { url: "https://www.figma.com", label: "Figma" },
  discord: { url: "https://discord.com/app", label: "Discord" },
  slack: { url: "https://slack.com/signin", label: "Slack" },
  reddit: { url: "https://www.reddit.com", label: "Reddit" },
  netflix: { url: "https://www.netflix.com", label: "Netflix" },
  "google drive": { url: "https://drive.google.com", label: "Google Drive" },
  "google docs": { url: "https://docs.google.com", label: "Google Docs" },
  calendar: { url: "https://calendar.google.com", label: "Calendar" },
  maps: { url: "https://www.google.com/maps", label: "Maps" },
  perplexity: { url: "https://www.perplexity.ai", label: "Perplexity" },
  codex: { url: "https://chatgpt.com/codex", label: "Codex" },
};

// ─── Known apps ──────────────────────────────────────────────────────────────
const APPS: Record<string, { id: string; label: string }> = {
  vscode: { id: "vscode", label: "VS Code" },
  "vs code": { id: "vscode", label: "VS Code" },
  "visual studio code": { id: "vscode", label: "VS Code" },
  cursor: { id: "cursor", label: "Cursor" },
  terminal: { id: "terminal", label: "Terminal" },
  cmd: { id: "cmd", label: "Command Prompt" },
  powershell: { id: "powershell", label: "PowerShell" },
  calculator: { id: "calc", label: "Calculator" },
  calc: { id: "calc", label: "Calculator" },
  notepad: { id: "notepad", label: "Notepad" },
  spotify: { id: "spotify", label: "Spotify" },
  explorer: { id: "explorer", label: "File Explorer" },
  "file explorer": { id: "explorer", label: "File Explorer" },
  "files": { id: "explorer", label: "File Explorer" },
  settings: { id: "settings", label: "Settings" },
  "system settings": { id: "settings", label: "Settings" },
  edge: { id: "edge", label: "Microsoft Edge" },
  chrome: { id: "chrome", label: "Google Chrome" },
  firefox: { id: "firefox", label: "Firefox" },
  brave: { id: "brave", label: "Brave" },
};

// ─── Folders ─────────────────────────────────────────────────────────────────
const FOLDERS: Record<string, string> = {
  downloads: "downloads",
  desktop: "desktop",
  documents: "documents",
  pictures: "pictures",
  music: "music",
  videos: "videos",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/["""]/g, "").replace(/\s+/g, " ");
}

function contains(text: string, phrases: string[]): boolean {
  return phrases.some((p) => text.includes(p));
}

function findSite(text: string): { key: string; url: string; label: string } | null {
  for (const [key, val] of Object.entries(SITES)) {
    if (text.includes(key)) return { key, ...val };
  }
  return null;
}

function findApp(text: string): { id: string; label: string } | null {
  for (const [key, val] of Object.entries(APPS)) {
    if (text.includes(key)) return val;
  }
  return null;
}

function findFolder(text: string): string | null {
  for (const [key, val] of Object.entries(FOLDERS)) {
    if (text.includes(key)) return val;
  }
  return null;
}

function extractQuery(text: string, stops: string[]): string {
  let result = text;
  for (const s of stops) {
    result = result.replace(new RegExp(`\\b${s}\\b`, "gi"), " ");
  }
  return result.replace(/\s+/g, " ").trim();
}

const URL_RE = /^https?:\/\/\S+$/i;

// ─── Main parser ─────────────────────────────────────────────────────────────
export function parseIntentV2(raw: string): ParsedIntentV2 {
  const text = normalize(raw);
  const steps: IntentStep[] = [];
  let summary = "";
  let confidence = 0.5;
  let isTask = true;
  let isMultiStep = false;

  // Detect chain words — "and", "then", "after that", "also"
  const hasChain = contains(text, [" and then ", " then ", " after that ", " and also "]);
  const chainParts = hasChain
    ? text.split(/\s+(?:and then|then|after that|and also)\s+/i).filter(Boolean)
    : [text];

  // ─── Direct URL ────────────────────────────────────────────────────────────
  if (URL_RE.test(text)) {
    steps.push({
      action: "open_url",
      target: text,
      params: { url: text },
      description: `Open ${text}`,
    });
    summary = `Opened ${text}`;
    confidence = 1;
    isMultiStep = false;
    return { original: raw, isTask, isMultiStep, steps, summary, confidence };
  }

  // ─── Play media (YouTube/Spotify + song name) ──────────────────────────────
  if (contains(text, ["play", "baja", "bajao", "listen", "song", "gaana", "music"])) {
    const site = findSite(text);
    const useSpotify = contains(text, ["spotify"]);
    const query = extractQuery(text, [
      "play", "baja", "bajao", "listen", "to", "song", "gaana", "music",
      "youtube", "yt", "spotify", "on", "some", "of", "the", "please",
    ]);

    if (useSpotify || (site?.key === "spotify")) {
      steps.push({
        action: "play_media",
        target: "spotify",
        params: {
          url: `https://open.spotify.com/search/${encodeURIComponent(query)}`,
          query,
        },
        description: `Play "${query}" on Spotify`,
      });
      summary = `Playing ${query} on Spotify`;
    } else {
      // YouTube: open search + autoplay
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&autoplay=1`;
      steps.push({
        action: "play_media",
        target: "youtube",
        params: { url: searchUrl, query, youtube: "true" },
        description: `Play "${query}" on YouTube`,
      });
      summary = `Playing ${query} on YouTube`;
    }
    confidence = 0.95;
    isMultiStep = false;
    return { original: raw, isTask, isMultiStep, steps, summary, confidence };
  }

  // ─── Open website (YouTube, Gmail, WhatsApp, etc.) ─────────────────────────
  const site = findSite(text);
  if (site && contains(text, ["open", "launch", "start", "go", "visit", "khol", "chala", site.key])) {
    steps.push({
      action: "open_website",
      target: site.key,
      params: { url: site.url, label: site.label },
      description: `Open ${site.label}`,
    });
    summary = `Opened ${site.label}`;
    confidence = 0.9;
    isMultiStep = false;
    return { original: raw, isTask, isMultiStep, steps, summary, confidence };
  }

  // ─── Open app (VS Code, Cursor, Terminal, etc.) ────────────────────────────
  const app = findApp(text);
  if (app && contains(text, ["open", "launch", "start", "khol", "chala", app.id])) {
    steps.push({
      action: "open_app",
      target: app.id,
      params: { appId: app.id, appName: app.label },
      description: `Open ${app.label}`,
    });
    summary = `Opened ${app.label}`;
    confidence = 0.9;
    isMultiStep = false;
    return { original: raw, isTask, isMultiStep, steps, summary, confidence };
  }

  // ─── Open folder (Downloads, Desktop, etc.) ────────────────────────────────
  const folder = findFolder(text);
  if (folder && contains(text, ["open", "go", "khol", "show", folder])) {
    steps.push({
      action: "open_folder",
      target: folder,
      params: { location: folder },
      description: `Open ${folder} folder`,
    });
    summary = `Opened ${folder}`;
    confidence = 0.85;
    isMultiStep = false;
    return { original: raw, isTask, isMultiStep, steps, summary, confidence };
  }

  // ─── Search web ────────────────────────────────────────────────────────────
  if (contains(text, ["search", "find", "look up", "google", "browse"]) && !contains(text, ["file", "folder", "downloads"])) {
    const query = extractQuery(text, [
      "search", "find", "look", "up", "google", "browse", "for", "on", "the", "web", "internet",
    ]);
    steps.push({
      action: "search_web",
      target: "google",
      params: { url: `https://www.google.com/search?q=${encodeURIComponent(query)}`, query },
      description: `Search the web for "${query}"`,
    });
    summary = `Searched for ${query}`;
    confidence = 0.9;
    isMultiStep = false;
    return { original: raw, isTask, isMultiStep, steps, summary, confidence };
  }

  // ─── Compose email ─────────────────────────────────────────────────────────
  if (contains(text, ["gmail", "mail", "email"]) && contains(text, ["write", "compose", "draft", "send", "reply"])) {
    const toMatch = raw.match(/\bto\s+([^,.;]+?)(?:\s+(?:about|subject|with|regarding)\b|$)/i);
    const subjectMatch = raw.match(/\b(?:subject|about|regarding)\s+([^,.;]+?)(?:\s+(?:body|message|content)\b|$)/i);
    const bodyMatch = raw.match(/\b(?:body|message|content)\s+(.+)$/i);
    steps.push({
      action: "compose_email",
      target: "gmail",
      params: {
        url: "https://mail.google.com/mail/?view=cm&fs=1",
        to: toMatch?.[1]?.trim() ?? "",
        subject: subjectMatch?.[1]?.trim() ?? "",
        body: bodyMatch?.[1]?.trim() ?? "",
      },
      description: `Draft an email${toMatch?.[1] ? ` to ${toMatch[1].trim()}` : ""}`,
    });
    summary = `Drafted an email`;
    confidence = 0.85;
    isMultiStep = false;
    return { original: raw, isTask, isMultiStep, steps, summary, confidence };
  }

  // ─── Send message (WhatsApp) ───────────────────────────────────────────────
  if (contains(text, ["whatsapp", "message", "msg"]) && contains(text, ["send", "write", "text"])) {
    const personMatch = raw.match(/\b(?:to|msg|message)\s+([^,.;]+?)(?:\s+(?:saying|about|with)\b|$)/i);
    const msgMatch = raw.match(/\b(?:saying|about|with)\s+(.+)$/i);
    steps.push({
      action: "compose_message",
      target: "whatsapp",
      params: {
        url: "https://web.whatsapp.com",
        person: personMatch?.[1]?.trim() ?? "",
        message: msgMatch?.[1]?.trim() ?? "",
      },
      description: `Open WhatsApp${personMatch?.[1] ? ` to message ${personMatch[1].trim()}` : ""}`,
    });
    summary = `Opened WhatsApp`;
    confidence = 0.8;
    isMultiStep = false;
    return { original: raw, isTask, isMultiStep, steps, summary, confidence };
  }

  // ─── System action ─────────────────────────────────────────────────────────
  if (contains(text, ["settings", "system settings", "preferences", "control panel"])) {
    steps.push({
      action: "system_action",
      target: "settings",
      params: {},
      description: "Open system settings",
    });
    summary = "Opened settings";
    confidence = 0.85;
    isMultiStep = false;
    return { original: raw, isTask, isMultiStep, steps, summary, confidence };
  }

  // ─── Multi-step detection (chain words) ────────────────────────────────────
  if (hasChain && chainParts.length > 1) {
    isMultiStep = true;
    const subIntents = chainParts.map((part) => parseIntentV2(part));
    for (const sub of subIntents) {
      steps.push(...sub.steps);
    }
    summary = `Executing ${steps.length} steps`;
    confidence = 0.8;
    return { original: raw, isTask, isMultiStep, steps, summary, confidence };
  }

  // ─── Default: chat ─────────────────────────────────────────────────────────
  return {
    original: raw,
    isTask: false,
    isMultiStep: false,
    steps: [],
    summary: "",
    confidence: 0.3,
  };
}
