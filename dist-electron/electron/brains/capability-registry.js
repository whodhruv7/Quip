"use strict";
// Quip V2 — CAPABILITY REGISTRY
// -----------------------------------------------------------------------------
// The anti-hardcoding layer. The task brain NEVER says "open chrome". It says
// "openBrowser". The registry looks at the device profile + current environment
// and resolves that abstract capability to a concrete implementation:
//
//   openBrowser  -> { executor: "shell-open-url", params: { url }, label: "Microsoft Edge" }
//
// If the user's default browser is Edge, we open Edge. If it's missing, we
// pick the next detected browser. If NO browser is detected, we report the
// capability as unavailable so the task brain can fail gracefully instead of
// blindly running a broken command.
//
// This is what makes Quip portable across Windows / macOS / Linux / future
// devices. Add a device, scan it, and the registry adapts automatically.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.launchCommand = launchCommand;
exports.resolveCapability = resolveCapability;
exports.isAvailable = isAvailable;
// ---------------------------------------------------------------------------
// App id -> OS launch command
// ---------------------------------------------------------------------------
/** Build a per-platform launch command for a known app id. */
function launchCommand(appId, platform) {
    const win = platform === "win32";
    const mac = platform === "darwin";
    const map = {
        edge: { win: "start msedge", mac: 'open -a "Microsoft Edge"', linux: "microsoft-edge" },
        chrome: { win: "start chrome", mac: 'open -a "Google Chrome"', linux: "google-chrome" },
        brave: { win: "start brave", mac: 'open -a "Brave Browser"', linux: "brave-browser" },
        firefox: { win: "start firefox", mac: 'open -a "Firefox"', linux: "firefox" },
        opera: { win: "start opera", mac: 'open -a "Opera"', linux: "opera" },
        vscode: { win: "start code", mac: 'open -a "Visual Studio Code"', linux: "code" },
        cursor: { win: "start cursor", mac: 'open -a "Cursor"', linux: "cursor" },
        sublime: { win: "start subl", mac: 'open -a "Sublime Text"', linux: "subl" },
        notepadpp: { win: "start notepad++", mac: 'open -a "Notepad++"', linux: "notepad++" },
        spotify: { win: "start spotify", mac: 'open -a "Spotify"', linux: "spotify" },
        itunes: { win: "start itunes", mac: 'open -a "Music"', linux: "" },
        outlook: { win: "start outlook", mac: 'open -a "Microsoft Outlook"', linux: "" },
        mail: { win: "start mail", mac: 'open -a "Mail"', linux: "" },
        thunderbird: { win: "start thunderbird", mac: 'open -a "Thunderbird"', linux: "thunderbird" },
        wt: { win: "start wt", mac: 'open -a "Terminal"', linux: "gnome-terminal" },
        cmd: { win: "start cmd", mac: 'open -a "Terminal"', linux: "xterm" },
        powershell: { win: "start powershell", mac: 'open -a "Terminal"', linux: "gnome-terminal" },
        "gnome-terminal": { win: "", mac: 'open -a "Terminal"', linux: "gnome-terminal" },
        konsole: { win: "", mac: 'open -a "Terminal"', linux: "konsole" },
        terminal: { win: "start wt", mac: 'open -a "Terminal"', linux: "gnome-terminal" },
        iterm: { win: "", mac: 'open -a "iTerm"', linux: "" },
        calc: { win: "start calc", mac: 'open -a "Calculator"', linux: "gnome-calculator" },
        notepad: { win: "start notepad", mac: 'open -a "TextEdit"', linux: "gedit" },
    };
    const entry = map[appId];
    if (!entry)
        return null;
    const cmd = win ? entry.win : mac ? entry.mac : entry.linux;
    return cmd || null;
}
// ---------------------------------------------------------------------------
// Resolution helpers
// ---------------------------------------------------------------------------
/** Find the OS app id for a browser by display name. */
function browserIdFor(name, ctx) {
    if (!name)
        return null;
    const n = name.toLowerCase();
    const match = ctx.profile.browsers.find((b) => b.name.toLowerCase() === n);
    if (match)
        return match.id;
    // Partial fallback.
    if (n.includes("edge"))
        return ctx.profile.browsers.find((b) => b.id === "edge")?.id ?? null;
    if (n.includes("chrome"))
        return ctx.profile.browsers.find((b) => b.id === "chrome")?.id ?? null;
    if (n.includes("brave"))
        return ctx.profile.browsers.find((b) => b.id === "brave")?.id ?? null;
    if (n.includes("firefox"))
        return ctx.profile.browsers.find((b) => b.id === "firefox")?.id ?? null;
    return ctx.profile.browsers[0]?.id ?? null;
}
// ---------------------------------------------------------------------------
// Capability resolvers
// ---------------------------------------------------------------------------
function resolveOpenUrl(url, reason, ctx) {
    const browserId = browserIdFor(ctx.profile.defaultBrowser, ctx);
    if (browserId) {
        const browserName = ctx.profile.browsers.find((b) => b.id === browserId)?.name ?? "browser";
        const impl = {
            capability: "openUrl",
            label: browserName,
            reason: reason || `Opening in ${browserName} (your default browser)`,
            executor: "open-url-in-browser",
            params: { url, browserId, browserName },
        };
        return { capability: "openUrl", available: true, implementation: impl };
    }
    // No browser detected — fall back to OS default URL handler (still works
    // because the OS knows its own handlers even if our scan missed it).
    const impl = {
        capability: "openUrl",
        label: "system default",
        reason: "Opening with your system's default URL handler",
        executor: "open-url-system",
        params: { url },
    };
    return { capability: "openUrl", available: true, implementation: impl };
}
function resolveOpenBrowser(ctx) {
    const browserId = browserIdFor(ctx.profile.defaultBrowser, ctx);
    const name = ctx.profile.browsers.find((b) => b.id === browserId)?.name ?? null;
    if (browserId && name) {
        return {
            capability: "openBrowser",
            available: true,
            implementation: {
                capability: "openBrowser",
                label: name,
                reason: `Opening ${name} (your default browser)`,
                executor: "launch-app",
                params: { appId: browserId, appName: name },
            },
        };
    }
    return { capability: "openBrowser", available: false, implementation: null };
}
function resolveOpenApp(capability, category, preferredId, preferredName, ctx) {
    const list = category === "editor" ? ctx.profile.editors :
        category === "music" ? ctx.profile.musicApps :
            category === "mail" ? ctx.profile.mailApps :
                ctx.profile.terminals;
    // Try exact id match, then name, then first available.
    let chosen = list.find((a) => a.id === preferredId);
    if (!chosen && preferredName) {
        chosen = list.find((a) => a.name.toLowerCase() === preferredName.toLowerCase());
    }
    if (!chosen)
        chosen = list[0];
    if (chosen) {
        return {
            capability,
            available: true,
            implementation: {
                capability,
                label: chosen.name,
                reason: `Opening ${chosen.name}`,
                executor: "launch-app",
                params: { appId: chosen.id, appName: chosen.name },
            },
        };
    }
    return { capability, available: false, implementation: null };
}
function resolveWebSearch(query, ctx) {
    // Web search always works if any browser exists. Use default engine.
    const engine = ctx.profile.defaultBrowser ? "google" : "google";
    const impl = {
        capability: "webSearch",
        label: "Google Search",
        reason: `Searching the web for "${query}"`,
        executor: "open-url-in-browser",
        params: {
            url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
        },
    };
    return { capability: "webSearch", available: true, implementation: impl };
}
function resolvePlayMedia(query, ctx) {
    // Prefer Spotify if installed, fall back to YouTube in browser.
    const hasSpotify = ctx.profile.musicApps.some((m) => m.id === "spotify");
    const hasBrowser = ctx.profile.browsers.length > 0;
    if (hasSpotify) {
        return {
            capability: "playMedia",
            available: true,
            implementation: {
                capability: "playMedia",
                label: "Spotify",
                reason: `Playing "${query}" on Spotify`,
                executor: "open-url-in-browser",
                params: {
                    url: `https://open.spotify.com/search/${encodeURIComponent(query)}`,
                },
            },
            fallback: hasBrowser
                ? {
                    capability: "playMedia",
                    available: true,
                    implementation: {
                        capability: "playMedia",
                        label: "YouTube",
                        reason: `Playing "${query}" on YouTube`,
                        executor: "open-url-in-browser",
                        params: {
                            url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&autoplay=1`,
                            youtube: true,
                        },
                    },
                }
                : null,
        };
    }
    if (hasBrowser) {
        return {
            capability: "playMedia",
            available: true,
            implementation: {
                capability: "playMedia",
                label: "YouTube",
                reason: `Playing "${query}" on YouTube`,
                executor: "open-url-in-browser",
                params: {
                    url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&autoplay=1`,
                    youtube: true,
                },
            },
        };
    }
    return { capability: "playMedia", available: false, implementation: null };
}
function resolveComposeMail(to, subject, body, ctx) {
    // Always works via Gmail compose URL in browser.
    const hasBrowser = ctx.profile.browsers.length > 0;
    if (!hasBrowser) {
        return { capability: "composeMail", available: false, implementation: null };
    }
    const params = new URLSearchParams({ view: "cm", fs: "1" });
    if (to)
        params.set("to", to);
    if (subject)
        params.set("su", subject);
    if (body)
        params.set("body", body);
    return {
        capability: "composeMail",
        available: true,
        implementation: {
            capability: "composeMail",
            label: "Gmail",
            reason: "Drafting a new email in Gmail",
            executor: "open-url-in-browser",
            params: { url: `https://mail.google.com/mail/?${params.toString()}` },
        },
    };
}
function resolveSystemControl(ctx) {
    return {
        capability: "systemControl",
        available: true,
        implementation: {
            capability: "systemControl",
            label: "System Settings",
            reason: "Opening system settings",
            executor: "open-settings",
            params: { platform: ctx.profile.platform },
        },
    };
}
function resolveOpenFiles(location, ctx) {
    return {
        capability: "openFiles",
        available: true,
        implementation: {
            capability: "openFiles",
            label: "File Explorer",
            reason: location ? `Opening ${location}` : "Opening file explorer",
            executor: "open-files",
            params: { location, platform: ctx.profile.platform },
        },
    };
}
/** Resolve an abstract capability to a concrete implementation for this device. */
function resolveCapability(capability, ctx, opts = {}) {
    switch (capability) {
        case "openUrl":
            return resolveOpenUrl(opts.url ?? "about:blank", opts.reason ?? "", ctx);
        case "openBrowser":
            return resolveOpenBrowser(ctx);
        case "openEditor":
            return resolveOpenApp("openEditor", "editor", opts.appId ?? null, opts.appName ?? null, ctx);
        case "openMusic":
            return resolveOpenApp("openMusic", "music", opts.appId ?? null, opts.appName ?? null, ctx);
        case "openMail":
            return resolveOpenApp("openMail", "mail", opts.appId ?? null, opts.appName ?? null, ctx);
        case "openTerminal":
            return resolveOpenApp("openTerminal", "terminal", opts.appId ?? null, opts.appName ?? null, ctx);
        case "webSearch":
            return resolveWebSearch(opts.query ?? "", ctx);
        case "playMedia":
            return resolvePlayMedia(opts.query ?? "", ctx);
        case "composeMail":
            return resolveComposeMail(opts.to ?? "", opts.subject ?? "", opts.body ?? "", ctx);
        case "systemControl":
            return resolveSystemControl(ctx);
        case "openFiles":
            return resolveOpenFiles(opts.location ?? null, ctx);
        case "openSettings":
            return resolveSystemControl(ctx);
        case "readClipboard":
            return {
                capability: "readClipboard",
                available: true,
                implementation: {
                    capability: "readClipboard",
                    label: "Clipboard",
                    reason: "Reading clipboard",
                    executor: "read-clipboard",
                    params: {},
                },
            };
        case "noop":
        default:
            return { capability: "noop", available: false, implementation: null };
    }
}
/** Quick check: is this capability available at all on the current device? */
function isAvailable(capability, ctx, opts) {
    return resolveCapability(capability, ctx, opts).available;
}
//# sourceMappingURL=capability-registry.js.map