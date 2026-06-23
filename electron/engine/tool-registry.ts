// Quip Execution Engine V2 — Tool Registry
// ─────────────────────────────────────────────────────────────────────────────
// Modular tools. Each tool is a self-contained executor.
// The orchestrator calls tools based on the task graph.
//
// Tools:
//   AppTool — open apps (VS Code, Cursor, Terminal, etc.)
//   BrowserTool — open URLs, search web
//   FileTool — open folders, files
//   MediaTool — play music (YouTube, Spotify)
//   SystemTool — system settings
//
// Each tool returns a ToolResult with success/failure + trust note.
// ─────────────────────────────────────────────────────────────────────────────

import { exec } from "node:child_process";
import { shell } from "electron";

export interface ToolResult {
  success: boolean;
  output: string;
  note: string; // trust layer — what happened and why
}

export interface ToolContext {
  platform: string;
}

// ─── Helper: run command ─────────────────────────────────────────────────────
function run(cmd: string, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(cmd, { windowsHide: true }, (err) => {
      if (err) reject(err);
      else resolve();
    });
    setTimeout(() => reject(new Error("timeout")), timeoutMs);
  });
}

function shellOpen(url: string): Promise<void> {
  return shell.openExternal(url);
}

// ─── App Launch Commands ─────────────────────────────────────────────────────
const APP_COMMANDS: Record<string, { win: string; mac: string; linux: string; label: string }> = {
  vscode: { win: "start code", mac: 'open -a "Visual Studio Code"', linux: "code", label: "VS Code" },
  cursor: { win: "start cursor", mac: 'open -a "Cursor"', linux: "cursor", label: "Cursor" },
  terminal: { win: "start wt", mac: 'open -a "Terminal"', linux: "gnome-terminal", label: "Terminal" },
  cmd: { win: "start cmd", mac: 'open -a "Terminal"', linux: "xterm", label: "Command Prompt" },
  powershell: { win: "start powershell", mac: 'open -a "Terminal"', linux: "gnome-terminal", label: "PowerShell" },
  calc: { win: "start calc", mac: 'open -a "Calculator"', linux: "gnome-calculator", label: "Calculator" },
  notepad: { win: "start notepad", mac: 'open -a "TextEdit"', linux: "gedit", label: "Notepad" },
  spotify: { win: "start spotify", mac: 'open -a "Spotify"', linux: "spotify", label: "Spotify" },
  explorer: { win: "start explorer", mac: "open .", linux: "xdg-open .", label: "File Explorer" },
  edge: { win: "start msedge", mac: 'open -a "Microsoft Edge"', linux: "microsoft-edge", label: "Microsoft Edge" },
  chrome: { win: "start chrome", mac: 'open -a "Google Chrome"', linux: "google-chrome", label: "Google Chrome" },
  firefox: { win: "start firefox", mac: 'open -a "Firefox"', linux: "firefox", label: "Firefox" },
  brave: { win: "start brave", mac: 'open -a "Brave Browser"', linux: "brave-browser", label: "Brave" },
  settings: { win: "start ms-settings:", mac: 'open -a "System Settings"', linux: "gnome-control-center", label: "Settings" },
};

// ─── App Tool ────────────────────────────────────────────────────────────────
export const AppTool = {
  async execute(params: Record<string, string>, ctx: ToolContext): Promise<ToolResult> {
    const appId = params.appId;
    const cmd = APP_COMMANDS[appId];
    if (!cmd) {
      return { success: false, output: `Unknown app: ${appId}`, note: `Couldn't find ${params.appName ?? appId}` };
    }
    const platformCmd = ctx.platform === "win32" ? cmd.win : ctx.platform === "darwin" ? cmd.mac : cmd.linux;
    if (!platformCmd) {
      return { success: false, output: `Not supported on ${ctx.platform}`, note: `Couldn't launch ${cmd.label}` };
    }
    try {
      await run(platformCmd);
      return { success: true, output: `Launched ${cmd.label}`, note: `Opened ${cmd.label}` };
    } catch (e: any) {
      return { success: false, output: `Failed: ${e?.message ?? e}`, note: `Couldn't launch ${cmd.label}` };
    }
  },
};

