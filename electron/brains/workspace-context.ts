// Quip V2 — WORKSPACE CONTEXT LAYER
// -----------------------------------------------------------------------------
// Tracks what the user is doing RIGHT NOW: foreground app, current file,
// current project, current browser tab. This is short-lived (in-memory only,
// never persisted) and feeds the system prompt so Quip can understand
// references like "this file" or "my current project" without asking.
//
// Privacy: window titles are parsed but only a COMPRESSED summary leaves
// this layer for the system prompt. Raw titles never hit disk or the LLM.
// -----------------------------------------------------------------------------

import { exec } from "node:child_process";

export interface WorkspaceContext {
  timestamp: number;
  foregroundApp: string | null;
  currentFile: { name: string; project?: string; language?: string } | null;
  currentBrowserTab: { title: string; domain?: string } | null;
  inMeeting: boolean;
  meetingApp: string | null;
}

const MEETING_APPS = [
  "zoom",
  "teams",
  "meet",
  "webex",
  "slack call",
  "discord",
  "skype",
];

const EDITOR_PATTERNS: {
  app: string;
  // regex extracts the filename from the window title
  titleRegex: RegExp;
  languageMap?: Record<string, string>;
}[] = [
  {
    app: "code", // VS Code
    titleRegex: /^(.+?) - (.+?) - (.+)$/,
  },
  {
    app: "cursor",
    titleRegex: /^(.+?) - (.+?) - (.+)$/,
  },
  {
    app: "sublime",
    titleRegex: /^(.+?) \(.*?\) - Sublime Text$/,
  },
];

const BROWSER_PATTERNS = [
  { app: "edge", titleRegex: /^(.+?) - (?:Personal - )?Microsoft Edge$/i },
  { app: "chrome", titleRegex: /^(.+?) - Google Chrome$/i },
  { app: "firefox", titleRegex: /^(.+?) - Mozilla Firefox$/i },
  { app: "brave", titleRegex: /^(.+?) - Brave$/i },
  { app: "safari", titleRegex: /^(.+?) - Safari$/i },
];

const FILE_EXTENSION_LANGUAGES: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".rb": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".swift": "swift",
  ".cpp": "cpp",
  ".c": "c",
  ".cs": "csharp",
  ".php": "php",
  ".html": "html",
  ".css": "css",
  ".json": "json",
  ".md": "markdown",
  ".sql": "sql",
  ".sh": "shell",
};

/** Promisify exec with timeout. Never throws. */
function run(cmd: string, timeoutMs = 1500): Promise<string> {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      resolve("");
    }, timeoutMs);
    try {
      exec(cmd, { windowsHide: true }, (err, stdout) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(err ? "" : (stdout ?? "").toString());
      });
    } catch {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve("");
    }
  });
}

/** Detect foreground app + window title, platform-specific. */
async function getForegroundWindow(): Promise<{
  appName: string | null;
  windowTitle: string | null;
}> {
  const platform = process.platform;

  if (platform === "win32") {
    // PowerShell: get foreground window title + process name
    const out = await run(
      `powershell -NoProfile -Command "$w = Add-Type '[DllImport(\\"user32.dll\\")] public static extern IntPtr GetForegroundWindow();' -Name Win32 -PassThru; $h = $w::GetForegroundWindow(); $p = Get-Process | Where-Object { $_.MainWindowHandle -eq $h }; if ($p) { $p.ProcessName + '|||' + $p.MainWindowTitle }"`,
      1500
    );
    if (out.includes("|||")) {
      const [appName, windowTitle] = out.trim().split("|||");
      return { appName: appName || null, windowTitle: windowTitle || null };
    }
    return { appName: null, windowTitle: null };
  }

  if (platform === "darwin") {
    // AppleScript: get frontmost app name + window title
    const out = await run(
      `osascript -e 'tell application "System Events" to set {n, t} to {name of first process whose frontmost is true, title of front window of (first process whose frontmost is true)}' -e 'return n & "|||" & t'`,
      1500
    );
    if (out.includes("|||")) {
      const [appName, windowTitle] = out.trim().split("|||");
      return { appName: appName || null, windowTitle: windowTitle || null };
    }
    return { appName: null, windowTitle: null };
  }

  // Linux: xdotool
  const title = await run("xdotool getactivewindow getwindowname", 1000);
  const pid = await run("xdotool getactivewindow getwindowpid", 1000);
  if (title.trim()) {
    const cleanPid = pid.trim();
    if (!/^\d+$/.test(cleanPid)) return { appName: null, windowTitle: title.trim() };
    const appName = (await run(`ps -p ${cleanPid} -o comm=`, 500)).trim();
    return { appName: appName || null, windowTitle: title.trim() };
  }
  return { appName: null, windowTitle: null };
}

