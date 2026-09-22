// Quip Action Engine — Tool Contracts (spec Phase 2 + §19 + §20)
// ─────────────────────────────────────────────────────────────────────────────
// Every action the engine may run has an EXPLICIT contract:
//
//   name · purpose · inputs(+required) · safety class · timeout ·
//   expected result · failure states · verification method
//
// §19 safety classes — every action is exactly one of:
//   READ        observes the machine, changes nothing
//   WRITE       changes machine/UI/file state (launching, typing, pasting…)
//   DESTRUCTIVE deletes/overrides/sends — always confirmed, any mode
//   EXTERNAL    crosses the network boundary (sites, searches, readers)
//
// §20 execution-layer authority — the engine validates every plan step
// against its contract BEFORE running it. A malformed or unknown step is
// refused honestly; the engine never "tries something plausible".
// ─────────────────────────────────────────────────────────────────────────────

import { riskForStep, type RiskLevel } from "../engine/permission-modes";

export type SafetyClass = "READ" | "WRITE" | "DESTRUCTIVE" | "EXTERNAL";

export interface ToolContract {
  name: string;
  purpose: string;
  /** Input slots the action needs; `required` ones must be present post-parse. */
  inputs: { slot: string; required: boolean; desc: string }[];
  safety: SafetyClass;
  timeoutMs: number;
  expectedResult: string;
  /** Honest failure states this action can end in (never hidden from the user). */
  failureStates: string[];
  verification: string;
}

/** Where required inputs come from when the parser filled only some slots. */
const TARGET_FALLBACKS = ["query", "appName", "url", "location", "op", "text"];

/** Deterministic §19 classification (params-aware for compound actions). */
export function safetyClass(action: string, params: Record<string, string> = {}): SafetyClass {
  switch (action) {
    // ── EXTERNAL: crosses the network boundary ──────────────────────────
    case "open_website":
    case "open_url":
    case "search_web":
    case "search_youtube":
    case "site_search":
    case "read_page":
    case "play_media":
    case "weather":
    case "github_read":
    case "reddit_read":
    case "rss_read":
    case "v2ex_read":
    case "bilibili_read":
    case "tweet_read":
    case "youtube_read":
    case "web_ghost_read":
    case "web_ghost_extract":
    case "web_ghost_click":
    case "web_ghost_fill":
    case "web_ghost_wait":
    case "web_ghost_screenshot":
      return "EXTERNAL";

    // ── DESTRUCTIVE: deletes / overrides / sends / raw shell ────────────
    case "process_kill":
    case "run_command":
    case "compose_message":
    case "compose_email":
    case "mailwing_send":
    case "lock_pc":
    case "install_app":
    case "quest_run":
    case "routine_run":
      return "DESTRUCTIVE";

    // ── READ: pure observation ──────────────────────────────────────────
    case "screen":
    case "screen_observe":
    case "windows_list":
    case "process_list":
    case "app_list":
    case "sys_info":
    case "network_info":
    case "self_check":
    case "summarize":
    case "pdf_read":
    case "docx_read":
    case "mailwing_outbox":
    case "contacts_search":
    case "file_storage_report":
    case "battery":
    case "clipboard_history":
    case "routine_list":
    case "problem_diary":
      return "READ";

    // file_op is compound — the op decides
    case "file_op": {
      switch (params.op) {
        case "delete":
        case "move":
          return "DESTRUCTIVE";
        case "write":
        case "append":
        case "mkdir":
          return "WRITE";
        default:
          return "READ";
      }
    }

    // file_organize is compound — planning is a dry run, applying moves files.
    case "file_organize": {
      return params.op === "apply" || params.op === "undo" ? "DESTRUCTIVE" : "READ";
    }

    // file_duplicates only destroys when clean=true was requested.
    case "file_duplicates": {
      return params.clean === "true" ? "DESTRUCTIVE" : "READ";
    }

    // mailwing_accounts: the test op opens a real SMTP session (EXTERNAL),
    // everything else only reads the local vault.
    case "mailwing_accounts": {
      return params.op === "test" ? "EXTERNAL" : "READ";
    }

    // Everything else changes local state: launching, focusing, typing,
    // clicking, pasting, window/tab/volume control, speaking, doc creation.
    default:
      return "WRITE";
  }
}

// ─── The contract registry (one row per real executor) ──────────────────────

