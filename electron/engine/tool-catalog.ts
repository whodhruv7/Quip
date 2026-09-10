// Quip Execution Engine V3 — Tool Catalog for the Agent Loop
// ─────────────────────────────────────────────────────────────────────────────
// The model-facing catalog of every REAL tool Quip can execute. Each entry
// maps 1:1 onto an executor in tool-registry.ts — nothing here is simulated.
//
// Skales integration note: this catalog implements the same capability
// surface as Skales' actions/computer-use.ts + actions/browser-control.ts
// (file ops, command execution, screenshots, vision-driven clicking, web
// reading) — but pointed at the user's REAL desktop and REAL browser,
// never an embedded surface.
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolSchema } from "../system/model-router";

export interface CatalogEntry {
  schema: ToolSchema;
  /** Human description shown in progress UI when this tool runs. */
  progress: string;
}

function fn(
  name: string,
  description: string,
  params: Record<string, { type: string; description: string; enum?: string[] }>,
  required: string[],
  progress: string
): CatalogEntry {
  return {
    schema: {
      type: "function",
      function: {
        name,
        description,
        parameters: {
          type: "object",
          properties: Object.fromEntries(
            Object.entries(params).map(([k, v]) => [
              k,
              { type: v.type, description: v.description, ...(v.enum ? { enum: v.enum } : {}) },
            ])
          ),
          required,
        },
      },
    },
    progress,
  };
}

