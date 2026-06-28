"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SystemTool = exports.MediaTool = exports.FileTool = exports.BrowserTool = exports.AppTool = void 0;
exports.executeTool = executeTool;
const node_child_process_1 = require("node:child_process");
const electron_1 = require("electron");
// ─── Helper: run command ─────────────────────────────────────────────────────
function run(cmd, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        (0, node_child_process_1.exec)(cmd, { windowsHide: true }, (err) => {
            if (err)
                reject(err);
            else
                resolve();
        });
        setTimeout(() => reject(new Error("timeout")), timeoutMs);
    });
}
function shellOpen(url) {
    return electron_1.shell.openExternal(url);
}
// ─── App Launch Commands ─────────────────────────────────────────────────────
const APP_COMMANDS = {
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
exports.AppTool = {
    async execute(params, ctx) {
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
        }
        catch (e) {
            return { success: false, output: `Failed: ${e?.message ?? e}`, note: `Couldn't launch ${cmd.label}` };
        }
    },
};
// ─── Browser Tool ────────────────────────────────────────────────────────────
exports.BrowserTool = {
    async execute(params, ctx) {
        const url = params.url;
        if (!url)
            return { success: false, output: "No URL", note: "No URL provided" };
        try {
            await shellOpen(url);
            return { success: true, output: `Opened ${url}`, note: `Opened in your browser` };
        }
        catch (e) {
            return { success: false, output: `Failed: ${e?.message ?? e}`, note: `Couldn't open URL` };
        }
    },
};
// ─── File Tool ───────────────────────────────────────────────────────────────
exports.FileTool = {
    async execute(params, ctx) {
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
        }
        catch (e) {
            return { success: false, output: `Failed: ${e?.message ?? e}`, note: `Couldn't open ${loc ?? "files"}` };
        }
    },
};
// ─── Media Tool ──────────────────────────────────────────────────────────────
exports.MediaTool = {
    async execute(params, ctx) {
        const url = params.url;
        if (!url)
            return { success: false, output: "No URL", note: "No media URL" };
        try {
            await shellOpen(url);
            const label = params.youtube === "true" ? "YouTube" : "Spotify";
            return {
                success: true,
                output: `Opened ${url}`,
                note: `Playing on ${label} — search results opened in your browser`,
            };
        }
        catch (e) {
            return { success: false, output: `Failed: ${e?.message ?? e}`, note: `Couldn't play media` };
        }
    },
};
// ─── System Tool ─────────────────────────────────────────────────────────────
exports.SystemTool = {
    async execute(params, ctx) {
        const platform = ctx.platform;
        const cmd = platform === "win32"
            ? "start ms-settings:"
            : platform === "darwin"
                ? 'open -a "System Settings"'
                : "gnome-control-center";
        try {
            await run(cmd);
            return { success: true, output: "Opened settings", note: "Opened system settings" };
        }
        catch (e) {
            return { success: false, output: `Failed: ${e?.message ?? e}`, note: `Couldn't open settings` };
        }
    },
};
// ─── Tool Router ─────────────────────────────────────────────────────────────
function executeTool(action, params, ctx) {
    switch (action) {
        case "open_app":
            return exports.AppTool.execute(params, ctx);
        case "open_website":
        case "open_url":
        case "search_web":
            return exports.BrowserTool.execute(params, ctx);
        case "open_folder":
        case "open_file":
            return exports.FileTool.execute(params, ctx);
        case "play_media":
            return exports.MediaTool.execute(params, ctx);
        case "system_action":
            return exports.SystemTool.execute(params, ctx);
        case "compose_email":
            return exports.BrowserTool.execute(params, ctx);
        case "compose_message":
            return exports.BrowserTool.execute(params, ctx);
        default:
            return Promise.resolve({
                success: false,
                output: `Unknown action: ${action}`,
                note: "Unsupported action",
            });
    }
}
//# sourceMappingURL=tool-registry.js.map