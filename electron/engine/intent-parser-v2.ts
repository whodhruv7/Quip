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
import path from "node:path";

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
  | "process_list"
  | "process_kill"
  | "volume"
  | "media_key"
  | "browser_tab"
  | "self_check"
  | "drag"
  | "mouse_move"
  | "chat"
  // Autonomy wave.
  | "web_ghost_read"
  | "web_ghost_extract"
  | "web_ghost_click"
  | "web_ghost_fill"
  | "mailwing_draft"
  | "mailwing_send"
  | "mailwing_accounts"
  | "mailwing_outbox"
  | "contacts_search"
  | "contacts_save"
  | "contacts_export"
  | "file_organize"
  | "file_duplicates"
  | "file_storage_report"
  | "file_watch"
  | "screenshot_save"
  | "wallpaper_set"
  | "brightness"
  | "notify_me"
  | "lock_pc"
  | "battery"
  | "clipboard_history"
  | "install_app"
  | "quest_run"
  | "routine_save"
  | "routine_run"
  | "routine_list"
  | "problem_diary";

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

/** Exported for the Head Brain's object detection (single source of truth). */
export const APP_HINTS: Record<string, string> = {
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

/** Exported for the Head Brain's object detection (single source of truth). */
export const SITE_HINTS: Record<string, { url: string; label: string }> = {
  youtube: { url: "https://www.youtube.com", label: "YouTube" },
  yt: { url: "https://www.youtube.com", label: "YouTube" },
  "youtube music": { url: "https://music.youtube.com", label: "YouTube Music" },
  "youtube studio": { url: "https://studio.youtube.com", label: "YouTube Studio" },
  gmail: { url: "https://mail.google.com", label: "Gmail" },
  mail: { url: "https://mail.google.com", label: "Gmail" },
  email: { url: "https://mail.google.com", label: "Gmail" },
  google: { url: "https://www.google.com", label: "Google" },
  github: { url: "https://github.com", label: "GitHub" },
  chatgpt: { url: "https://chatgpt.com", label: "ChatGPT" },
  openai: { url: "https://chatgpt.com", label: "ChatGPT" },
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
  calendar: { url: "https://calendar.google.com", label: "Google Calendar" },
  "google calendar": { url: "https://calendar.google.com", label: "Google Calendar" },
  gemini: { url: "https://gemini.google.com", label: "Gemini" },
  spotify: { url: "https://open.spotify.com", label: "Spotify" },
  flipkart: { url: "https://www.flipkart.com", label: "Flipkart" },
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

// ─── Account addressing (specific-target commands) ───────────────────────────
// "open my google calendar of gmail dhruvsharma4944@gmail.com" must open THAT
// account's calendar — not a generic page. Extract a named email and scope the
// Google properties to it (Gmail's /u/<email>/ path, authuser elsewhere).

const EMAIL_RE = /([\w.+-]+)@([\w-]+(?:\.[\w-]+)+)/;

/** The first email address mentioned in the command, if any. */
export function extractAccountEmail(text: string): string | null {
  const m = text.match(EMAIL_RE);
  return m ? m[0] : null;
}

/** True for Google properties that accept per-account scoping. */
function isAccountScopedSite(url: string): boolean {
  return /(^https:\/\/(?:mail|calendar|drive|docs|sheets|meet|gemini)\.google\.com|www\.youtube\.com)/.test(url);
}

/** Rewrite a site URL so it opens THE NAMED ACCOUNT's view. Returns the
 *  original URL when no account was named or the site isn't account-scoped. */
export function accountAwareUrl(url: string, email: string | null): string {
  if (!email || !isAccountScopedSite(url)) return url;
  const enc = encodeURIComponent(email);
  if (url.startsWith("https://mail.google.com")) {
    return `https://mail.google.com/mail/u/${enc}/`;
  }
  if (url.startsWith("https://calendar.google.com")) {
    return `https://calendar.google.com/calendar/r?authuser=${enc}`;
  }
  if (url.startsWith("https://drive.google.com")) {
    return `https://drive.google.com/drive/u/${enc}/my-drive`;
  }
  if (url.startsWith("https://docs.google.com")) {
    return `https://docs.google.com/document/u/${enc}/`;
  }
  if (url.startsWith("https://www.youtube.com")) {
    return `https://www.youtube.com/?authuser=${enc}`;
  }
  // Every other Google property (Gemini, Sheets, Meet, …) takes ?authuser=.
  return url.includes("?") ? `${url}&authuser=${enc}` : `${url}?authuser=${enc}`;
}

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

/** Specificity-first site matching for OPEN commands: a longer hint beats a
 *  shorter one so "open google calendar" resolves to CALENDAR, not to the
 *  generic "google" page that merely appears earlier in the sentence. */
function bestSiteHint(text: string): { key: string; value: any } | null {
  const words = text.split(/\s+/).filter(Boolean);
  let best: { key: string; value: any } | null = null;
  for (const word of words) {
    const hit = SITE_HINTS[word];
    if (hit && (!best || word.length > best.key.length)) {
      best = { key: word, value: hit };
    }
  }
  const multi = matchHint(text, SITE_HINTS);
  if (multi && multi.key.includes(" ") && (!best || multi.key.length > best.key.length)) {
    best = multi;
  }
  return best;
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

  // ── Surface routing: "open X on the web / in chrome / online" ──────────────
  // When the user names the SURFACE, the web wins over the app index —
  // "open whatsapp on web" must open web.whatsapp.com, not the desktop app.
  const surfaceWeb = /\b(?:on\s+(?:the\s+)?web|on\s+internet|in\s+(?:the\s+)?browser|online)\b/i.test(rest);
  const browserM = rest.match(/\b(?:in|with|on)\s+(chrome|edge|firefox|brave|opera)\b/i);
  const surfaceBrowser = browserM ? browserM[1].toLowerCase() : null;
  if (surfaceWeb || surfaceBrowser) {
    const cleaned = rest
      .replace(/\b(?:on\s+(?:the\s+)?web|on\s+internet|in\s+(?:the\s+)?browser|online)\b/ig, " ")
      .replace(/\b(?:in|with|on)\s+(?:chrome|edge|firefox|brave|opera)\b/ig, " ")
      .replace(/\s+/g, " ")
      .trim();
    const site = cleaned ? bestSiteHint(cleaned) : null;
    if (site) {
      const account = extractAccountEmail(clause);
      const url = accountAwareUrl(site.value.url, account);
      return {
        action: "open_website",
        target: site.key,
        params: {
          url,
          label: site.value.label,
          ...(account ? { account } : {}),
          ...(surfaceBrowser ? { browser: surfaceBrowser } : {}),
        },
        description: `Open ${site.value.label}${surfaceBrowser ? ` in ${surfaceBrowser}` : " on the web"}${account ? ` (account ${account})` : ""}`,
      };
    }
    if (cleaned && cleaned.length > 1) {
      // Unknown name on the web → look it up on Google (honest, still useful).
      return {
        action: "open_website",
        target: cleaned,
        params: {
          url: `https://www.google.com/search?q=${encodeURIComponent(cleaned)}`,
          label: cleaned,
          ...(surfaceBrowser ? { browser: surfaceBrowser } : {}),
        },
        description: `Look up "${cleaned}" on the web${surfaceBrowser ? ` in ${surfaceBrowser}` : ""}`,
      };
    }
  }

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
  const site = mentionsFolder ? null : bestSiteHint(rest);
  if (site) {
    // Account addressing: "open my calendar of dhruvsharma4944@gmail.com"
    // scopes the site to THAT account (named specifics beat generic pages).
    const account = extractAccountEmail(clause);
    const url = accountAwareUrl(site.value.url, account);
    return {
      action: "open_website",
      target: site.key,
      params: { url, label: site.value.label, ...(account ? { account } : {}) },
      description: `Open ${site.value.label}${account ? ` (account ${account})` : ""}`,
    };
  }

  // Bare domain / URL token ("open github.com", "open openai.com/pricing") —
  // a domain-shaped token is a WEBSITE, never a folder named "github.com".
  // (F-29: this used to fall into the folder branch and open an Explorer
  // error instead of the site.) Runs after the site-hint table so known
  // sites keep their rich labels, and never when a folder was meant.
  if (!mentionsFolder) {
    const DOMAIN_RE = /^(?:https?:\/\/|www\.)\S+|(?:[a-z0-9-]+\.)+(?:com|net|org|io|in|co|dev|ai|app|gg|me|tv|xyz|info|edu|gov|uk|us)(?:\/\S*)?$/i;
    const domainToken = rest.split(/\s+/).find((w) => DOMAIN_RE.test(w));
    if (domainToken) {
      const url = /^https?:\/\//i.test(domainToken)
        ? domainToken
        : `https://${domainToken.replace(/^www\./i, "")}`;
      return {
        action: "open_url",
        target: url,
        params: { url, label: domainToken },
        description: `Go to ${domainToken}`,
      };
    }
  }

  // Project / folder / file by name ("open my quip project", "open resume.docx")
  // "open resume.pdf with word" / "open report using vlc" → open-with hint.
  let openWith: string | null = null;
  let restClean = rest;
  const withM = restClean.match(/\s+(?:with|using|via)\s+([\w .+-]+)$/i);
  if (withM && withM[1].trim()) {
    openWith = withM[1].trim();
    restClean = restClean.slice(0, withM.index).trim();
  } else {
    const inM = restClean.match(/\s+in\s+([\w .+-]+)$/i);
    if (inM) {
      const cand = inM[1].trim().toLowerCase();
      // "in <app>" only means open-with when the target is a known app —
      // "open resume in downloads" must stay a location, not an app.
      if (APP_HINTS[cand] || /^(word|excel|powerpoint|vlc|notepad|paint|photoshop|vs ?code|code)$/.test(cand)) {
        openWith = inM[1].trim();
        restClean = restClean.slice(0, inM.index).trim();
      }
    }
  }
  const projectMatch = restClean.match(/(.+?)\s+(?:project|folder|file|document|doc|pdf)$/);
  const targetName = (projectMatch ? projectMatch[1] : restClean).replace(/\b(project|folder|file)\b/g, "").trim();
  if (targetName && targetName.length > 1) {
    const isLikelyFile = Boolean(openWith) || /\.(docx?|pdf|txt|xlsx?|pptx?|png|jpe?g|mp3|mp4|md)$/i.test(targetName) || /\bfile\b/.test(restClean);
    return {
      action: isLikelyFile ? "open_file" : "open_folder",
      target: targetName,
      params: {
        query: targetName,
        kind: isLikelyFile ? "file" : "folder",
        ...(openWith ? { openWith } : {}),
      },
      description: `Open ${isLikelyFile ? "the file" : "the folder / project"} "${targetName}"${openWith ? ` with ${openWith}` : ""}`,
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

// ─── Pending-choice follow-ups (the search → confirm → open flow) ────────────
// "I found 3 resumes — open the first one?" → "the second one" / "no" /
// "open it with word" / "search again". Pure + exported for tests.

export interface PendingFollowup {
  kind: "choice" | "cancel" | "again";
  /** 1-based index into the pending list; -1 = last. */
  choice?: number;
  openWith?: string;
}

const ORDINALS: Record<string, number> = {
  first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3,
  fourth: 4, "4th": 4, fifth: 5, "5th": 5, sixth: 6, "6th": 6,
};

/** Pure: parse "the second one" / "number 3" / "2" / "dusra" / "last" → 1-based index. */
export function parsePendingChoice(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  // Hinglish ordinals users actually say — "pehla", "dusra wala", "teesri".
  const hinglish = t.match(/\b(pehla|pehli|pehla\s+wala|dusra|doosra|dusri|doosri|dusra\s+wala|teesra|teesri|chautha)\b/);
  if (hinglish) {
    const word = hinglish[1].split(/\s+/)[0];
    const map: Record<string, number> = {
      pehla: 1, pehli: 1, dusra: 2, doosra: 2, dusri: 2, doosri: 2,
      teesra: 3, teesri: 3, chautha: 4,
    };
    return map[word] ?? null;
  }
  const ordinal = t.match(/\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|sixth|6th)\b/);
  if (ordinal) return ORDINALS[ordinal[1]];
  if (/\blast\b/.test(t)) return -1;
  const num = t.match(/\b(\d{1,2})\b/);
  if (num) {
    const n = parseInt(num[1], 10);
    if (n >= 1 && n <= 12) return n;
  }
  return null;
}

/**
 * Pure: with a pending-choice list on screen, map a short reply onto an
 * action — "open it" / "the second one" / "no" / "search again" /
 * "open it with vlc" / "vlc me kholo".
 * `pendingLabels` (optional) enables reply-by-name ("excel") and
 * reply-by-type ("the pdf one") when the names are on screen.
 */
export function matchPendingFollowup(text: string, pendingLabels?: string[]): PendingFollowup | null {
  const t = text.trim().toLowerCase().replace(/[.!?]+$/, "").replace(/\s+/g, " ");
  if (!t) return null;

  // cancel — clear the pending list
  if (/^(no|nahi|nahin|cancel|forget it|chhodo|chod do|leave it|nahi chahiye|ruk ja|ruko|stop)\b/.test(t)) {
    return { kind: "cancel" };
  }

  // search again — re-run the search that produced the list
  if (/^(search again|aur dhundo|aur dhoondo|dhundo aur|find more|more|naya search|dobara dhundo|rescan)\b/.test(t)) {
    return { kind: "again" };
  }

  // "open (it|the second one) with vlc" / "in word"
  const withM = t.match(/\s+(?:with|using|via)\s+(?:the\s+)?(.+)$/);
  if (withM && withM[1].trim()) {
    const inner = t.slice(0, withM.index).trim();
    return { kind: "choice", choice: parsePendingChoice(inner) ?? 1, openWith: withM[1].trim() };
  }

  // Hinglish open-with: "vlc me kholo" / "word se kholo"
  const hinM = t.match(/^(.+?)\s+(?:me|mai|mein|se)\s+kho?lo$/);
  if (hinM && hinM[1].trim() && !/^(open|kholo|launch|it|that|wahi|wohi)$/.test(hinM[1].trim())) {
    const inner = hinM[1].trim();
    return { kind: "choice", choice: parsePendingChoice(inner) ?? 1, openWith: inner };
  }

  // plain choice: "open it" / "the second one" / "2" / "haan"
  if (
    /^(?:open|kholo|launch|run|haan|haanji|hanji|yes|yeah|yep|ok|okay|karo|kar do|khol do|sahi hai|thik hai|theek hai)\b/.test(t) ||
    /^(?:it|that|wahi|wohi|the\s+\w+\s+one|number\s*\d+|option\s*\d+|\d{1,2}(?:\s+one)?|first|second|third|fourth|fifth|last)(?:\s+one)?$/.test(t)
  ) {
    const stripped = t
      .replace(/^(?:open|kholo|launch|run|haan|haanji|hanji|yes|yeah|yep|ok|okay|karo|kar do|khol do|sahi hai|thik hai|theek hai)\b/, "")
      .replace(/\b(?:it|that|wahi|wohi|one)\b/g, "")
      .replace(/\b(?:the|number|option)\b/g, "")
      .trim();
    const choice = parsePendingChoice(stripped || "1");
    if (choice !== null) return { kind: "choice", choice };
  }

  // Reply-by-name ("excel") or by file type ("the pdf one") — the user points
  // at a listed candidate without using its position. Only for SHORT replies
  // (≤5 words) so real commands never hijack the pending list.
  if (pendingLabels && pendingLabels.length > 0 && t.split(/\s+/).length <= 5) {
    for (let i = 0; i < pendingLabels.length; i++) {
      const label = (pendingLabels[i] ?? "").toLowerCase();
      const base = label.replace(/\.[^.]+$/, "");
      if (
        (base.length > 2 && t.includes(base)) ||
        (label.length > 2 && t.includes(label))
      ) {
        return { kind: "choice", choice: i + 1 };
      }
    }
    for (let i = 0; i < pendingLabels.length; i++) {
      const ext = pendingLabels[i]?.match(/\.([A-Za-z0-9]{2,4})$/)?.[1]?.toLowerCase();
      if (ext && new RegExp(`\\b${ext}\\b`).test(t)) {
        return { kind: "choice", choice: i + 1 };
      }
    }
  }

  return null;
}

// ─── Autonomy wave helpers ─────────────────────────────────────────────

/** First plausible URL in free text (bare domains included, https added).
 *  Email addresses are stripped FIRST — "rahul@acme.com" must never read as
 *  a website to open (the user asked to email him, not browse). */
function detectUrlIn(text: string): string {
  const withoutEmails = text.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi, " ");
  const m =
    withoutEmails.match(/https?:\/\/[^\s"<>]+/i) ??
    withoutEmails.match(/\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s"<>]*/i) ??
    withoutEmails.match(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|in|co|dev|ai|app|me)\b/i);
  if (!m) return "";
  let url = m[0].replace(/[.,;]+$/, "");
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

const KNOWN_FOLDERS: Record<string, string> = {
  downloads: "Downloads",
  desktop: "Desktop",
  documents: "Documents",
  pictures: "Pictures",
  videos: "Videos",
  music: "Music",
};

/** "downloads/desktop/documents" → the real absolute folder on this machine. */
function resolveKnownFolder(text: string): string | null {
  for (const [word, folder] of Object.entries(KNOWN_FOLDERS)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(text)) {
      const home = process.platform === "win32" ? process.env.USERPROFILE : process.env.HOME;
      return home ? path.join(home, folder) : folder;
    }
  }
  return null;
}

const EMAIL_ADDR_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/i;

// ─── MAIN PARSER ─────────────────────────────────────────────────────

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

  // ─── Pending-choice follow-ups (search results are on screen) ─────────────
  // "I found 3 resumes — open one?" → "the second one" / "no" / "open it with
  // word" / "search again". Checked FIRST — short replies must never leak
  // into app/site routing.
  const pending = context.pendingChoices;
  if (pending && pending.length > 0) {
    const followup = matchPendingFollowup(
      text,
      pending.map((c) => c.label)
    );
    if (followup?.kind === "cancel") {
      return {
        ...base,
        action: "open",
        target: "cancel",
        query: "",
        isTask: true,
        isMultiStep: false,
        steps: [{
          action: "open_file",
          target: "cancel",
          params: { fromPending: "cancel", query: "cancel" },
          description: "Drop the pending options",
        }],
        summary: "Okay — dropped",
        confidence: 0.75,
      };
    }
    if (followup?.kind === "again" && context.pendingQuery) {
      return {
        ...base,
        action: "file_op",
        target: context.pendingQuery,
        query: "search",
        isTask: true,
        isMultiStep: false,
        steps: [{
          action: "file_op",
          target: context.pendingQuery,
          params: { op: "search", query: context.pendingQuery },
          description: `Search again for "${context.pendingQuery}"`,
        }],
        summary: "Searching again",
        confidence: 0.75,
      };
    }
    if (followup?.kind === "choice") {
      const wanted = followup.choice === -1 ? pending.length : (followup.choice ?? 1);
      const idx = Math.max(0, Math.min(wanted - 1, pending.length - 1));
      const pick = pending[idx];
      const stepAction: ActionType = pick.kind === "file" ? "open_file" : "open_folder";
      return {
        ...base,
        action: "open",
        target: pick.label,
        query: "",
        isTask: true,
        isMultiStep: false,
        steps: [{
          action: stepAction,
          target: pick.path,
          params: {
            fromPending: "true",
            choice: String(idx + 1),
            query: pick.path,
            kind: pick.kind,
            ...(followup.openWith ? { openWith: followup.openWith } : {}),
          },
          description: `Open ${pick.label}`,
        }],
        summary: `Opened ${pick.label}`,
        confidence: 0.8,
      };
    }
  }

  // ─── CAP-070: multi-verb chains ("organize downloads phir report bhejo") ──
  // Split on Hinglish/English sequencing words; when BOTH halves parse into
  // real tasks, run them as one sequential plan (shared context).
  const CHAIN_SPLIT = /\s+(?:phir|then|uske baad|and then|baad me(?:in)?|after that)\s+/i;
  if (CHAIN_SPLIT.test(text)) {
    const halves = text.split(CHAIN_SPLIT).map((h) => h.trim()).filter((h) => h.length > 2);
    if (halves.length >= 2 && halves.length <= 3) {
      const subIntents = halves.map((h) => parseIntentV2(h, { ...opts, context: undefined as any }));
      const allTasks = subIntents.every((p) => p.isTask && p.steps && p.steps.length > 0);
      const distinct = new Set(subIntents.map((p) => p.normalized)).size === subIntents.length;
      if (allTasks && distinct) {
        const steps = subIntents.flatMap((p) => p.steps!);
        return {
          ...base,
          action: subIntents[0].action,
          target: subIntents[0].target,
          query: subIntents[0].query,
          isTask: true,
          isMultiStep: true,
          steps,
          summary: subIntents.map((p) => p.summary).join("; then "),
          confidence: Math.min(...subIntents.map((p) => p.confidence ?? 0.8)) * 0.97,
        };
      }
    }
  }

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

  // ─── VOLUME / MEDIA / PROCESS / TAB — fast device clauses ───────────────
  // These MUST run before play routing ("play the next song" is a media key,
  // not a search) and before the close/focus loop ("close this tab" is a tab
  // action, not close_app; "kill the chrome process" is process_kill).
  /** One-step task builder — keeps the new device clauses compact. */
  const single = (
    action: ActionType,
    target: string,
    params: Record<string, string>,
    description: string,
    summary: string,
    confidence: number
  ): ParsedIntent => ({
    ...base,
    action,
    target,
    query: "",
    isTask: true,
    isMultiStep: false,
    steps: [{ action, target, params, description }],
    summary,
    confidence,
  });

  // Volume: "set volume to 50", "volume up/down", "mute", Hinglish awaaz.
  const volSet = text.match(/^(?:set\s+)?volume\s+(?:to\s+)?(\d{1,3})\s*(?:%|percent)?$/);
  if (volSet) {
    const level = Math.max(0, Math.min(100, parseInt(volSet[1], 10)));
    return single("volume", "volume", { action: "set", level: String(level) },
      `Set the volume to ${level}%`, "Setting volume", 0.9);
  }
  const volVerb = text.match(/^(?:turn\s+)?(?:the\s+)?volume\s+(up|down)$/);
  if (volVerb) {
    const a = volVerb[1];
    return single("volume", a, { action: a }, `Turn the volume ${a}`, `Volume ${a}`, 0.9);
  }
  if (/^(mute|unmute)(\s+(?:the\s+)?(?:sound|audio|volume))?$/.test(text)) {
    const a = text.startsWith("un") ? "unmute" : "mute";
    return single("volume", a, { action: a }, a === "mute" ? "Mute the sound" : "Unmute the sound", a === "mute" ? "Muting" : "Unmuting", 0.9);
  }
  if (/^(awaaz|aawaz|awaz)\s+(band|chalu|bada|kam|tez|dheema)\s*(karo|kar)?$/.test(text)) {
    const w = text.split(/\s+/)[1];
    const a = w === "band" ? "mute" : w === "chalu" ? "unmute" : (w === "kam" || w === "dheema") ? "down" : "up";
    return single("volume", a, { action: a }, `Volume ${a}`, `Volume ${a}`, 0.85);
  }
  if (/^(awaaz|aawaz|awaz)\s+(\d{1,3})\s*(?:%|percent)?\s*(karo|kar)?$/.test(text)) {
    const m = text.match(/^(?:awaaz|aawaz|awaz)\s+(\d{1,3})/);
    const level = Math.max(0, Math.min(100, parseInt(m![1], 10)));
    return single("volume", "volume", { action: "set", level: String(level) },
      `Set the volume to ${level}%`, "Setting volume", 0.85);
  }

  // Media keys: next/previous/pause — no YouTube lookup.
  const mediaNext = text.match(/^(?:play\s+)?(?:the\s+)?(next|agla)\s+(?:song|track|gana|gaana|video)$/);
  const mediaPrev = text.match(/^(?:play\s+)?(?:the\s+)?(previous|pichla|pichhla|last)\s+(?:song|track|gana|gaana|video)$/);
  if (mediaNext || mediaPrev) {
    const action = mediaNext ? "next" : "previous";
    return single("media_key", action, { action },
      action === "next" ? "Skip to the next track" : "Go back to the previous track",
      action === "next" ? "Skipping to the next track" : "Going to the previous track", 0.9);
  }
  if (/^(pause|resume)(\s+(?:the\s+)?(?:music|song|video|gaana|gana))?$/.test(text) ||
      /^(gaana|gana|music|video)\s+(pause|rok|chalu)\s*(karo|kar)?$/.test(text)) {
    return single("media_key", "playpause", { action: "playpause" },
      "Toggle play/pause", "Toggling playback", 0.85);
  }

  // Device self-check — real executed probes, honest per-item report.
  if (/^(run\s+)?(a\s+)?self\s*(check|test|diagnostic)s?$/.test(text) ||
      /^run\s+diagnostics$/.test(text) ||
      /^diagnos(e|tics)$/.test(text) ||
      /^(check|test)\s+(yourself|your\s+(systems?|capabilities?))$/.test(text)) {
    return single("self_check", "self", {},
      "Run a self check of every device capability", "Running a self check", 0.9);
  }

  // Processes: list / force-close (kill). Plain "close X" stays graceful.
  if (/\b(what|which)\s+processes\s+(are\s+)?(running|open)\b/.test(text) ||
      /^list\s+(all\s+)?(running\s+)?processes$/.test(text) ||
      /^show\s+(all\s+)?(running\s+)?processes$/.test(text) ||
      /^kaunse\s+process\s+(chal\s+)?(rahe|chale)\s*(hai|rahe hain|hain)?$/.test(text)) {
    return single("process_list", "processes", {},
      "List the running processes", "Listing processes", 0.9);
  }
  const killPid = text.match(/^(?:kill|close|end|terminate)\s+(?:the\s+)?(?:process|pid)\s+(\d+)$/);
  if (killPid) {
    return single("process_kill", killPid[1], { target: killPid[1] },
      `Close the process with pid ${killPid[1]}`, `Closing process ${killPid[1]}`, 0.9);
  }
  const killName = text.match(
    /^(?:kill|end task on|end the task|force close|force kill|terminate)\s+(?:the\s+)?(.+?)\s+(?:process|task)$/);
  if (killName) {
    const target = killName[1].replace(/^(the|my)\s+/, "").trim();
    return single("process_kill", target, { target },
      `Force-close the "${target}" process`, `Force-closing "${target}"`, 0.9);
  }

  // Browser tab control (uses the browser's own shortcuts).
  const tabOps: Array<[RegExp, string, string]> = [
    [/^(?:open\s+)?(?:a\s+)?new\s+tab$/, "new", "Open a new tab"],
    [/^naya\s+tab\s*(kholo|khol|open)?$/, "new", "Open a new tab"],
    [/^(?:close|band)\s+(?:this\s+|the\s+|current\s+)?tab$/, "close", "Close the current tab"],
    [/^tab\s+band\s*(karo|kar)?$/, "close", "Close the current tab"],
    [/^(?:switch\s+to\s+)?(?:the\s+)?next\s+tab$/, "next", "Switch to the next tab"],
    [/^(?:switch\s+to\s+)?(?:the\s+)?previous\s+tab$/, "previous", "Switch to the previous tab"],
    [/^(?:reopen|restore)\s+(?:the\s+)?(?:last\s+)?(?:closed\s+)?tab$/, "reopen", "Reopen the last closed tab"],
    [/^go\s+back$/, "back", "Go back a page"],
    [/^peeche\s+ja[o]?$/, "back", "Go back a page"],
    [/^go\s+forward$/, "forward", "Go forward a page"],
    [/^(?:refresh|reload)(?:\s+(?:the|this)\s+page)?$/, "reload", "Reload the page"],
  ];
  for (const [re, op, desc] of tabOps) {
    if (re.test(text)) {
      return single("browser_tab", op, { op }, desc, desc, 0.85);
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
  if (/\bclipboard\b/.test(text) && !/\b(history|recent|purani|previous)\b/.test(text)) {
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
    const wantsSave = /\b(save|file|picture|photo|folder|disk|store)\b/.test(text);
    return {
      ...base,
      action: "screen",
      target: "screen",
      query: "",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: wantsSave ? "screenshot_save" : "screen",
        target: "screen",
        params: {},
        description: wantsSave ? "Capture the screen and save it as a PNG in Pictures" : "Capture the screen",
      }],
      summary: wantsSave ? "Screenshot saved" : "Capturing the screen",
      confidence: 0.9,
    };
  }


  // ─── AUTONOMY WAVE: quests, email send, ghost, files, device ─────────────
  // These branches run BEFORE the generic compose/open branches — they are
  // more specific and must win ("send an email about X" ≠ "open gmail").

  const urlDetected = detectUrlIn(text);

  // ── Quest: email-from-website ("site pe jo email hai usko mail bhejo") ──
  if (
    urlDetected &&
    /\b(email|mail|contact|contacts)\b/.test(text) &&
    /\b(send|bhej|bhejo|reach|write|likho|message)\b/.test(text)
  ) {
    const questHint = raw.match(/\b(founder|ceo|owner|manager|director|admin|support|hr|sales)\b/i)?.[1] ?? "";
    const questBody = raw.match(/\b(?:about|saying|regarding)\s+(.+)$/i)?.[1]?.trim() ?? "";
    return {
      ...base,
      action: "quest",
      target: "email-from-website",
      query: "",
      isTask: true,
      isMultiStep: true,
      steps: [{
        action: "quest_run",
        target: "email-from-website",
        params: {
          kind: "email-from-website",
          url: urlDetected,
          ...(questHint ? { hint: questHint } : {}),
          ...(questBody ? { body: questBody } : {}),
        },
        description: `Find a contact on ${urlDetected} and email them after your approval`,
      }],
      summary: "Website contact quest",
      confidence: 0.9,
    };
  }

  // ── Ghost: extract contacts from a site ──────────────────────────────────
  if (
    urlDetected &&
    /\b(email|emails|mail|contact|contacts|phone)\b/.test(text) &&
    /\b(extract|find|dhundo|dhoondo|nikalo|scrape|pull|get|save|dekh)\b/.test(text) &&
    !/\b(send|bhej)\b/.test(text)
  ) {
    return {
      ...base,
      action: "extract_contacts",
      target: urlDetected,
      query: "",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "web_ghost_extract",
        target: urlDetected,
        params: { url: urlDetected },
        description: `Pull every contact from ${urlDetected} into your Contacts Book`,
      }],
      summary: "Extracted the site's contacts",
      confidence: 0.88,
    };
  }

  // ── Ghost: read a page properly (JS-rendered) ─────────────────────────────
  if (urlDetected && /\b(read|padho|padh)\b/.test(text) && /\b(fully|properly|rendered|javascript|js|sahi se|achhe se)\b/.test(text)) {
    return {
      ...base,
      action: "read",
      target: urlDetected,
      query: "",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "web_ghost_read",
        target: urlDetected,
        params: { url: urlDetected },
        description: `Read ${urlDetected} with the ghost browser (JS-rendered content included)`,
      }],
      summary: "Read the page",
      confidence: 0.8,
    };
  }

  // ── MailWing send flow ("rahul@acme.com ko mail bhejo about the invoice",
  //    "gmail likh dhruv@gmail.com ko and send kr de") ────────────────────
  // "gmail" is INCLUDED — the user says gmail when they mean real mail.
  if (/\b(send|bhej|bhejo)\b/.test(text) && /\b(mail|email|gmail)\b/.test(text) && !urlDetected) {
    const addr = text.match(EMAIL_ADDR_RE)?.[0] ?? "";
    const toName = !addr
      ? (raw.match(/\bto\s+([a-z0-9 ._'-]{2,40}?)(?:\s+(?:about|regarding|saying|subject|and)\b|$)/i)?.[1] ?? "").trim()
        || (raw.match(/\b([a-z0-9 ._'-]{2,40}?)\s+ko\s+(?:mail|email|bhej|likh|send)/i)?.[1] ?? "").trim()
      : "";
    const about =
      raw.match(/\b(?:about|regarding|saying|subject)\s+(.+)$/i)?.[1]?.trim() ?? "";
    const tone = /\bformal\b/i.test(text)
      ? "formal"
      : /\bcasual\b/i.test(text)
        ? "casual"
        : /\bfriendly\b/i.test(text)
          ? "friendly"
          : "professional";
    if (!addr && !toName) {
      return {
        ...base,
        action: "clarify",
        target: "email",
        query: "",
        isTask: false,
        isMultiStep: false,
        steps: [],
        summary: "Needs a recipient",
        confidence: 0.4,
        needsModelAssist: true,
      };
    }
    const recipient = addr || toName;
    return {
      ...base,
      action: "send_email",
      target: recipient,
      query: about,
      isTask: true,
      isMultiStep: true,
      steps: [
        {
          action: "mailwing_draft",
          target: recipient,
          params: {
            to: recipient,
            body: about || `Write a short, clear email to ${recipient}.`,
            tone,
            humanize: "true",
          },
          description: `Write a ${tone} email to ${recipient}${about ? ` about "${about.slice(0, 60)}"` : ""}`,
        },
        {
          action: "mailwing_send",
          target: recipient,
          params: {},
          description: "Send it after your approval (SMTP-verified)",
        },
      ],
      summary: "Email drafted for approval",
      confidence: 0.85,
    };
  }

  // ── Contacts ──────────────────────────────────────────────────────────────
  if (/\b(contact|contacts)\b/.test(text) && /\b(export|csv)\b/.test(text)) {
    return {
      ...base,
      action: "export_contacts",
      target: "contacts",
      query: "",
      isTask: true,
      isMultiStep: false,
      steps: [{ action: "contacts_export", target: "contacts", params: {}, description: "Export your Contacts Book to CSV" }],
      summary: "Contacts exported",
      confidence: 0.9,
    };
  }
  if (/\b(contact|contacts)\b/.test(text) && /\b(save|add|store|daal)\b/.test(text)) {
    const email = text.match(EMAIL_ADDR_RE)?.[0] ?? "";
    const name =
      raw.match(/\b(?:as|called|named)\s+([a-z0-9 ._'-]{2,40})(?:\s+with\b|$)/i)?.[1]?.trim() ?? "";
    if (!email && !/\d{6,}/.test(text.replace(/\D/g, ""))) {
      // fall through to chat — saving without an address would be guessing
    } else {
      return {
        ...base,
        action: "save_contact",
        target: "contacts",
        query: name,
        isTask: true,
        isMultiStep: false,
        steps: [{
          action: "contacts_save",
          target: "contacts",
          params: { email, name, phone: text.replace(/\D/g, "").slice(0, 15) },
          description: `Save ${name || email || "this contact"} to your Contacts Book`,
        }],
        summary: "Contact saved",
        confidence: 0.85,
      };
    }
  }
  if (
    /\b(email|mail)\b/.test(text) &&
    /\b(find|search|dhundo|dhoondo|kahan|where|show|batao|check)\b/.test(text) &&
    !urlDetected
  ) {
    const q =
      raw
        .replace(/\b(find|search|dhundo|dhoondo|kahan|where|show|batao|check|email|mail|ka|the|of|do|me|hai|id)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (q.length >= 2) {
      return {
        ...base,
        action: "find_contact",
        target: "contacts",
        query: q,
        isTask: true,
        isMultiStep: false,
        steps: [{
          action: "contacts_search",
          target: "contacts",
          params: { query: q },
          description: `Look up "${q}" in your Contacts Book`,
        }],
        summary: "Searched contacts",
        confidence: 0.8,
      };
    }
  }

  // ── FileButler ────────────────────────────────────────────────────────────
  if (/\b(confirm|apply)\b/.test(text) && /\b(organize|organise)\b/.test(text)) {
    return {
      ...base,
      action: "organize",
      target: "confirm",
      query: "",
      isTask: true,
      isMultiStep: false,
      steps: [{ action: "file_organize", target: "confirm", params: { op: "apply" }, description: "Apply the staged organize plan" }],
      summary: "Organized the folder",
      confidence: 0.92,
    };
  }
  if (/\b(undo|revert|wapas|rollback)\b/.test(text) && /\b(organize|organise|move)\b/.test(text)) {
    return {
      ...base,
      action: "organize",
      target: "undo",
      query: "",
      isTask: true,
      isMultiStep: false,
      steps: [{ action: "file_organize", target: "undo", params: { op: "undo" }, description: "Undo the last organize run from its manifest" }],
      summary: "Undid the organize",
      confidence: 0.9,
    };
  }
  if (/\b(organize|organise|clean|saaf|sort|tidy)\b/.test(text) && /\b(downloads|desktop|documents|folder|files)\b/.test(text) && !/\bduplicates?\b/.test(text)) {
    const dir = resolveKnownFolder(text) ?? "";
    const mode = /\b(date|month|time)\b/.test(text) ? "date" : "type";
    if (dir) {
      return {
        ...base,
        action: "organize",
        target: dir,
        query: "",
        isTask: true,
        isMultiStep: false,
        steps: [
          {
            action: "file_organize",
            target: dir,
            params: { dir, mode, op: "plan" },
            description: `Plan the organize of ${dir} by ${mode} (nothing moves until you confirm)`,
          },
          {
            action: "file_organize",
            target: dir,
            params: { op: "apply" },
            description: "Apply it after you approve the plan",
          },
        ],
        summary: "Organized the folder",
        confidence: 0.9,
      };
    }
  }
  if (/\bduplicates?\b/.test(text)) {
    const dir = resolveKnownFolder(text) ?? "";
    const clean = /\b(clean|trash|delete|remove|hatao|saaf)\b/.test(text);
    if (dir) {
      return {
        ...base,
        action: "duplicates",
        target: dir,
        query: "",
        isTask: true,
        isMultiStep: false,
        steps: [{
          action: "file_duplicates",
          target: dir,
          params: { dir, ...(clean ? { clean: "true" } : {}) },
          description: clean
            ? `Find duplicates in ${dir} and trash the extra copies`
            : `Scan ${dir} for duplicate files`,
        }],
        summary: clean ? "Cleaned duplicates" : "Scanned for duplicates",
        confidence: 0.88,
      };
    }
  }
  if (/\b(storage|disk space|space used|jagah|size of)\b/.test(text)) {
    const dir = resolveKnownFolder(text);
    if (dir) {
      return {
        ...base,
        action: "storage_report",
        target: dir,
        query: "",
        isTask: true,
        isMultiStep: false,
        steps: [{ action: "file_storage_report", target: dir, params: { dir }, description: `Measure what's inside ${dir}` }],
        summary: "Storage report ready",
        confidence: 0.85,
      };
    }
  }
  if (/\b(watch|watching|monitor|auto.?organize)\b/.test(text) && /\b(downloads|desktop|documents|folder)\b/.test(text)) {
    const dir = resolveKnownFolder(text) ?? "";
    const stop = /\b(stop|band|cancel)\b/.test(text);
    if (dir) {
      return {
        ...base,
        action: "watch",
        target: dir,
        query: "",
        isTask: true,
        isMultiStep: false,
        steps: [{
          action: "file_watch",
          target: dir,
          params: { op: stop ? "stop" : "start", dir },
          description: stop ? `Stop watching ${dir}` : `Watch ${dir} — new files auto-organize with a toast each time`,
        }],
        summary: stop ? "Watch stopped" : "Watching the folder",
        confidence: 0.88,
      };
    }
  }

  // ── Device superpowers ────────────────────────────────────────────────────
  if (/\bwallpaper\b/.test(text) && /\b(set|change|badlo|badal|lagao|laga|apply)\b/.test(text)) {
    const source = detectUrlIn(text) || "";
    return {
      ...base,
      action: "wallpaper",
      target: source || "wallpaper",
      query: "",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "wallpaper_set",
        target: source || "wallpaper",
        params: source ? { source } : {},
        description: source ? "Set the wallpaper from that image" : "Set the wallpaper (need an image path or URL)",
      }],
      summary: "Wallpaper set",
      confidence: 0.85,
    };
  }
  if (/\b(brightness|roshni)\b/.test(text)) {
    const level = text.match(/\b(\d{1,3})\s*(?:%|percent)?\b/)?.[1];
    const wantsSet = /\b(set|kam|zyada|increase|decrease|lower|raise|dim|full)\b/.test(text) || Boolean(level);
    return {
      ...base,
      action: "brightness",
      target: "screen",
      query: level ?? "",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "brightness",
        target: "screen",
        params: wantsSet && level ? { action: "set", level } : { action: "get" },
        description: wantsSet && level ? `Set brightness to ${level}%` : "Read the current brightness",
      }],
      summary: "Brightness adjusted",
      confidence: 0.85,
    };
  }
  if (/\block\b/.test(text) && /\b(pc|computer|laptop|screen|windows|system|desktop)\b/.test(text)) {
    return {
      ...base,
      action: "lock",
      target: "pc",
      query: "",
      isTask: true,
      isMultiStep: false,
      steps: [{ action: "lock_pc", target: "pc", params: {}, description: "Lock the PC (needs your confirmation)" }],
      summary: "Locked the PC",
      confidence: 0.9,
    };
  }
  if (/\bbattery\b/.test(text) && /\b(kitni|kitna|kaisi|kaisa|status|level|check|percentage|charge|charging|hai)\b/.test(text)) {
    return {
      ...base,
      action: "battery",
      target: "battery",
      query: "",
      isTask: true,
      isMultiStep: false,
      steps: [{ action: "battery", target: "battery", params: {}, description: "Read the battery status" }],
      summary: "Battery status",
      confidence: 0.9,
    };
  }
  if (/\bclipboard\b/.test(text) && /\b(history|recent|log|purani|previous)\b/.test(text)) {
    return {
      ...base,
      action: "clipboard_history",
      target: "clipboard",
      query: "",
      isTask: true,
      isMultiStep: false,
      steps: [{ action: "clipboard_history", target: "clipboard", params: {}, description: "Show this session's clipboard history" }],
      summary: "Clipboard history",
      confidence: 0.9,
    };
  }
  const installMatch = text.match(/^(?:install|setup|set up|install karo)\s+(?:the\s+|an?\s+)?([a-z0-9 .+#-]{2,40})$/i);
  if (installMatch) {
    const appQuery = installMatch[1].replace(/\s*(app|application|software)\s*$/i, "").trim();
    return {
      ...base,
      action: "install",
      target: appQuery,
      query: appQuery,
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "install_app",
        target: appQuery,
        params: { query: appQuery },
        description: `Install ${appQuery} via winget (approval-gated)`,
      }],
      summary: `Installed ${appQuery}`,
      confidence: 0.85,
    };
  }

  // ── Problem Diary — "kya problems aayi?", "export problem report" ───────
  // Deterministic routing: the user can always ask what failed and get the
  // real diary, never a model-guessed answer.
  if (/\b(problem|problems|error|errors|prblm|galti)\b/i.test(text) && !/\b(solve|fix|theek|thik)\b/i.test(text)) {
    const exportMatch = /\b(export|report|file|download|save)\b/i.test(text) && /\b(problem|diary|report)\b/i.test(text);
    const resolveMatch = text.match(/\b(?:resolve|mark|solved)\b[^]*?\bproblem\b/i) ?? text.match(/\bproblem\s*#?(\d+)\s*(?:resolve|solved|done|ho gaya)/i);
    if (exportMatch) {
      return {
        ...base,
        action: "problems",
        target: "export",
        query: "",
        isTask: true,
        isMultiStep: false,
        steps: [{ action: "problem_diary", target: "export", params: { verb: "export" }, description: "Write the problem report (Markdown) to the Desktop" }],
        summary: "Problem report exported",
        confidence: 0.9,
      };
    }
    if (resolveMatch) {
      const num = text.match(/#?(\d+)/)?.[1] ?? "";
      return {
        ...base,
        action: "problems",
        target: "resolve",
        query: num,
        isTask: true,
        isMultiStep: false,
        steps: [{ action: "problem_diary", target: "resolve", params: { verb: "resolve", id: num }, description: `Mark problem ${num || "chosen"} resolved` }],
        summary: "Problem resolved",
        confidence: 0.85,
      };
    }
    if (/\b(problem|problems|error|errors|prblm|diary)\b/i.test(text) && /\b(list|show|dikhao|kya|kaun|konsi|kaise|check|batao|any|hai|thi)\b/i.test(text)) {
      return {
        ...base,
        action: "problems",
        target: "list",
        query: "",
        isTask: true,
        isMultiStep: false,
        steps: [{ action: "problem_diary", target: "list", params: { verb: "list" }, description: "Show the open problems from the diary" }],
        summary: "Problems listed",
        confidence: 0.9,
      };
    }
  }

  // ── Routines ──────────────────────────────────────────────────────────────
  if (/\broutines?\b/.test(text) && /\b(list|show|dikhao|sab|all)\b/.test(text)) {
    return {
      ...base,
      action: "routines",
      target: "list",
      query: "",
      isTask: true,
      isMultiStep: false,
      steps: [{ action: "routine_list", target: "routines", params: {}, description: "List your saved routines" }],
      summary: "Routines listed",
      confidence: 0.9,
    };
  }
  const routineRun = text.match(/\b(?:run|chalao|chala do|execute)\s+(?:the\s+|my\s+)?([a-z0-9 _-]{2,30})\s*routine\b/i)
    ?? text.match(/\b([a-z0-9 _-]{2,30})\s+routine\s+(?:run|chalao)\b/i);
  if (routineRun) {
    const name = routineRun[1].trim();
    return {
      ...base,
      action: "routines",
      target: name,
      query: name,
      isTask: true,
      isMultiStep: false,
      steps: [{ action: "routine_run", target: name, params: { name }, description: `Run the "${name}" routine` }],
      summary: `Ran the ${name} routine`,
      confidence: 0.9,
    };
  }
  const routineSave = text.match(/\b(?:save|create|make|banao|bana)\s+(?:a\s+)?routine\s+(?:called|named)?\s*([a-z0-9 _-]{2,30}?)(?=\s+(?:that|which|with|for|to)\b|\s*$)/i);
  if (routineSave) {
    const name = routineSave[1].trim();
    // Deterministic step inference for the documented patterns; anything else
    // goes to the agent tier to build the JSON properly.
    const steps: TaskStep[] = [];
    if (/organize|clean|saaf/.test(text) && /downloads/i.test(text)) {
      steps.push({
        action: "routine_save",
        target: name,
        params: {
          name,
          steps: JSON.stringify([{ kind: "quest", questId: "organize-downloads" }]),
        },
        description: `Save the "${name}" routine (organize downloads)`,
      });
    } else if (/morning|brief/.test(text)) {
      steps.push({
        action: "routine_save",
        target: name,
        params: {
          name,
          steps: JSON.stringify([{ kind: "quest", questId: "morning-brief" }]),
        },
        description: `Save the "${name}" routine (morning brief)`,
      });
    } else {
      return {
        ...base,
        action: "routines",
        target: name,
        query: "",
        isTask: true,
        isMultiStep: false,
        steps: [],
        summary: "Needs help building the routine",
        confidence: 0.4,
        needsModelAssist: true,
      };
    }
    return {
      ...base,
      action: "routines",
      target: name,
      query: "",
      isTask: true,
      isMultiStep: false,
      steps,
      summary: `Saved the ${name} routine`,
      confidence: 0.88,
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

  // Bare "double click" / "right click" — act at the CURRENT cursor position
  // (the executor resolves the live cursor; never a blind corner click).
  const bareClickVar = text.match(/^(double|right)\s+click$/);
  if (bareClickVar) {
    const variant = bareClickVar[1] === "double" ? "double" : "right";
    return {
      ...base,
      action: "click",
      target: "cursor",
      query: variant,
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "click",
        target: "cursor",
        params: { variant },
        description: variant === "double" ? "Double-click at the cursor" : "Right-click at the cursor",
      }],
      summary: variant === "double" ? "Double-clicked" : "Right-clicked",
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

  // ─── SWITCH GMAIL / MAIL ACCOUNT ──────────────────────────────────────────
  // "switch my gmail" → flip the MailWing default (or open the other signed-in
  // Gmail account on the web when no vault accounts exist); "switch gmail to
  // a@gmail.com" → THAT account. Precise adjacency — "email my second client"
  // must NOT hit this.
  const SWITCH_MAIL =
    /\b(?:switch|change|toggle)\b[^.]{0,24}\b(?:gmail|mail|account)\b/i.test(raw) ||
    /\b(?:gmail|mail)\b[^.]{0,16}\b(?:switch|change)\b/i.test(raw) ||
    /\b(?:doosre|dusre|doosra|dusra|other|another|second|agle|agla|next)\s+(?:gmail|mail|account)\b/i.test(raw);
  if (SWITCH_MAIL && !/\b(write|compose|draft|likh|bhej|reply)\b/i.test(text)) {
    const account = extractAccountEmail(raw) ?? (((raw.match(/\bto\s+([\w.-]+)/i)?.[1] ?? "").trim()) || null);
    return {
      ...base,
      action: "switch_mail_account",
      target: account ?? "other",
      query: "",
      isTask: true,
      isMultiStep: false,
      steps: [{
        action: "mailwing_accounts",
        target: account ?? "other",
        params: {
          op: "switch",
          ...(account ? { account } : {}),
        },
        description: account ? `Switch the default mail account to ${account}` : "Switch to the other mail account",
      }],
      summary: account ? `Switched mail account to ${account}` : "Switched mail account",
      confidence: 0.85,
    };
  }

  // ─── COMPOSE EMAIL / MESSAGE ─────────────────────────────────────────────
  // Verbs include Hinglish: likh / likho / likhna. "email" itself counts as a
  // verb ONLY in verb position ("email to …") — "open my email" stays an OPEN.
  // The executor bakes to/subject/body INTO the Gmail compose URL — a blank
  // compose window is a bug, not a feature.
  const COMPOSE_VERB = /\b(write|compose|draft|reply|likh|likho|likhna|bhej|bhejo)\b/i;
  const EMAIL_VERB = /^\s*email\b/i.test(text);
  if (/\b(gmail|mail|email)\b/.test(text) && (COMPOSE_VERB.test(text) || EMAIL_VERB) && !/\b(send|bhej|bhejo)\b/.test(text)) {
    const toMatch = raw.match(/\bto\s+([^,.;]+?)(?:\s+(?:about|subject|with|regarding|saying)\b|$)/i);
    const subjectMatch = raw.match(/\b(?:subject|about|regarding)\s+([^,.;]+?)(?:\s+(?:body|message|content|saying)\b|$)/i);
    // Body: "saying X" / "body X" / "... likh ki X"
    const bodyMatch = raw.match(/\b(?:saying|body|message|likh\s*ki|keh\s*do\s*ki|kehna\s*ki)\s+(.+)$/i);
    const body = bodyMatch?.[1]?.trim() ?? "";
    const emailInRaw = raw.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
    const to = (toMatch?.[1]?.trim() || emailInRaw?.[0] || "").trim();
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
          to,
          subject: subjectMatch?.[1]?.trim() ?? "",
          body,
          // The ActionEngine contract requires a truthy text slot — this is
          // the on-screen draft summary, always non-empty.
          text: body || subjectMatch?.[1]?.trim() || (to ? `Email to ${to}` : "New email"),
        },
        description: `Draft an email${to ? ` to ${to}` : ""}${subjectMatch?.[1] ? ` about ${subjectMatch[1].trim()}` : ""}`,
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