// ─── Browser Tool ────────────────────────────────────────────────────────────
export const BrowserTool = {
  async execute(params: Record<string, string>, ctx: ToolContext): Promise<ToolResult> {
    const url = params.url;
    if (!url) return { success: false, output: "No URL", note: "No URL provided" };
    try {
      await shellOpen(url);
      return { success: true, output: `Opened ${url}`, note: `Opened in your browser` };
    } catch (e: any) {
      return { success: false, output: `Failed: ${e?.message ?? e}`, note: `Couldn't open URL` };
    }
  },
};

// ─── File Tool ───────────────────────────────────────────────────────────────
export const FileTool = {
  async execute(params: Record<string, string>, ctx: ToolContext): Promise<ToolResult> {
    const loc = params.location;
    const platform = ctx.platform;
    const cmd = platform === "win32"
      ? loc === "downloads" ? 'explorer "%USERPROFILE%\\Downloads"'
        : loc === "desktop" ? 'explorer "%USERPROFILE%\\Desktop"'
        : loc === "documents" ? 'explorer "%USERPROFILE%\\Documents"'
        : "explorer ."
      : platform === "darwin"
        ? loc === "downloads" ? "open ~/Downloads"
          : loc === "desktop" ? "open ~/Desktop"
          : loc === "documents" ? "open ~/Documents"
          : "open ."
        : "xdg-open .";
    try {
      await run(cmd);
      return { success: true, output: "Opened", note: `Opened ${loc ?? "files"}` };
    } catch (e: any) {
      return { success: false, output: `Failed: ${e?.message ?? e}`, note: `Couldn't open ${loc ?? "files"}` };
    }
  },
};

// ─── Media Tool ──────────────────────────────────────────────────────────────
export const MediaTool = {
  async execute(params: Record<string, string>, ctx: ToolContext): Promise<ToolResult> {
    const url = params.url;
    if (!url) return { success: false, output: "No URL", note: "No media URL" };
    try {
      await shellOpen(url);
      const label = params.youtube === "true" ? "YouTube" : "Spotify";
      return {
        success: true,
        output: `Opened ${url}`,
        note: `Playing on ${label} — search results opened in your browser`,
      };
    } catch (e: any) {
      return { success: false, output: `Failed: ${e?.message ?? e}`, note: `Couldn't play media` };
    }
  },
};

// ─── System Tool ─────────────────────────────────────────────────────────────
export const SystemTool = {
  async execute(params: Record<string, string>, ctx: ToolContext): Promise<ToolResult> {
    const platform = ctx.platform;
    const cmd = platform === "win32"
      ? "start ms-settings:"
      : platform === "darwin"
        ? 'open -a "System Settings"'
        : "gnome-control-center";
    try {
      await run(cmd);
      return { success: true, output: "Opened settings", note: "Opened system settings" };
    } catch (e: any) {
      return { success: false, output: `Failed: ${e?.message ?? e}`, note: `Couldn't open settings` };
    }
  },
};

// ─── Tool Router ─────────────────────────────────────────────────────────────
export function executeTool(
  action: string,
  params: Record<string, string>,
  ctx: ToolContext
): Promise<ToolResult> {
  switch (action) {
    case "open_app":
      return AppTool.execute(params, ctx);
    case "open_website":
    case "open_url":
    case "search_web":
      return BrowserTool.execute(params, ctx);
    case "open_folder":
    case "open_file":
      return FileTool.execute(params, ctx);
    case "play_media":
      return MediaTool.execute(params, ctx);
    case "system_action":
      return SystemTool.execute(params, ctx);
    case "compose_email":
      return BrowserTool.execute(params, ctx);
    case "compose_message":
      return BrowserTool.execute(params, ctx);
    default:
      return Promise.resolve({
        success: false,
        output: `Unknown action: ${action}`,
        note: "Unsupported action",
      });
  }
}
