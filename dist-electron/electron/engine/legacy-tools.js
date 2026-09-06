"use strict";
// Quip Execution Engine V2 — Legacy Tools (fallback path)
// ─────────────────────────────────────────────────────────────────────────────
// The original direct executors, kept as a safety net for action names that
// the modern registry doesn't handle. Superseded by:
//   app-discovery.ts / file-discovery.ts / desktop-controller.ts /
//   browser-automation.ts — prefer those for all new paths.
// ─────────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.SystemTool = exports.MediaTool = exports.FileTool = exports.BrowserTool = exports.AppTool = void 0;
exports.executeTool = executeTool;
const node_child_process_1 = require("node:child_process");
const electron_1 = require("electron");
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
exports.BrowserTool = {
    async execute(params, _ctx) {
        const url = params.url;
        if (!url)
            return { success: false, output: "No URL", note: "No URL provided" };
        try {
            await electron_1.shell.openExternal(url);
            return { success: true, output: `Opened ${url}`, note: `Opened in your browser` };
        }
        catch (e) {
            return { success: false, output: `Failed: ${e?.message ?? e}`, note: `Couldn't open URL` };
        }
    },
};
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
exports.MediaTool = {
    async execute(params, _ctx) {
        let url = params.url;
        if (!url)
            return { success: false, output: "No URL", note: "No media URL" };
        let isPlayingAutoplay = false;
        try {
            if (params.youtube === "true" && params.query) {
                try {
                    const res = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(params.query)}`);
                    const html = await res.text();
                    const match = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
                    if (match && match[1]) {
                        url = `https://www.youtube.com/watch?v=${match[1]}`;
                        isPlayingAutoplay = true;
                    }
                }
                catch {
                    // silently fallback to search page
                }
            }
            await electron_1.shell.openExternal(url);
            const label = params.youtube === "true" ? "YouTube" : "Spotify";
            return {
                success: true,
                output: `Opened ${url}`,
                note: isPlayingAutoplay
                    ? `Playing ${params.query} on ${label}`
                    : `Playing on ${label} — search results opened in your browser`,
            };
        }
        catch (e) {
            return { success: false, output: `Failed: ${e?.message ?? e}`, note: `Couldn't play media` };
        }
    },
};
exports.SystemTool = {
    async execute(_params, ctx) {
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
/** Legacy router — used only for action names the modern registry lacks. */
async function executeTool(action, params, ctx) {
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
        case "compose_message":
            return exports.BrowserTool.execute(params, ctx);
        default:
            return {
                success: false,
                output: `Unknown action: ${action}`,
                note: "Unsupported action",
            };
    }
}
//# sourceMappingURL=legacy-tools.js.map