/** Parse window title for file info based on app name. */
function parseEditorFile(
  appName: string,
  windowTitle: string
): WorkspaceContext["currentFile"] {
  const app = appName.toLowerCase();
  const pattern = EDITOR_PATTERNS.find((p) => app.includes(p.app));
  if (!pattern) return null;

  // Most editors: "filename - project - AppName" or "filename - AppName"
  const parts = windowTitle.split(" - ");
  if (parts.length < 2) return null;

  const filename = parts[0].trim();
  const project = parts.length >= 3 ? parts[1].trim() : undefined;

  // Determine language blindly from extension if present
  let language = "text";
  const extMatch = filename.match(/\.([^.]+)$/);
  if (extMatch && extMatch[1]) {
    language = FILE_EXTENSION_LANGUAGES[`.${extMatch[1].toLowerCase()}`] || extMatch[1].toLowerCase();
  } else if (filename.startsWith(".")) {
    language = "config";
  }

  return { name: filename, project, language };
}

/** Parse browser tab title. */
function parseBrowserTab(
  appName: string,
  windowTitle: string
): WorkspaceContext["currentBrowserTab"] {
  const app = appName.toLowerCase();
  const pattern = BROWSER_PATTERNS.find((p) => app.includes(p.app));
  if (!pattern) return null;
  const match = windowTitle.match(pattern.titleRegex);
  if (!match) return { title: windowTitle };
  return { title: match[1].trim() };
}

/** Check if a meeting app is in the foreground. */
function detectMeeting(appName: string | null): {
  inMeeting: boolean;
  meetingApp: string | null;
} {
  if (!appName) return { inMeeting: false, meetingApp: null };
  const lower = appName.toLowerCase();
  const found = MEETING_APPS.find((m) => lower.includes(m));
  return { inMeeting: !!found, meetingApp: found ?? null };
}

class WorkspaceContextBrain {
  private current: WorkspaceContext = {
    timestamp: 0,
    foregroundApp: null,
    currentFile: null,
    currentBrowserTab: null,
    inMeeting: false,
    meetingApp: null,
  };

  /** Refresh the snapshot. Called every 5s by Environment Brain or on demand. */
  async refresh(): Promise<WorkspaceContext> {
    try {
      const { appName, windowTitle } = await getForegroundWindow();
      const meeting = detectMeeting(appName);

      this.current = {
        timestamp: Date.now(),
        foregroundApp: appName,
        currentFile: appName && windowTitle ? parseEditorFile(appName, windowTitle) : null,
        currentBrowserTab: appName && windowTitle ? parseBrowserTab(appName, windowTitle) : null,
        inMeeting: meeting.inMeeting,
        meetingApp: meeting.meetingApp,
      };
    } catch (err) {
      console.error("Workspace context refresh failed:", err);
    }
    return this.current;
  }

  get(): WorkspaceContext {
    return { ...this.current };
  }

  /** Compact summary for the system prompt (privacy-safe). */
  getPromptSummary(): string {
    const c = this.current;
    if (!c.foregroundApp) return "";

    const parts: string[] = [`User is currently in: ${c.foregroundApp}`];
    if (c.currentFile) {
      const fileStr = c.currentFile.project
        ? `${c.currentFile.name} (project: ${c.currentFile.project})`
        : c.currentFile.name;
      parts.push(`Editing: ${fileStr}`);
    }
    if (c.currentBrowserTab) {
      parts.push(`Browsing web`);
    }
    if (c.inMeeting) {
      parts.push(`In a ${c.meetingApp} meeting`);
    }
    return `Workspace context:\n  - ${parts.join("\n  - ")}`;
  }
}

export const workspaceContext = new WorkspaceContextBrain();