/** Every real capability the agent may use. Order = presentation order. */
export const TOOL_CATALOG: CatalogEntry[] = [
  // ── Apps & windows ────────────────────────────────────────────────────────
  fn("open_app", "Open an installed application by name (e.g. 'vs code', 'chrome', 'whatsapp'). Fails honestly when the app is not installed.", {
    query: { type: "string", description: "App name as the user said it" },
  }, ["query"], "Opening app…"),
  fn("app_list", "List installed applications. Use when unsure what apps exist.", {}, [], "Listing installed apps…"),
  fn("focus_app", "Bring an already-running application's window to the front.", {
    target: { type: "string", description: "App or window title to focus" },
  }, ["target"], "Focusing window…"),
  fn("close_app", "Close an application's windows gracefully.", {
    target: { type: "string", description: "App or window title to close" },
  }, ["target"], "Closing app…"),
  fn("window_control", "Minimize, maximize, restore, move or resize a window.", {
    op: { type: "string", enum: ["minimize", "maximize", "restore", "move", "resize"], description: "Window operation" },
    target: { type: "string", description: "Window/app title (optional)" },
    x: { type: "string", description: "move: new x" },
    y: { type: "string", description: "move: new y" },
    width: { type: "string", description: "resize: width" },
    height: { type: "string", description: "resize: height" },
  }, ["op"], "Adjusting window…"),
  fn("windows_list", "List all open desktop windows with titles. Use to see what's on screen before acting.", {}, [], "Checking open windows…"),

  // ── Web, search, reading (Agent-Reach role) ──────────────────────────────
  fn("open_website", "Open a website in the user's real default browser by full URL.", {
    url: { type: "string", description: "Full https:// URL to open" },
  }, ["url"], "Opening website…"),
  fn("search_web", "Search Google in the user's real browser.", {
    query: { type: "string", description: "Search text" },
  }, ["query"], "Searching the web…"),
  fn("search_youtube", "Search YouTube in the user's real browser.", {
    query: { type: "string", description: "Search text" },
  }, ["query"], "Searching YouTube…"),
  fn("play_media", "Play a song/video on YouTube (verified playback) or open another media URL.", {
    query: { type: "string", description: "Song or video to play" },
    youtube: { type: "string", enum: ["true", "false"], description: "true = YouTube playback with verification" },
  }, ["query"], "Starting playback…"),
  fn("read_page", "Read a web page's text content (Agent-Reach reader). Use to actually READ what a page says.", {
    url: { type: "string", description: "Full https:// URL to read" },
  }, ["url"], "Reading the page…"),
  fn("site_search", "Search inside a specific site (reddit, x/twitter, github, youtube) and read the results.", {
    site: { type: "string", enum: ["reddit", "x", "twitter", "github", "youtube"], description: "Site to search" },
    query: { type: "string", description: "Search text" },
  }, ["site", "query"], "Searching the site…"),
  fn("youtube_read", "Read a YouTube video's title, description and other metadata without opening the browser. Use to check what a video is.", {
    query_or_url: { type: "string", description: "YouTube URL or search query" },
  }, ["query_or_url"], "Reading video info…"),
  fn("reddit_read", "Read hot posts from a subreddit or search Reddit — actually reads the content.", {
    query_or_url: { type: "string", description: "Subreddit name (e.g. 'node') or search text" },
  }, ["query_or_url"], "Reading Reddit…"),
  fn("rss_read", "Read the latest entries of an RSS/Atom feed.", {
    url: { type: "string", description: "Feed URL" },
  }, ["url"], "Reading the feed…"),
  fn("compose_email", "Open an email compose window (mailto or Gmail).", {
    url: { type: "string", description: "mailto: or Gmail compose URL with subject/body filled" },
  }, ["url"], "Opening compose…"),
  fn("compose_message", "Open a chat app compose surface (WhatsApp Web, Telegram).", {
    url: { type: "string", description: "Compose URL (https://web.whatsapp.com/send?phone=…)" },
  }, ["url"], "Opening chat…"),

  // ── Keyboard, mouse, screen (REAL device) ────────────────────────────────
  fn("type_text", "Type real keystrokes into whatever window is focused.", {
    text: { type: "string", description: "Exact text to type" },
  }, ["text"], "Typing…"),
  fn("press_key", "Press a real key combo in the focused window.", {
    keys: { type: "string", description: "Comma-separated, e.g. 'ctrl+c', 'enter', 'alt+tab'" },
  }, ["keys"], "Pressing keys…"),
  fn("click", "Click the real mouse. Without x/y clicks at the CURRENT cursor position.", {
    variant: { type: "string", enum: ["single", "double", "right"], description: "Click variant" },
    x: { type: "string", description: "Screen x (omit to click at cursor)" },
    y: { type: "string", description: "Screen y (omit to click at cursor)" },
  }, [], "Clicking…"),
  fn("screen_click_element", "LOOK at the real screen, find the UI element described, and click it. The model sees a fresh screenshot and returns coordinates — this is how you click things you can see but have no API for.", {
    element: { type: "string", description: "What to click, e.g. 'the blue Sign in button', 'the search box in the middle'" },
  }, ["element"], "Finding it on screen…"),
  fn("screen_type_into", "LOOK at the real screen, find the input field described, click it and type the text.", {
    element: { type: "string", description: "The input field to type into" },
    text: { type: "string", description: "Text to type" },
  }, ["element", "text"], "Typing into it…"),
  fn("screen_observe", "Take a real screenshot and describe what is on screen right now: open windows, visible text, buttons, state.", {}, [], "Looking at the screen…"),
  fn("mouse_move", "Move the real mouse cursor to coordinates.", {
    x: { type: "string", description: "Screen x" },
    y: { type: "string", description: "Screen y" },
  }, ["x", "y"], "Moving the cursor…"),
  fn("drag", "Press the real mouse down at one point, drag, release at another.", {
    fromX: { type: "string", description: "Start x" },
    fromY: { type: "string", description: "Start y" },
    toX: { type: "string", description: "End x" },
    toY: { type: "string", description: "End y" },
  }, ["fromX", "fromY", "toX", "toY"], "Dragging…"),
  fn("scroll", "Scroll the real mouse wheel under the cursor.", {
    direction: { type: "string", enum: ["up", "down"], description: "Scroll direction" },
    amount: { type: "string", description: "Approximate pixels (default 360)" },
  }, ["direction"], "Scrolling…"),
  fn("clipboard", "Read or write the real system clipboard.", {
    mode: { type: "string", enum: ["read", "write"], description: "read = get clipboard text, write = set it" },
    text: { type: "string", description: "write mode: text to put on the clipboard" },
  }, ["mode"], "Using the clipboard…"),

  // ── Files (real filesystem, Skales computer-use parity) ─────────────────
  fn("file_op", "Real file operations: search, read, write, append, copy, move, delete, mkdir, list. Paths resolve on the real filesystem.", {
    op: { type: "string", enum: ["search", "read", "write", "append", "copy", "move", "delete", "mkdir", "list"], description: "File operation" },
    path: { type: "string", description: "Target path (read/write/delete/mkdir/list)" },
    query: { type: "string", description: "search: file name to find" },
    content: { type: "string", description: "write/append: full file content" },
    from: { type: "string", description: "copy/move: source path" },
    to: { type: "string", description: "copy/move: destination path" },
    openFirst: { type: "string", enum: ["true", "false"], description: "search: also open the first hit" },
  }, ["op"], "Working with files…"),
  fn("open_folder", "Open a folder in the system file explorer.", {
    query: { type: "string", description: "Folder name or path" },
  }, ["query"], "Opening folder…"),
  fn("open_file", "Open a file with its default app.", {
    query: { type: "string", description: "File name or path" },
  }, ["query"], "Opening file…"),

  // ── System ────────────────────────────────────────────────────────────────
  fn("run_command", "Run a shell command on the laptop (e.g. 'npm --version', 'ipconfig'). ALWAYS needs user approval. Never destructive without asking.", {
    command: { type: "string", description: "The exact command to run" },
  }, ["command"], "Running command…"),
  fn("process_list", "List running processes.", {}, [], "Listing processes…"),
  fn("process_kill", "Force-close a process by name. Destructive — needs approval.", {
    target: { type: "string", description: "Process name or PID" },
  }, ["target"], "Stopping process…"),
  fn("volume", "Set/raise/lower/mute system volume.", {
    action: { type: "string", enum: ["set", "up", "down", "mute", "unmute"], description: "Volume action" },
    level: { type: "string", description: "set: 0-100" },
  }, ["action"], "Adjusting volume…"),
  fn("media_key", "Press a media key: play/pause, next, previous, stop.", {
    action: { type: "string", enum: ["playpause", "next", "previous", "stop"], description: "Media key" },
  }, ["action"], "Media control…"),
  fn("browser_tab", "Browser tab control in the focused browser: new/close/next/previous/reopen/back/forward/reload.", {
    op: { type: "string", enum: ["new", "close", "next", "previous", "reopen", "back", "forward", "reload"], description: "Tab operation" },
  }, ["op"], "Browser tab…"),
  fn("self_check", "Run the device self-check: verify screen, clipboard, apps, browser, screenshot pipeline. Use when something seems broken.", {}, [], "Running self-check…"),
];

/** Schemas for the model (OpenAI tools array). */
export function toolSchemas(): ToolSchema[] {
  return TOOL_CATALOG.map((t) => t.schema);
}

/** Progress label for a tool call (falls back to a generic line). */
export function progressFor(toolName: string): string {
  return TOOL_CATALOG.find((t) => t.schema.function.name === toolName)?.progress ?? "Working…";
}
