"use strict";
// Quip V2 — SWARM MANAGER (Phase 3)
// -----------------------------------------------------------------------------
// Manages the multi-instance companion architecture.
//
// In Phase 3, Quip is no longer a single window. You can spawn separate
// companion windows — each with its own personality (Pix, Kai, Ren) —
// all sharing the same backend brain data (memory, knowledge graph, timeline).
//
// Architecture:
//   - Each companion window is a BrowserWindow identified by window ID
//   - windowCompanionMap: winId → companionId
//   - Companions can send messages to each other via INTER_COMPANION_MSG IPC
//   - Headless companions run without a visible window (for background tasks)
//   - Shared Hive Mind: all instances read/write the same memoryBrain, etc.
//
// SwarmManager wraps the window management logic for clean separation.
// -----------------------------------------------------------------------------
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.swarmManager = void 0;
const electron_1 = require("electron");
const node_path_1 = __importDefault(require("node:path"));
const COMPANION_LABELS = {
    pix: "Pix — Creative",
    kai: "Kai — Analytical",
    ren: "Ren — Empathetic",
};
class SwarmManager {
    instances = new Map();
    preloadPath = "";
    distPath = "";
    isDev = process.env.NODE_ENV === "development";
    viteUrl = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173";
    messageListeners = new Set();
    /** Called once during bootstrap to set asset paths. */
    configure(preloadPath, distPath) {
        this.preloadPath = preloadPath;
        this.distPath = distPath;
    }
    /** Spawn a new companion window. Returns the window ID. */
    spawn(companionId, opts = {}) {
        const { headless = false, offsetX = 0, offsetY = 0, autoTask } = opts;
        const existingCount = this.instances.size;
        const area = electron_1.screen.getPrimaryDisplay().workArea;
        // Default position: cascade from bottom-right, offset per instance
        const w = 440;
        const h = 680;
        const baseX = area.x + area.width - w - 20 + offsetX + existingCount * 40;
        const baseY = area.y + area.height - h - 20 + offsetY + existingCount * 40;
        const win = new electron_1.BrowserWindow({
            width: w,
            height: h,
            x: Math.min(baseX, area.x + area.width - w),
            y: Math.min(baseY, area.y + area.height - h),
            frame: false,
            transparent: true,
            resizable: false,
            maximizable: false,
            minimizable: false,
            fullscreenable: false,
            hasShadow: false,
            skipTaskbar: true,
            alwaysOnTop: true,
            show: !headless,
            backgroundColor: "#00000000",
            webPreferences: {
                preload: this.preloadPath,
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: false,
            },
        });
        if (!headless) {
            win.setAlwaysOnTop(true, "screen-saver");
            win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
            win.showInactive();
            win.moveTop();
        }
        // Load the app
        const url = this.isDev
            ? `${this.viteUrl}?companion=${companionId}`
            : undefined;
        const file = !this.isDev ? node_path_1.default.join(this.distPath, "index.html") : undefined;
        if (url) {
            win.loadURL(url);
        }
        else if (file) {
            win.loadFile(file, { search: `companion=${companionId}` });
        }
        // If autoTask specified, send it after page load
        if (autoTask) {
            win.webContents.once("did-finish-load", () => {
                if (!win.isDestroyed()) {
                    win.webContents.send("quip:auto-task", { task: autoTask });
                }
            });
        }
        const instance = {
            winId: win.id,
            companionId,
            headless,
            spawnedAt: Date.now(),
            label: COMPANION_LABELS[companionId],
        };
        this.instances.set(win.id, instance);
        win.on("closed", () => {
            this.instances.delete(win.id);
        });
        return win.id;
    }
    /** Get all active swarm instances. */
    getInstances() {
        return Array.from(this.instances.values());
    }
    /** Get companion ID for a given window ID. */
    getCompanionId(winId) {
        return this.instances.get(winId)?.companionId ?? null;
    }
    /** Get the BrowserWindow for a companion (first match). */
    getWindowForCompanion(companionId) {
        for (const [winId, inst] of this.instances.entries()) {
            if (inst.companionId === companionId) {
                const win = electron_1.BrowserWindow.fromId(winId);
                if (win && !win.isDestroyed())
                    return win;
            }
        }
        return null;
    }
    /**
     * Route an inter-companion message from one companion to another.
     * The receiving companion's window will get the IPC event.
     */
    routeMessage(fromWinId, toCompanionId, message) {
        const fromInst = this.instances.get(fromWinId);
        if (!fromInst)
            return false;
        const targetWin = this.getWindowForCompanion(toCompanionId);
        if (!targetWin) {
            console.warn(`[SwarmManager] No window found for companion: ${toCompanionId}`);
            return false;
        }
        targetWin.webContents.send("quip:inter-companion-msg", {
            from: fromInst.companionId,
            to: toCompanionId,
            message,
        });
        // Notify internal listeners (e.g. for logging)
        this.messageListeners.forEach((l) => l(fromInst.companionId, toCompanionId, message));
        return true;
    }
    /** Broadcast a message to all running companions. */
    broadcast(channel, data) {
        for (const [winId] of this.instances.entries()) {
            const win = electron_1.BrowserWindow.fromId(winId);
            if (win && !win.isDestroyed()) {
                win.webContents.send(channel, data);
            }
        }
    }
    /** Dismiss (close) a companion window. */
    dismiss(winId) {
        const win = electron_1.BrowserWindow.fromId(winId);
        if (win && !win.isDestroyed()) {
            win.close();
        }
        this.instances.delete(winId);
    }
    /** Dismiss all companions. */
    dismissAll() {
        for (const winId of this.instances.keys()) {
            this.dismiss(winId);
        }
    }
    /** Subscribe to inter-companion message routing events (for logging). */
    onMessage(cb) {
        this.messageListeners.add(cb);
        return () => this.messageListeners.delete(cb);
    }
    get size() {
        return this.instances.size;
    }
}
exports.swarmManager = new SwarmManager();
//# sourceMappingURL=swarm-manager.js.map