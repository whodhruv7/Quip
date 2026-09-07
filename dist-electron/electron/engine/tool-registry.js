"use strict";
// Quip Execution Engine V2 — Tool Registry
// ─────────────────────────────────────────────────────────────────────────────
// One registry routing every action to a real executor + verification:
//   open_app        → app-discovery (installed index, launch, verify process)
//   open_folder/file→ file-discovery (resolve + open + verify)
//   open_website/url→ browser-automation (focused surface, safe-URL gate)
//   play_media      → browser-automation YouTube search → verified watch URL
//   read_page       → Agent-Reach web reader
//   desktop actions → desktop-controller (focus/close/type/key/click/scroll/
//                     drag/clipboard)
//
// Every ToolResult carries verified state — never fake success.
// ─────────────────────────────────────────────────────────────────────────────
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.invalidateAppIndex = invalidateAppIndex;
exports.executeTool = executeTool;
const electron_1 = require("electron");
const node_path_1 = __importDefault(require("node:path"));
const electron_2 = require("electron");
const legacy_tools_1 = require("./legacy-tools");
const app_discovery_1 = require("./app-discovery");
const desktop_controller_1 = require("./desktop-controller");
const file_ops_1 = require("./file-ops");
const file_discovery_1 = require("./file-discovery");
const browser_automation_1 = require("./browser-automation");
const context_store_1 = require("./context-store");
function fromVerification(v) {
    return { success: v.ok, output: v.summary, note: v.summary, evidence: v.evidence };
}
let appIndexPromise = null;
async function getAppIndex() {
    if (!appIndexPromise) {
        appIndexPromise = (0, app_discovery_1.buildInstalledAppIndex)(electron_2.app.getPath("userData"));
    }
    try {
        return await appIndexPromise;
    }
    catch {
        return (0, app_discovery_1.getCachedAppIndex)() ?? [];
    }
}
/** Allow tests / manual rescan to invalidate the cached app index. */
function invalidateAppIndex() {
    appIndexPromise = null;
}
// ─── Executors ───────────────────────────────────────────────────────────────
const Executors = {
    async open_app(step, _ctx) {
        const apps = await getAppIndex();
        const query = step.params.query || step.params.appName || step.target;
        let resolved = (0, app_discovery_1.resolveApp)(query, apps);
        // Alias corrections for canonical labels not present in names
        if (!resolved) {
            const aliasMap = {
                "visual studio code": "code",
                "file explorer": "explorer",
            };
            const alt = aliasMap[query.toLowerCase()];
            if (alt)
                resolved = (0, app_discovery_1.resolveApp)(alt, apps);
        }
        if (resolved) {
            const result = await (0, app_discovery_1.launchApp)(resolved);
            if (result.ok) {
                context_store_1.contextStore.update({ activeApp: resolved.name });
            }
            return fromVerification(result);
        }
        // Not installed → sensible fallbacks
        const q = query.toLowerCase();
        if (q.includes("whatsapp")) {
            const result = await (0, browser_automation_1.openBrowserSurface)("https://web.whatsapp.com");
            return {
                success: result.ok,
                output: result.ok
                    ? "WhatsApp isn't installed as an app, so I opened WhatsApp Web instead."
                    : result.summary,
                note: result.ok ? "app missing → web fallback" : result.summary,
                evidence: result.evidence,
            };
        }
        // Maybe it's actually a website the user calls an "app"
        const web = await (0, browser_automation_1.openBrowserSurface)(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
        return {
            success: false,
            output: `I couldn't find an installed app called "${query}".`,
            note: web.ok
                ? "app not found — opened a web search so you can double-check the name"
                : "app not found",
            evidence: ["no Start Menu / Program Files / Store match"],
        };
    },
    async open_website(step, _ctx) {
        const result = await (0, browser_automation_1.openBrowserSurface)(step.params.url);
        if (result.ok)
            context_store_1.contextStore.update({ activeWebsite: step.target, activeUrl: step.params.url });
        return fromVerification(result);
    },
    async open_url(step, _ctx) {
        const result = await (0, browser_automation_1.openBrowserSurface)(step.params.url);
        if (result.ok)
            context_store_1.contextStore.update({ activeUrl: step.params.url });
        return fromVerification(result);
    },
    async search_web(step, _ctx) {
        const result = await (0, browser_automation_1.openBrowserSurface)(step.params.url);
        return fromVerification(result);
    },
    async search_youtube(step, _ctx) {
        const result = await (0, browser_automation_1.openBrowserSurface)(step.params.url);
        if (result.ok)
            context_store_1.contextStore.update({ activeWebsite: "youtube", lastMediaQuery: step.params.query });
        return fromVerification(result);
    },
    async play_media(step, _ctx) {
        if (step.params.youtube === "true" || step.target === "youtube") {
            const result = await (0, browser_automation_1.playFirstYouTubeResult)(step.params.query ?? step.target);
            return fromVerification(result);
        }
        // Spotify / other: open the URL
        const result = await (0, browser_automation_1.openBrowserSurface)(step.params.url);
        if (result.ok)
            context_store_1.contextStore.update({ lastMediaQuery: step.params.query });
        return fromVerification(result);
    },
    async open_folder(step, _ctx) {
        const target = await (0, file_discovery_1.resolveLocalTarget)(step.params.location || step.params.query || step.target, context_store_1.contextStore.get());
        if (!target) {
            return {
                success: false,
                output: `I couldn't find a folder called "${step.params.query ?? step.target}".`,
                note: "no matching folder in known locations or project directories",
                evidence: ["known folders + project roots scanned"],
            };
        }
        const result = await (0, file_discovery_1.openLocalTarget)(target);
        if (result.ok)
            context_store_1.contextStore.update({ lastOpenedPath: target.path });
        return fromVerification(result);
    },
    async open_file(step, _ctx) {
        const target = await (0, file_discovery_1.resolveLocalTarget)(step.params.query || step.target, context_store_1.contextStore.get());
        if (!target) {
            return {
                success: false,
                output: `I couldn't find a file called "${step.params.query ?? step.target}".`,
                note: "no matching file in known locations or project directories",
                evidence: ["known folders + project roots scanned"],
            };
        }
        const result = await (0, file_discovery_1.openLocalTarget)(target);
        if (result.ok)
            context_store_1.contextStore.update({ lastOpenedPath: target.path });
        return fromVerification(result);
    },
    async focus_app(step, _ctx) {
        return fromVerification(await (0, desktop_controller_1.executeDesktopAction)({ type: "focus", target: step.params.target ?? step.target }));
    },
    async close_app(step, _ctx) {
        return fromVerification(await (0, desktop_controller_1.executeDesktopAction)({ type: "close", target: step.params.target ?? step.target }));
    },
    async type_text(step, _ctx) {
        return fromVerification(await (0, desktop_controller_1.executeDesktopAction)({ type: "type", text: step.params.text ?? "" }));
    },
    async press_key(step, _ctx) {
        const keys = (step.params.keys ?? "").split(",").map((k) => k.trim()).filter(Boolean);
        return fromVerification(await (0, desktop_controller_1.executeDesktopAction)({ type: "key", keys }));
    },
    async click(step, _ctx) {
        const variant = step.params.variant;
        // No coordinates → click at the CURRENT cursor position (real, honest).
        const hasCoords = step.params.x !== undefined && step.params.x !== "";
        const x = hasCoords ? parseFloat(step.params.x) : undefined;
        const y = hasCoords ? parseFloat(step.params.y) : undefined;
        if (variant === "double" || variant === "right") {
            return fromVerification(await (0, desktop_controller_1.executeDesktopAction)({ type: "click.variant", variant, x, y }));
        }
        return fromVerification(await (0, desktop_controller_1.executeDesktopAction)({ type: "click", x, y }));
    },
    async scroll(step, _ctx) {
        return fromVerification(await (0, desktop_controller_1.executeDesktopAction)({
            type: "scroll",
            deltaY: parseFloat(step.params.deltaY ?? "-360"),
        }));
    },
    async clipboard(step, _ctx) {
        if (step.params.mode === "write" && step.params.text) {
            return fromVerification(await (0, desktop_controller_1.executeDesktopAction)({ type: "clipboard.write", text: step.params.text }));
        }
        return fromVerification(await (0, desktop_controller_1.executeDesktopAction)({ type: "clipboard.read" }));
    },
    async read_page(step, _ctx) {
        return fromVerification(await (0, browser_automation_1.readWebPage)(step.params.url));
    },
    async window_control(step, _ctx) {
        const op = (step.params.op ?? "minimize");
        if (step.params.op === "move") {
            return fromVerification(await (0, desktop_controller_1.executeDesktopAction)({
                type: "window.move",
                target: step.params.target ?? step.target,
                x: parseFloat(step.params.x ?? "0"),
                y: parseFloat(step.params.y ?? "0"),
            }));
        }
        if (step.params.op === "resize") {
            return fromVerification(await (0, desktop_controller_1.executeDesktopAction)({
                type: "window.resize",
                target: step.params.target ?? step.target,
                width: parseFloat(step.params.width ?? "1000"),
                height: parseFloat(step.params.height ?? "700"),
            }));
        }
        return fromVerification(await (0, desktop_controller_1.executeDesktopAction)({
            type: "window.control",
            op: op === "restore" ? "restore" : op,
            target: step.params.target ?? step.target,
        }));
    },
    async screen(_step, _ctx) {
        return fromVerification(await (0, desktop_controller_1.executeDesktopAction)({ type: "screen.capture" }));
    },
    async windows_list(_step, _ctx) {
        return fromVerification(await (0, desktop_controller_1.executeDesktopAction)({ type: "windows.list" }));
    },
    async file_op(step, _ctx) {
        const op = step.params.op;
        // ── search: local-first file search, optional "open the first hit" ──
        if (op === "search") {
            const query = step.params.query ?? step.params.path ?? "";
            const base = step.params.base;
            const res = (0, file_ops_1.searchFiles)(query, base);
            if (res.hits.length === 0) {
                return {
                    success: false,
                    output: `I couldn't find any file matching "${query}".`,
                    note: "searched common folders, no hits",
                    evidence: ["local search found nothing"],
                };
            }
            // "…and open it" → open the first REAL hit and report honestly.
            if (step.params.openFirst === "true") {
                const first = res.hits[0];
                const opened = await (0, file_discovery_1.openLocalTarget)({
                    kind: "file",
                    path: first,
                    displayName: node_path_1.default.basename(first),
                    confidence: 1,
                });
                const others = res.hits.slice(1, 5);
                return {
                    success: opened.ok,
                    output: `Found ${res.hits.length} matching item${res.hits.length > 1 ? "s" : ""}. ` +
                        (opened.ok
                            ? `Opened the first one: ${first}`
                            : `I found "${first}" but couldn't open it — ${opened.summary}`) +
                        (others.length ? `\nOther matches:\n${others.map((h) => `• ${h}`).join("\n")}` : ""),
                    note: opened.ok ? "file-search: opened first hit" : "file-search: open failed",
                    evidence: [`hits: ${res.hits.length}`, opened.ok ? `opened ${first}` : "open failed"],
                };
            }
            return {
                success: true,
                output: `Found ${res.hits.length} matching item${res.hits.length > 1 ? "s" : ""}:\n${res.hits.map((h) => `• ${h}`).join("\n")}`,
                note: "file-search",
                evidence: [`searched: ${query}`],
            };
        }
        // ── everything else: synchronous fs operation with verification ──
        const fileAction = (() => {
            switch (op) {
                case "read":
                    return { op: "read", path: step.params.path ?? "" };
                case "write":
                case "append":
                    return { op: "write", path: step.params.path ?? "", content: step.params.content ?? "", append: op === "append" };
                case "delete":
                    return { op: "delete", path: step.params.path ?? "" };
                case "copy":
                    return { op: "copy", from: step.params.from ?? step.params.path ?? "", to: step.params.to ?? "" };
                case "move":
                    return { op: "move", from: step.params.from ?? step.params.path ?? "", to: step.params.to ?? "" };
                case "mkdir":
                    return { op: "mkdir", path: step.params.path ?? "" };
                case "list":
                    return { op: "list", path: step.params.path ?? "" };
                default:
                    return null;
            }
        })();
        if (!fileAction) {
            return { success: false, output: `Unknown file operation: ${op}`, note: "unsupported-file-op" };
        }
        return fromVerification((0, file_ops_1.executeFileOp)(fileAction));
    },
    async site_search(step, _ctx) {
        const site = step.params.site ?? "web";
        const query = step.params.query ?? "";
        const SEARCH_URLS = {
            reddit: `https://www.reddit.com/search/?q=${encodeURIComponent(query)}`,
            x: `https://x.com/search?q=${encodeURIComponent(query)}`,
            twitter: `https://x.com/search?q=${encodeURIComponent(query)}`,
            github: `https://github.com/search?q=${encodeURIComponent(query)}&type=repositories`,
            youtube: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
        };
        const searchUrl = SEARCH_URLS[site];
        if (!searchUrl) {
            return { success: false, output: `I don't know how to search ${site}.`, note: "unknown-site" };
        }
        const opened = await (0, browser_automation_1.openBrowserSurface)(searchUrl);
        if (!opened.ok) {
            return fromVerification(opened);
        }
        // Read the results page for an honest summary (best effort — some sites
        // require login; if reading fails the open itself is still real).
        const read = await (0, browser_automation_1.readWebPage)(searchUrl);
        const summary = read.ok && read.summary
            ? `Opened ${site} search for "${query}" — top of the results page:\n${read.summary.slice(0, 1200)}`
            : `Opened ${site} search for "${query}" in the browser.` +
                (read.ok ? "" : " I couldn't read the results page — the site may require login.");
        return {
            success: true,
            output: summary,
            note: "site-search",
            evidence: [`search url: ${searchUrl}`, read.ok ? "results page read" : "results page not readable"],
        };
    },
    async compose_email(step, _ctx) {
        const result = await (0, browser_automation_1.openBrowserSurface)(step.params.url);
        return fromVerification(result);
    },
    async compose_message(step, _ctx) {
        const result = await (0, browser_automation_1.openBrowserSurface)(step.params.url);
        return fromVerification(result);
    },
    async system_action(step, _ctx) {
        // Settings is safe + verifiable on Windows
        if (step.target === "settings") {
            const verification = await (0, desktop_controller_1.executeDesktopAction)({ type: "focus", target: "Settings" })
                .then(async (focusRes) => {
                if (focusRes.ok)
                    return focusRes;
                try {
                    await electron_1.shell.openExternal("ms-settings:");
                    return { ok: true, summary: "Opened system settings.", evidence: ["ms-settings: opened"] };
                }
                catch {
                    return { ok: false, summary: "I couldn't open Settings.", evidence: [], error: "settings-failed" };
                }
            });
            return fromVerification(verification);
        }
        return { success: false, output: `Unsupported system action: ${step.target}`, note: "unsupported" };
    },
};
// ─── Router ──────────────────────────────────────────────────────────────────
async function executeTool(action, stepOrParams, ctx) {
    // New-style: full TaskStep object
    const step = stepOrParams;
    const executor = Executors[action];
    if (executor) {
        try {
            return await executor(step, ctx);
        }
        catch (e) {
            return {
                success: false,
                output: `Something went wrong running that action.`,
                note: `executor error: ${String(e?.message ?? e)}`,
            };
        }
    }
    // Legacy fallback for old-style (action, params) calls
    const params = (stepOrParams && typeof stepOrParams === "object" ? stepOrParams : {});
    return (0, legacy_tools_1.executeTool)(action, params, ctx);
}
//# sourceMappingURL=tool-registry.js.map