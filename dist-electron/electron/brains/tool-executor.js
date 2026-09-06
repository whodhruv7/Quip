"use strict";
// Quip V2 — TOOL EXECUTOR
// -----------------------------------------------------------------------------
// Runs a single resolved capability implementation. Each executor id maps to
// a concrete action: open a URL in the default browser, launch an app, open
// settings, etc. Executors never assume the platform — they delegate to the
// capability registry's launchCommand() which is per-OS.
//
// The executor does NOT decide what to run (that's the task brain's job) and
// does NOT decide whether it's allowed (that's the permission system). It
// just runs, returns a result, and reports a trust-layer note explaining
// WHAT it did and WHY.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeImplementation = executeImplementation;
const node_child_process_1 = require("node:child_process");
const electron_1 = require("electron");
const capability_registry_1 = require("./capability-registry");
const DEFAULT_TIMEOUT_MS = 8000;
const YOUTUBE_WIN_WIDTH = 1280;
const YOUTUBE_WIN_HEIGHT = 820;
const YOUTUBE_POLL_INTERVAL_MS = 250;
/** Promisified exec with timeout. */
function run(cmd, timeoutMs = DEFAULT_TIMEOUT_MS) {
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
// YouTube autoplay helper — when we open a YouTube search, attempt to click
// the first result so playback actually starts.
async function youtubeAutoplay(url, label) {
    // Open in a dedicated Quip task window so we can drive it.
    let taskWin = new electron_1.BrowserWindow({
        width: YOUTUBE_WIN_WIDTH,
        height: YOUTUBE_WIN_HEIGHT,
        show: true,
        autoHideMenuBar: true,
        title: `Quip — ${label}`,
        backgroundColor: "#000000",
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    const win = taskWin;
    try {
        await win.loadURL(url);
        // Try to click the first video.
        await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const t0 = Date.now();
        const timer = setInterval(() => {
          const el = document.querySelector('ytd-video-renderer a#video-title, a#video-title, ytd-video-renderer a#thumbnail, a#thumbnail');
          if (el) { clearInterval(timer); el.click(); resolve(true); }
          else if (Date.now() - t0 > ${DEFAULT_TIMEOUT_MS}) { clearInterval(timer); resolve(false); }
        }, ${YOUTUBE_POLL_INTERVAL_MS});
      })
    `).catch(() => { });
        return {
            success: true,
            output: `Opened ${label}`,
            note: `Playing on ${label}`,
        };
    }
    catch (e) {
        return {
            success: false,
            output: `Failed: ${e?.message ?? e}`,
            note: `Couldn't start playback on ${label}`,
        };
    }
    finally {
        taskWin = null;
    }
}
/** Execute a resolved implementation. */
async function executeImplementation(impl, { platform }) {
    const p = impl.params;
    switch (impl.executor) {
        // -----------------------------------------------------------------------
        case "open-url-in-browser": {
            const url = p.url;
            // YouTube autoplay path gets the dedicated window.
            if (p.youtube) {
                return youtubeAutoplay(url, impl.label);
            }
            // Try to launch in the user's chosen browser if we know its id.
            if (p.browserId) {
                const cmd = (0, capability_registry_1.launchCommand)(p.browserId, platform);
                if (cmd) {
                    const openCmd = platform === "win32"
                        ? `${cmd} "${url}"`
                        : platform === "darwin"
                            ? `${cmd} "${url}"`
                            : `${cmd} "${url}"`;
                    try {
                        await run(openCmd);
                        return {
                            success: true,
                            output: `Opened ${url}`,
                            note: `Opened in ${impl.label}`,
                        };
                    }
                    catch {
                        /* fall through to shell default */
                    }
                }
            }
            // Fallback: OS default handler.
            try {
                await shellOpen(url);
                return {
                    success: true,
                    output: `Opened ${url}`,
                    note: `Opened in ${impl.label}`,
                };
            }
            catch (e) {
                return {
                    success: false,
                    output: `Failed: ${e?.message ?? e}`,
                    note: `Couldn't open ${impl.label}`,
                };
            }
        }
        // -----------------------------------------------------------------------
        case "open-url-system": {
            try {
                await shellOpen(p.url);
                return {
                    success: true,
                    output: `Opened ${p.url}`,
                    note: "Opened with system handler",
                };
            }
            catch (e) {
                return {
                    success: false,
                    output: `Failed: ${e?.message ?? e}`,
                    note: "Couldn't open URL",
                };
            }
        }
        // -----------------------------------------------------------------------
        case "launch-app": {
            const cmd = (0, capability_registry_1.launchCommand)(p.appId, platform);
            if (!cmd) {
                return {
                    success: false,
                    output: `No launch command for ${p.appName}`,
                    note: `Couldn't launch ${p.appName}`,
                };
            }
            try {
                await run(cmd);
                return {
                    success: true,
                    output: `Launched ${p.appName}`,
                    note: `Opened ${impl.label}`,
                };
            }
            catch (e) {
                return {
                    success: false,
                    output: `Failed: ${e?.message ?? e}`,
                    note: `Couldn't launch ${p.appName}`,
                };
            }
        }
        // -----------------------------------------------------------------------
        case "open-settings": {
            const cmd = platform === "win32"
                ? "start ms-settings:"
                : platform === "darwin"
                    ? 'open -a "System Settings"'
                    : "gnome-control-center";
            try {
                await run(cmd);
                return {
                    success: true,
                    output: "Opened settings",
                    note: "Opened system settings",
                };
            }
            catch (e) {
                return {
                    success: false,
                    output: `Failed: ${e?.message ?? e}`,
                    note: "Couldn't open settings",
                };
            }
        }
        // -----------------------------------------------------------------------
        case "open-files": {
            const loc = p.location;
            const cmd = platform === "win32"
                ? loc === "downloads"
                    ? 'explorer "%USERPROFILE%\\Downloads"'
                    : loc === "desktop"
                        ? 'explorer "%USERPROFILE%\\Desktop"'
                        : "explorer ."
                : platform === "darwin"
                    ? loc === "downloads"
                        ? "open ~/Downloads"
                        : loc === "desktop"
                            ? "open ~/Desktop"
                            : "open ."
                    : "xdg-open .";
            try {
                await run(cmd);
                return {
                    success: true,
                    output: "Opened files",
                    note: loc ? `Opened ${loc}` : "Opened file explorer",
                };
            }
            catch (e) {
                return {
                    success: false,
                    output: `Failed: ${e?.message ?? e}`,
                    note: "Couldn't open files",
                };
            }
        }
        // -----------------------------------------------------------------------
        case "read-clipboard": {
            // Clipboard read happens in the renderer; main reports availability.
            return {
                success: true,
                output: "clipboard available",
                note: "Read clipboard",
            };
        }
        // -----------------------------------------------------------------------
        default:
            return {
                success: false,
                output: `Unknown executor: ${impl.executor}`,
                note: "Unsupported action",
            };
    }
}
//# sourceMappingURL=tool-executor.js.map