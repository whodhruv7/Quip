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
  fn("window_snap", "Snap a window to the left or right half of the screen, maximize or restore ('right side pe rakho').", {
    preset: { type: "string", enum: ["left", "right", "maximize", "restore"], description: "Snap preset" },
    window: { type: "string", description: "Window/app title (optional)" },
  }, ["preset"], "Snapping the window…"),
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

  // ── Weather & knowledge (Skales skills parity) ─────────────────────────────
  fn("weather", "Real weather for a city: current conditions + 4-day forecast (no key needed).", {
    place: { type: "string", description: "City name, e.g. 'Delhi', 'Tokyo'" },
  }, ["place"], "Checking the weather…"),
  fn("summarize", "Summarize a piece of text or the last page you read into a few clear sentences.", {
    text: { type: "string", description: "The text to summarize (omit to summarize the last thing you read)" },
  }, [], "Summarizing…"),

  // ── Documents (real files, Skales Documents/pdf-extract parity) ───────────
  fn("pdf_read", "Extract the text from a PDF file on the laptop.", {
    path: { type: "string", description: "Path to the PDF" },
  }, ["path"], "Reading the PDF…"),
  fn("docx_read", "Read the text of a .docx Word file on the laptop.", {
    path: { type: "string", description: "Path to the .docx file" },
  }, ["path"], "Reading the document…"),
  fn("doc_create", "Create a REAL Word/Excel/PowerPoint file on the laptop from content you provide.", {
    kind: { type: "string", enum: ["docx", "xlsx", "pptx"], description: "Document type" },
    path: { type: "string", description: "Absolute path ending in .docx/.xlsx/.pptx" },
    text: { type: "string", description: "docx: full document text (newlines = paragraphs)" },
    rows: { type: "string", description: "xlsx: rows as a JSON array of arrays of strings, e.g. [[\"name\",\"age\"],[\"Asha\",\"7\"]]" },
    slides: { type: "string", description: "pptx: slides as JSON [{\"title\":\"…\",\"body\":\"line\\nline\"}]" },
  }, ["kind", "path"], "Creating the document…"),

  // ── System & network (Skales System Monitor / Network parity) ─────────────
  fn("sys_info", "Live laptop status: CPU load, memory, disks, battery, last boot.", {}, [], "Reading system status…"),
  fn("network_info", "Network status: local IPs, Wi-Fi connection, devices on the network.", {}, [], "Checking the network…"),

  // ── Speech (the companion's real voice) ─────────────────────────────────────
  fn("speak", "Say something OUT LOUD through the speakers (neural voice, falls back to the laptop's built-in voice).", {
    text: { type: "string", description: "Exactly what to say" },
  }, ["text"], "Speaking…"),

  // ── More Agent-Reach channels (GitHub / V2EX / Bilibili / X) ───────────────
  fn("github_read", "Read a GitHub repo (stars, description, README) or search repos — real public API.", {
    query_or_url: { type: "string", description: "Repo link, 'owner/repo', or search text" },
  }, ["query_or_url"], "Reading GitHub…"),
  fn("v2ex_read", "Read hot V2EX topics or a node's latest topics.", {
    node: { type: "string", description: "Node name (omit for hot topics)" },
  }, [], "Reading V2EX…"),
  fn("bilibili_read", "Search Bilibili videos and read the results.", {
    query: { type: "string", description: "Search text" },
  }, ["query"], "Searching Bilibili…"),
  fn("tweet_read", "Read a single tweet by its link (x.com/…/status/…). Searching X needs a paid API — say so if asked.", {
    query_or_url: { type: "string", description: "The tweet URL" },
  }, ["query_or_url"], "Reading the tweet…"),

  // ── Autonomy wave: ghost browser ──────────────────────────────────────────
  fn("web_ghost_read", "Read a JavaScript-rendered page through Quip's hidden ghost browser — use when read_page returns thin content.", {
    url: { type: "string", description: "Full https:// URL to read" },
  }, ["url"], "Ghost-reading the page…"),
  fn("web_ghost_extract", "Open a website in the ghost browser and extract every email/phone into the Contacts Book. This is how you find a contact for the user.", {
    url: { type: "string", description: "Website to pull contacts from" },
  }, ["url"], "Pulling contacts from the site…"),
  fn("web_ghost_click", "Click a link/button by its visible text inside the ghost browser (e.g. open a contact page).", {
    url: { type: "string", description: "Page URL" },
    element: { type: "string", description: "Visible text of the thing to click" },
  }, ["url", "element"], "Ghost-clicking…"),
  fn("web_ghost_fill", "Fill form fields in the ghost browser. Fields = JSON [{hint:'email', value:'a@b.c'}, …].", {
    url: { type: "string", description: "Page URL" },
    fields: { type: "string", description: "JSON array of {hint, value, selector?}" },
  }, ["url", "fields"], "Ghost-filling the form…"),
  fn("web_ghost_wait", "Wait until specific text appears on the ghost page (bounded) — use between ghost steps so flows don't race.", {
    text: { type: "string", description: "Text to wait for" },
    timeout: { type: "string", description: "Max seconds to wait (2-30, default 10)" },
  }, ["text"], "Waiting for the page…"),
  fn("web_ghost_screenshot", "Screenshot the ghost page as PNG (saved to Pictures/Quip) — see a page the user never opened.", {
    url: { type: "string", description: "Page URL to capture" },
  }, ["url"], "Capturing the page…"),

  // ── Autonomy wave: MailWing (real email) ──────────────────────────────────
  fn("mailwing_draft", "Write an email draft and humanize it. Stages the draft — say the user should approve with 'send it'.", {
    to: { type: "string", description: "Recipient email address" },
    body: { type: "string", description: "Rough points or full text for the email" },
    subject: { type: "string", description: "Optional subject (auto-drafted when omitted)" },
    tone: { type: "string", enum: ["professional", "friendly", "casual", "formal"], description: "Writing tone" },
    humanize: { type: "string", enum: ["true", "false"], description: "false = send the text exactly as given" },
  }, ["to", "body"], "Writing the email…"),
  fn("mailwing_send", "Send the staged draft via the user's MailWing SMTP account, or open a prefilled Gmail draft when none exists. Always needs approval.", {
    account: { type: "string", description: "Optional account label (default account when omitted)" },
  }, [], "Sending the email…"),
  fn("mailwing_accounts", "Manage MailWing accounts: list (default), test (verify SMTP login, sends nothing).", {
    op: { type: "string", enum: ["list", "test"], description: "Operation" },
    account: { type: "string", description: "Account label for test" },
  }, [], "Checking MailWing accounts…"),
  fn("mailwing_outbox", "Show the last emails sent through MailWing with status.", {}, [], "Reading the outbox…"),

  // ── Autonomy wave: contacts ────────────────────────────────────────────────
  fn("contacts_search", "Search the local contacts book by name, email or company.", {
    query: { type: "string", description: "Who to find" },
  }, ["query"], "Searching contacts…"),
  fn("contacts_save", "Save or update a contact (email or phone required; merges duplicates).", {
    email: { type: "string", description: "Email address" },
    phone: { type: "string", description: "Phone number" },
    name: { type: "string", description: "Person's name" },
    company: { type: "string", description: "Company/role" },
  }, [], "Saving the contact…"),
  fn("contacts_export", "Export the whole contacts book to a CSV file on the Desktop.", {
    path: { type: "string", description: "Optional CSV path (default: Desktop/quip-contacts-DATE.csv)" },
  }, [], "Exporting contacts…"),

  // ── Autonomy wave: FileButler ───────────────────────────────────────────
  fn("file_organize", "Organize a folder by type or date: first shows the full plan, moves only after 'confirm organize', undoable.", {
    dir: { type: "string", description: "Folder to organize (e.g. the Downloads path)" },
    mode: { type: "string", enum: ["type", "date"], description: "Grouping mode" },
    op: { type: "string", enum: ["plan", "apply", "undo"], description: "plan (default) / apply / undo last run" },
  }, ["dir"], "Planning the organize…"),
  fn("file_duplicates", "Find duplicate files (size + SHA-256). clean=true trashes the extra copies.", {
    dir: { type: "string", description: "Folder to scan" },
    clean: { type: "string", enum: ["true", "false"], description: "true = trash extra copies" },
  }, ["dir"], "Scanning for duplicates…"),
  fn("file_storage_report", "Report a folder's size: totals by type + biggest files.", {
    dir: { type: "string", description: "Folder to report on" },
  }, ["dir"], "Measuring storage…"),
  fn("file_watch", "Watch a folder so new files auto-organize (every move is toasted + journaled).", {
    op: { type: "string", enum: ["start", "stop", "status"], description: "Operation" },
    dir: { type: "string", description: "Folder to watch" },
  }, ["op"], "Setting the watch…"),

  // ── Autonomy wave: GhostHands (deep system) ────────────────────────────
  fn("screenshot_save", "Take a real screenshot, save it as a PNG in Pictures and reveal the folder.", {}, [], "Capturing the screen…"),
  fn("wallpaper_set", "Set the desktop wallpaper from a local image path or an https image URL.", {
    source: { type: "string", description: "Image path or URL" },
  }, ["source"], "Changing the wallpaper…"),
  fn("brightness", "Get or set the laptop screen brightness (1-100).", {
    action: { type: "string", enum: ["get", "set"], description: "Operation" },
    level: { type: "string", description: "set: 1-100" },
  }, ["action"], "Adjusting brightness…"),
  fn("notify_me", "Show a real Windows notification (reminders, task done, anything).", {
    title: { type: "string", description: "Short title" },
    body: { type: "string", description: "Notification text" },
  }, ["body"], "Notifying…"),
  fn("lock_pc", "Lock the PC (Win+L). Always needs approval.", {}, [], "Locking…"),
  fn("battery", "Read the battery percentage and charging state.", {}, [], "Checking battery…"),
  fn("clipboard_history", "Show what Quip has copied/pasted this session (ring of 25).", {}, [], "Reading clipboard history…"),
  fn("install_app", "Install a desktop app via winget (e.g. 'notepad++', 'vlc'). Approval-gated, real installer.", {
    query: { type: "string", description: "App to install" },
  }, ["query"], "Installing…"),

  // ── Autonomy wave: quests & routines ──────────────────────────────────
  fn("quest_run", "Run a named multi-step quest: email-from-website (find a contact on a site, write a humanized email, send after approval), organize-downloads, morning-brief.", {
    kind: { type: "string", enum: ["email-from-website", "organize-downloads", "morning-brief"], description: "Quest to run" },
    url: { type: "string", description: "email-from-website: the website" },
    hint: { type: "string", description: "email-from-website: who to prefer (e.g. 'founder')" },
    body: { type: "string", description: "email-from-website: rough points for the email" },
    tone: { type: "string", enum: ["professional", "friendly", "casual", "formal"], description: "Email tone" },
  }, ["kind"], "Running the quest…"),
  fn("routine_save", "Save a routine: a JSON chain of quests/tools/say steps the user can run later.", {
    name: { type: "string", description: "Routine name" },
    steps: { type: "string", description: "JSON steps: [{kind:'quest',questId:…},{kind:'tool',action:…,params:…},{kind:'say',text:…}]" },
  }, ["name", "steps"], "Saving the routine…"),
  fn("routine_run", "Run a saved routine end-to-end.", {
    name: { type: "string", description: "Routine name" },
  }, ["name"], "Running the routine…"),
  fn("routine_list", "List saved routines.", {}, [], "Listing routines…"),
  fn("problem_diary", "The Problem Diary: everything Quip failed at, remembered. list (default), resolve <id>, export (Markdown report to Desktop), clear.", {
    verb: { type: "string", enum: ["list", "resolve", "export", "clear"], description: "What to do" },
    id: { type: "string", description: "resolve: the problem number from the list" },
    source: { type: "string", description: "list: filter by source (tool/quest/chat/mail/ghost/file)" },
  }, [], "Checking the problem diary…"),
];

/** Schemas for the model (OpenAI tools array). */
export function toolSchemas(): ToolSchema[] {
  return TOOL_CATALOG.map((t) => t.schema);
}

/** Progress label for a tool call (falls back to a generic line). */
export function progressFor(toolName: string): string {
  return TOOL_CATALOG.find((t) => t.schema.function.name === toolName)?.progress ?? "Working…";
}