const C = (
  name: string,
  purpose: string,
  inputs: [string, boolean, string][],
  safety: SafetyClass,
  timeoutMs: number,
  expectedResult: string,
  failureStates: string[],
  verification: string
): ToolContract => ({
  name,
  purpose,
  inputs: inputs.map(([slot, required, desc]) => ({ slot, required, desc })),
  safety,
  timeoutMs,
  expectedResult,
  failureStates,
  verification,
});

export const TOOL_CONTRACTS: Record<string, ToolContract> = {
  // Apps & windows
  open_app: C("open_app", "Launch an installed desktop application",
    [["target", true, "app name as spoken"]], "WRITE", 15_000,
    "the app's process or window is visible",
    ["app-not-installed", "launch-failed", "timeout"], "processExists + windowWithTitleExists"),
  focus_app: C("focus_app", "Bring an already-running app's window to the front",
    [["target", true, "app name"]], "WRITE", 8_000,
    "the app's window is focused",
    ["not-running", "window-not-found"], "focused window query"),
  close_app: C("close_app", "Close an application's windows",
    [["target", true, "app name"]], "WRITE", 8_000,
    "the app's windows are closed",
    ["not-running", "close-refused"], "window/process recheck"),
  window_control: C("window_control", "Minimize / maximize / restore / move a window",
    [["op", true, "window operation"], ["target", false, "window title hint"]], "WRITE", 8_000,
    "the window is in the requested state",
    ["window-not-found", "op-unsupported"], "window state query"),
  window_snap: C("window_snap", "Snap a window to the left/right half, maximize or restore",
    [["preset", true, "left|right|maximize|restore"], ["window", false, "window title hint"]], "WRITE", 10_000,
    "the window occupies the snapped rect (move + resize both verified)",
    ["unknown-preset", "window-not-found", "no-workarea"], "snap rect + move/resize results"),
  windows_list: C("windows_list", "Enumerate open window titles",
    [], "READ", 8_000, "window titles were enumerated",
    ["desktop-query-failed"], "observation returned list"),

  // Browser & external
  open_website: C("open_website", "Open a known website in the user's real browser",
    [["url", true, "https URL"]], "EXTERNAL", 15_000,
    "the browser is open on the site",
    ["unsafe-url", "browser-failed"], "windowWithTitleExists"),
  open_url: C("open_url", "Open an exact URL in the user's browser",
    [["url", true, "https URL"]], "EXTERNAL", 15_000,
    "the URL is open in the browser",
    ["unsafe-url", "browser-failed"], "windowWithTitleExists"),
  search_web: C("search_web", "Run a web search in the user's browser",
    [["query", true, "search text"]], "EXTERNAL", 20_000,
    "the results page is open",
    ["browser-failed"], "URL observation"),
  site_search: C("site_search", "Search within one site via the browser",
    [["query", true, "search text"], ["target", true, "site name"]], "EXTERNAL", 20_000,
    "the site's results are visible",
    ["unknown-site", "browser-failed"], "URL observation"),
  search_youtube: C("search_youtube", "Open YouTube search results for a query",
    [["query", true, "search text"]], "EXTERNAL", 20_000,
    "YouTube results (or the video) are open",
    ["browser-failed", "no-results"], "URL observation"),
  play_media: C("play_media", "Find the best match for a song/video and play it",
    [["query", true, "media name"], ["youtube", false, "force YouTube when 'true'"]], "EXTERNAL", 25_000,
    "the best-matching video is open and playback observed (or the honest limit stated)",
    ["empty-query", "no-confident-match", "browser-failed", "playback-unconfirmed"],
    "search → understand → open → observe tab title"),
  read_page: C("read_page", "Read a public web page as clean text",
    [["url", true, "https URL"]], "EXTERNAL", 20_000,
    "page text was captured",
    ["unsafe-url", "fetch-failed", "empty-page"], "observation returned content"),
  browser_tab: C("browser_tab", "New / close / switch browser tabs via shortcuts",
    [["op", true, "tab operation"]], "WRITE", 8_000,
    "the tab operation took effect",
    ["op-unsupported"], "tab state"),

  // Screen vision & pointer
  screen: C("screen", "Capture and describe the screen",
    [], "READ", 12_000, "a screenshot was captured and inspected",
    ["capture-failed", "vision-unavailable"], "observation returned content"),
  screen_observe: C("screen_observe", "Screenshot → vision model → structured description",
    [], "READ", 15_000, "a structured screen description returned",
    ["capture-failed", "vision-unavailable"], "observation returned content"),
  screen_click_element: C("screen_click_element", "Vision-guided click on a described element",
    [["target", true, "element description"]], "WRITE", 20_000,
    "the click landed on the intended element (post-click screenshot checked)",
    ["element-not-found", "coords-not-found", "click-refused"], "post-action screenshot"),
  screen_type_into: C("screen_type_into", "Vision-guided focus + type into a field",
    [["target", true, "field description"], ["text", true, "text to type"]], "WRITE", 20_000,
    "the text landed in the intended field",
    ["field-not-found", "type-refused"], "post-action screenshot"),
  click: C("click", "Click at the cursor (or variant: double/right)",
    [["variant", false, "double|right"]], "WRITE", 8_000,
    "the click landed on the intended target",
    ["injection-refused"], "post-action observation"),
  double_click: C("double_click", "Double-click at the cursor",
    [], "WRITE", 8_000, "the double click registered",
    ["injection-refused"], "post-action observation"),
  right_click: C("right_click", "Right-click at the cursor",
    [], "WRITE", 8_000, "the context menu opened",
    ["injection-refused"], "post-action observation"),
  scroll: C("scroll", "Scroll the view up/down",
    [["direction", true, "up|down"], ["amount", false, "clicks"]], "WRITE", 8_000,
    "the view scrolled",
    ["injection-refused"], "post-action observation"),
  mouse_move: C("mouse_move", "Move the cursor to a point",
    [["x", true, "x coordinate"], ["y", true, "y coordinate"]], "WRITE", 8_000,
    "the cursor reached the target point",
    ["coords-out-of-range"], "pointer position"),
  drag: C("drag", "Drag from one point to another",
    [["fromX", true, "start x"], ["fromY", true, "start y"], ["toX", true, "end x"], ["toY", true, "end y"]],
    "WRITE", 10_000, "the drag completed between both points",
    ["injection-refused"], "post-action observation"),

  // Keyboard & clipboard
  type_text: C("type_text", "Type text into the focused window",
    [["text", true, "text to type"]], "WRITE", 10_000,
    "the text landed in the focused window",
    ["injection-refused"], "post-action observation"),
  press_key: C("press_key", "Press a key / shortcut in the focused window",
    [["key", true, "key or combo"]], "WRITE", 8_000,
    "the key was accepted by the focused window",
    ["unknown-key", "injection-refused"], "post-action observation"),
  clipboard: C("clipboard", "Read or write the clipboard",
    [["op", true, "copy|paste"], ["text", false, "text for copy"]], "WRITE", 8_000,
    "the clipboard now holds the expected content",
    ["op-unsupported", "readback-mismatch"], "clipboard read-back"),
  copy_paste: C("copy_paste", "Copy then paste via selection + shortcut",
    [], "WRITE", 8_000, "the copied content was pasted",
    ["injection-refused"], "post-action observation"),
  write_text: C("write_text", "Type a block of text (alias of type_text)",
    [["text", true, "text to type"]], "WRITE", 10_000,
    "the text landed in the focused window",
    ["injection-refused"], "post-action observation"),

  // Files & documents
  open_folder: C("open_folder", "Open a folder in File Explorer",
    [["query", true, "folder name"]], "WRITE", 12_000,
    "a File Explorer window shows the folder",
    ["folder-not-found"], "windowWithTitleExists"),
  open_file: C("open_file", "Open a file with its associated app",
    [["query", true, "file name"]], "WRITE", 12_000,
    "the file's associated app opened it",
    ["file-not-found"], "windowWithTitleExists"),
  create_folder: C("create_folder", "Create a new folder",
    [["query", true, "folder name"]], "WRITE", 10_000,
    "the folder exists on disk",
    ["invalid-path", "exists-conflict"], "filesystem re-check"),
  organize_files: C("organize_files", "Organize files in a folder by rule",
    [["target", false, "folder"], ["rule", false, "organize rule"]], "WRITE", 20_000,
    "the folder's contents match the requested organization",
    ["folder-not-found", "partial-moves"], "filesystem re-check"),
  file_op: C("file_op", "Read / write / append / mkdir / move / delete a file",
    [["op", true, "file operation"], ["path", true, "file path"]], "READ", 10_000,
    "the filesystem shows the requested change",
    ["file-not-found", "permission-denied", "invalid-path"], "filesystem re-check"),
  pdf_read: C("pdf_read", "Extract text from a PDF file",
    [["path", true, "pdf path"]], "READ", 15_000,
    "the PDF's text was extracted",
    ["file-not-found", "scanned-image", "encrypted"], "extraction returned text"),
  docx_read: C("docx_read", "Extract text from a .docx file",
    [["path", true, "docx path"]], "READ", 15_000,
    "the document's text was extracted",
    ["file-not-found", "bad-zip"], "extraction returned text"),
  doc_create: C("doc_create", "Create a real .docx / .xlsx / .pptx document",
    [["kind", true, "docx|xlsx|pptx"], ["content", true, "document content"]], "WRITE", 20_000,
    "the file exists and opens as a valid OOXML document",
    ["invalid-kind", "write-failed"], "write → read-back"),
  summarize: C("summarize", "Summarize the last read page or given text",
    [["text", false, "text to summarize"]], "READ", 25_000,
    "a summary grounded in the source was produced",
    ["nothing-to-summarize", "model-unavailable"], "summary returned"),

  // System
  process_list: C("process_list", "Enumerate running processes",
    [], "READ", 10_000, "the process list was enumerated",
    ["query-failed"], "observation returned list"),
  process_kill: C("process_kill", "Kill a process by name/pid",
    [["target", true, "process name or pid"]], "DESTRUCTIVE", 10_000,
    "the process no longer exists",
    ["not-found", "access-denied"], "processExists → false"),
  run_command: C("run_command", "Run a shell command (real shell, 20s cap)",
    [["command", true, "command line"]], "DESTRUCTIVE", 20_000,
    "the command ran and its output was captured",
    ["timeout", "non-zero-exit", "deny-list"], "exit code + output capture"),
  system_action: C("system_action", "System-level actions (lock, brightness…)",
    [["op", true, "system operation"]], "WRITE", 10_000,
    "the system action completed",
    ["op-unsupported", "access-denied"], "system state query"),
  volume: C("volume", "Set / mute / step system volume",
    [["level", false, "0-100"], ["op", false, "mute|unmute|up|down"]], "WRITE", 8_000,
    "the system volume reflects the request",
    ["query-failed"], "volume query"),
  media_key: C("media_key", "Send play/pause/next/previous media keys",
    [["key", true, "media key"]], "WRITE", 8_000,
    "the player responded to the media key",
    ["unknown-key"], "player state"),
  self_check: C("self_check", "Probe every device capability honestly",
    [], "READ", 30_000, "every capability probe returned its honest result",
    ["partial-probe-failure"], "probe report"),

  // Info & reach
  sys_info: C("sys_info", "CPU / RAM / disk / battery status",
    [], "READ", 10_000, "real system stats were read",
    ["query-failed"], "CIM//proc output"),
  network_info: C("network_info", "Network adapters / connectivity status",
    [], "READ", 10_000, "real network status was read",
    ["query-failed"], "ipconfig//netsh output"),
  app_list: C("app_list", "List installed applications",
    [], "READ", 10_000, "the installed-app index was listed",
    ["empty-index"], "cached index"),
  weather: C("weather", "Real weather via open-meteo (no key)",
    [["location", true, "place name"]], "EXTERNAL", 15_000,
    "current conditions for the location were fetched",
    ["geocode-failed", "fetch-failed"], "API returned data"),
  speak: C("speak", "Speak a line aloud through the TTS chain",
    [["text", true, "line to speak"]], "WRITE", 20_000,
    "the line was handed to a speech engine",
    ["all-engines-failed"], "engine accepted utterance"),

  // Agent-Reach readers
  youtube_read: C("youtube_read", "Read YouTube channel/video public data",
    [["query", true, "channel or video"]], "EXTERNAL", 15_000,
    "public YouTube data was read",
    ["not-found", "fetch-failed"], "API returned data"),
  github_read: C("github_read", "Read public GitHub repo metadata/README/search",
    [["query", true, "repo or query"]], "EXTERNAL", 15_000,
    "public GitHub data was read",
    ["not-found", "rate-limited"], "API returned data"),
  reddit_read: C("reddit_read", "Read public subreddit/post JSON",
    [["query", true, "subreddit or post"]], "EXTERNAL", 15_000,
    "public Reddit data was read",
    ["not-found", "fetch-failed"], "API returned data"),
  rss_read: C("rss_read", "Read an RSS/Atom feed",
    [["url", true, "feed URL"]], "EXTERNAL", 15_000,
    "feed entries were parsed",
    ["bad-feed", "fetch-failed"], "parse returned entries"),
  v2ex_read: C("v2ex_read", "Read public V2EX topics",
    [["query", false, "topic hint"]], "EXTERNAL", 15_000,
    "public V2EX data was read",
    ["fetch-failed"], "API returned data"),
  bilibili_read: C("bilibili_read", "Search public Bilibili videos",
    [["query", true, "search text"]], "EXTERNAL", 15_000,
    "public Bilibili results were read",
    ["fetch-failed"], "API returned data"),
  tweet_read: C("tweet_read", "Read a public tweet by URL/id",
    [["query", true, "tweet URL or id"]], "EXTERNAL", 15_000,
    "the public tweet's content was read",
    ["not-found", "search-refused"], "API returned data"),

  // Messaging composition (dangerous — always confirmed; real send needs a
  // human-visible surface, so these compose drafts rather than auto-send).
  compose_message: C("compose_message", "Open a chat app with a drafted message",
    [["target", true, "app or contact"], ["text", true, "message text"]], "DESTRUCTIVE", 15_000,
    "the draft is visible on screen for the user to review and send",
    ["app-not-found", "draft-refused"], "draft visible on screen"),
  compose_email: C("compose_email", "Open the mail app with a drafted email",
    [["target", false, "recipient"], ["text", true, "email body"]], "DESTRUCTIVE", 15_000,
    "the draft is visible on screen for the user to review and send",
    ["mail-not-found", "draft-refused"], "draft visible on screen"),

  // ── Autonomy wave (roadmap A–F) — every new executor has an honest contract ──

  // Ghost browser: reads/acts on pages Quip itself loaded (EXTERNAL boundary).
  web_ghost_read: C("web_ghost_read", "Read a JS-rendered page through Quip's offscreen ghost browser",
    [["url", true, "page URL"]], "EXTERNAL", 25_000,
    "the page title and visible text were captured",
    ["unsafe-url", "load-failed", "script-timeout", "nav-budget-spent"], "page title + text length reported"),
  web_ghost_extract: C("web_ghost_extract", "Extract emails/phones from a website into the Contacts Book",
    [["url", true, "page URL"]], "EXTERNAL", 45_000,
    "contacts (or an honest zero) were found and reported",
    ["unsafe-url", "load-failed", "no-contacts", "script-timeout"], "per-contact list with source page"),
  web_ghost_click: C("web_ghost_click", "Click an element by visible text inside the ghost browser",
    [["url", true, "page URL"], ["element", true, "visible text to click"]], "EXTERNAL", 30_000,
    "the element was found and clicked, or an honest no-match",
    ["unsafe-url", "no-match", "load-failed"], "clicked label reported"),
  web_ghost_fill: C("web_ghost_fill", "Fill form fields inside the ghost browser",
    [["url", true, "page URL"], ["fields", true, "JSON [{hint,value,selector?}]"]], "EXTERNAL", 30_000,
    "each field is reported filled or not-found",
    ["unsafe-url", "bad-fields-json", "load-failed"], "per-field fill report"),
  web_ghost_wait: C("web_ghost_wait", "Wait (bounded) until text appears in the ghost page — anti-race for multi-step flows",
    [["text", true, "text to wait for"], ["timeout", false, "seconds (2-30)"]], "EXTERNAL", 35_000,
    "the text appeared before the deadline, or an honest timeout",
    ["missing-text", "wait-timeout", "no-session"], "waited duration + page title"),
  web_ghost_screenshot: C("web_ghost_screenshot", "Capture the ghost page as a PNG saved to Pictures/Quip",
    [["url", true, "page URL"]], "EXTERNAL", 30_000,
    "a real PNG on disk with its byte size",
    ["unsafe-url", "capture-empty", "write-failed", "load-failed"], "file path + byte size"),

  // MailWing: real email. Draft is WRITE (stages, sends nothing); send is
  // DESTRUCTIVE (always confirmed; verified only by SMTP 250).
  mailwing_draft: C("mailwing_draft", "Write and humanize an email draft, staged for approval",
    [["to", true, "recipient email"], ["body", true, "rough content / points"]],
    "WRITE", 30_000,
    "a staged draft with To/Subject/Body the user can approve",
    ["missing-recipient", "missing-body"], "draft preview shown in chat"),
  mailwing_send: C("mailwing_send", "Send the staged draft via SMTP (or open prefilled Gmail when no account)",
    [["account", false, "account label/id"]], "DESTRUCTIVE", 45_000,
    "SMTP 250 for the final message dot, or a prefilled Gmail draft opened",
    ["no-staged-draft", "smtp-auth", "smtp-5xx", "smtp-timeout", "vault-locked"], "server reply + stage in evidence"),
  mailwing_accounts: C("mailwing_accounts", "List/add/remove/test MailWing SMTP accounts",
    [["op", false, "list|add|remove|test"]], "READ", 25_000,
    "accounts listed without secrets, or the op's honest result",
    ["missing-fields", "test-failed"], "host:port + TLS + auth capability"),
  mailwing_outbox: C("mailwing_outbox", "Show the last MailWing sends with status",
    [], "READ", 5_000, "outbox entries with sent/failed status",
    ["journal-unreadable"], "persisted journal read"),

  // Contacts Book.
  contacts_search: C("contacts_search", "Search the local contacts book by name/email/company",
    [["query", true, "who to find"]], "READ", 5_000, "scored matches with sources",
    ["no-hit"], "match list with source tracking"),
  contacts_save: C("contacts_save", "Save/merge a contact (email or phone required)",
    [["email", false, "email address"], ["phone", false, "phone number"]], "WRITE", 5_000,
    "the contact exists in the book, merged if it already did",
    ["invalid-email", "invalid-phone"], "contact id returned"),
  contacts_export: C("contacts_export", "Export the contacts book to CSV",
    [["path", false, "target CSV path"]], "WRITE", 10_000, "a CSV file on disk with all contacts",
    ["empty-book", "write-failed"], "file path + count"),

  // FileButler: plan/apply are separate steps — approval sees the real plan.
  file_organize: C("file_organize", "Organize a folder by type/date (plan → approve → apply → undo)",
    [["dir", true, "folder to organize"], ["op", false, "plan|apply|undo"]],
    "DESTRUCTIVE", 60_000,
    "a staged plan (dry-run) or the applied move count with a manifest id",
    ["denied-dir", "no-staged-plan", "move-failed", "no-manifest"], "manifest journal + per-move evidence"),
  file_duplicates: C("file_duplicates", "Find duplicate files (size → SHA-256), optionally trash extra copies",
    [["dir", true, "folder to scan"], ["clean", false, "true = trash extra copies"]], "DESTRUCTIVE", 90_000,
    "duplicate groups reported, extras only trashed when clean=true",
    ["denied-dir", "scan-failed"], "group count + reclaimed size"),
  file_storage_report: C("file_storage_report", "Report sizes, counts and biggest files in a folder",
    [["dir", true, "folder to report"]], "READ", 30_000, "totals by category + top files",
    ["denied-dir", "scan-failed"], "byte counts per category"),
  file_watch: C("file_watch", "Watch a folder and auto-organize new files (toasted + journaled)",
    [["op", false, "start|stop|status"], ["dir", false, "folder to watch"]], "WRITE", 10_000,
    "watch state reported; every auto-move is toasted and journaled",
    ["denied-dir", "watch-failed"], "watch status list"),

  // GhostHands: deep system control.
  screenshot_save: C("screenshot_save", "Capture the screen to a PNG in Pictures and reveal it",
    [["dir", false, "target folder"]], "WRITE", 15_000, "a real PNG file with its byte size",
    ["capture-empty", "write-failed"], "file path + byte size"),
  wallpaper_set: C("wallpaper_set", "Set the desktop wallpaper from a local image or https URL",
    [["source", true, "image path or URL"]], "WRITE", 25_000, "SystemParametersInfo accepted the image",
    ["unsafe-url", "download-failed", "file-missing", "unsupported-platform"], "PowerShell SPI result"),
  brightness: C("brightness", "Get or set laptop screen brightness (WMI)",
    [["action", false, "get|set"], ["level", false, "1-100"]], "WRITE", 10_000,
    "WmiSetBrightness accepted, or the current level read",
    ["invalid-level", "unsupported-platform"], "WMI reply"),
  notify_me: C("notify_me", "Show a real OS notification",
    [["body", true, "notification text"]], "WRITE", 5_000, "the toast was shown",
    ["notify-unsupported", "notify-failed"], "Electron Notification shown"),
  lock_pc: C("lock_pc", "Lock the workstation (Win+L equivalent) — always confirmed",
    [], "DESTRUCTIVE", 8_000, "the session locked",
    ["unsupported-platform", "lock-failed"], "LockWorkStation accepted"),
  battery: C("battery", "Read battery percentage and charging state",
    [], "READ", 10_000, "battery % + charging state, or an honest none",
    ["battery-unsupported", "battery-unknown"], "Win32_Battery values"),
  clipboard_history: C("clipboard_history", "Show Quip's session clipboard history ring",
    [], "READ", 3_000, "the ring contents with origins",
    ["empty-ring"], "entry count + origins"),
  install_app: C("install_app", "Install an app via winget (proposed command, approval-gated)",
    [["query", true, "app to install"]], "DESTRUCTIVE", 120_000,
    "winget ran and reported its real result",
    ["deny-listed", "command-failed", "timeout"], "winget output in evidence"),

  // Quests & routines.
  quest_run: C("quest_run", "Run a named multi-step quest (email-from-website, organize-downloads, morning-brief)",
    [["kind", true, "quest id"], ["url", false, "email-from-website source URL"]], "DESTRUCTIVE", 120_000,
    "every quest step verified, or the quest stopped honestly at the failing step",
    ["unknown-quest", "no-contacts", "send-declined", "smtp-failed", "plan-declined"], "per-step notes in output"),
  routine_save: C("routine_save", "Save a named routine (JSON step chain)",
    [["name", true, "routine name"], ["steps", true, "JSON steps"]], "WRITE", 5_000,
    "the routine persisted with its step count",
    ["missing-name", "bad-steps-json"], "routine id"),
  routine_run: C("routine_run", "Run a saved routine step-by-step",
    [["name", true, "routine name"]], "DESTRUCTIVE", 180_000,
    "every step ran with its result, failures reported honestly",
    ["unknown-routine", "step-failed"], "per-step result lines"),
  routine_list: C("routine_list", "List saved routines",
    [], "READ", 3_000, "routine names with step counts",
    ["no-routines"], "routine count"),
  problem_diary: C("problem_diary", "The Problem Diary: list / resolve / export every failure Quip recorded",
    [["verb", false, "list|resolve|export|clear"], ["id", false, "resolve: problem number or id"], ["source", false, "list: filter by source"]],
    "READ", 5_000, "open problems with severity + counts, or the export path",
    ["empty-diary", "resolve-failed", "export-failed"], "entry ids + severity in output"),
};

