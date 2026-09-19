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
      return "EXTERNAL";

    // ── DESTRUCTIVE: deletes / overrides / sends / raw shell ────────────
    case "process_kill":
    case "run_command":
    case "compose_message":
    case "compose_email":
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