export function contractFor(action: string): ToolContract | null {
  return TOOL_CONTRACTS[action] ?? null;
}

/** Every contracted action — proves plan steps only reference real tools. */
export function contractedActions(): string[] {
  return Object.keys(TOOL_CONTRACTS);
}

// ─── §20 validation — the execution layer is authoritative ──────────────────

export interface StepIssue {
  slot: string;
  problem: string;
}

/**
 * Validate one plan step against its contract BEFORE anything runs.
 * Returns the issues found; an empty array means the step may run.
 * Unknown actions are ALWAYS invalid — the engine never legacy-falls-back
 * on a name it does not have a contract for (spec §2 zero random execution).
 */
export function validateStep(step: {
  action: string;
  target: string;
  params: Record<string, string>;
}): StepIssue[] {
  const contract = contractFor(step.action);
  if (!contract) return [{ slot: "action", problem: `no contract for action "${step.action}"` }];

  const issues: StepIssue[] = [];
  // Params must be string-valued (plan steps come from parses/models — §20).
  for (const [k, v] of Object.entries(step.params ?? {})) {
    if (typeof v !== "string") {
      issues.push({ slot: k, problem: "param value must be a string" });
    }
  }

  for (const input of contract.inputs) {
    if (!input.required) continue;
    const has =
      (step.params?.[input.slot]?.trim() ?? "") !== "" ||
      (input.slot === "target" &&
        (TARGET_FALLBACKS.some((f) => (step.params?.[f]?.trim() ?? "") !== "") ||
          (step.target ?? "").trim() !== ""));
    if (!has) issues.push({ slot: input.slot, problem: `missing required input "${input.slot}"` });
  }
  return issues;
}

/** Risk level for a step (delegates to the permission system's own table). */
export function riskOf(action: string, params: Record<string, string>): RiskLevel {
  return riskForStep(action, params);
}
