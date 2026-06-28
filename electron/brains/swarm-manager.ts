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

import { BrowserWindow, screen } from "electron";
import path from "node:path";

export type CompanionId = "pix" | "kai" | "ren";

export interface SwarmInstance {
  winId: number;
  companionId: CompanionId;
  headless: boolean;
  spawnedAt: number;
  label: string;
}

export interface SpawnOptions {
  headless?: boolean;
  offsetX?: number;
  offsetY?: number;
  /** If provided, companion will auto-execute this task at startup */
  autoTask?: string;
}

const COMPANION_LABELS: Record<CompanionId, string> = {
  pix: "Pix — Creative",
  kai: "Kai — Analytical",
  ren: "Ren — Empathetic",
};

class SwarmManager {
  private instances = new Map<number, SwarmInstance>();
  private preloadPath = "";
  private distPath = "";
  private isDev = process.env.NODE_ENV === "development";
  private viteUrl = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173";
  private messageListeners = new Set<(from: CompanionId, to: CompanionId, message: string) => void>();

  /** Called once during bootstrap to set asset paths. */
  configure(preloadPath: string, distPath: string): void {
    this.preloadPath = preloadPath;
    this.distPath = distPath;
  }

  /** Spawn a new companion window. Returns the window ID. */
  spawn(companionId: CompanionId, opts: SpawnOptions = {}): number {
    const { headless = false, offsetX = 0, offsetY = 0, autoTask } = opts;

    const existingCount = this.instances.size;
    const area = screen.getPrimaryDisplay().workArea;

    // Default position: cascade from bottom-right, offset per instance
    const w = 440;
    const h = 680;
    const baseX = area.x + area.width - w - 20 + offsetX + existingCount * 40;
    const baseY = area.y + area.height - h - 20 + offsetY + existingCount * 40;

    const win = new BrowserWindow({
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
    const file = !this.isDev ? path.join(this.distPath, "index.html") : undefined;

    if (url) {
      win.loadURL(url);
    } else if (file) {
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

    const instance: SwarmInstance = {
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
  getInstances(): SwarmInstance[] {
    return Array.from(this.instances.values());
  }

  /** Get companion ID for a given window ID. */
  getCompanionId(winId: number): CompanionId | null {
    return this.instances.get(winId)?.companionId ?? null;
  }

  /** Get the BrowserWindow for a companion (first match). */
  getWindowForCompanion(companionId: CompanionId): BrowserWindow | null {
    for (const [winId, inst] of this.instances.entries()) {
      if (inst.companionId === companionId) {
        const win = BrowserWindow.fromId(winId);
        if (win && !win.isDestroyed()) return win;
      }
    }
    return null;
  }

  /**
   * Route an inter-companion message from one companion to another.
   * The receiving companion's window will get the IPC event.
   */
  routeMessage(fromWinId: number, toCompanionId: CompanionId, message: string): boolean {
    const fromInst = this.instances.get(fromWinId);
    if (!fromInst) return false;

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
  broadcast(channel: string, data: unknown): void {
    for (const [winId] of this.instances.entries()) {
      const win = BrowserWindow.fromId(winId);
      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    }
  }

  /** Dismiss (close) a companion window. */
  dismiss(winId: number): void {
    const win = BrowserWindow.fromId(winId);
    if (win && !win.isDestroyed()) {
      win.close();
    }
    this.instances.delete(winId);
  }

  /** Dismiss all companions. */
  dismissAll(): void {
    for (const winId of this.instances.keys()) {
      this.dismiss(winId);
    }
  }

  /** Subscribe to inter-companion message routing events (for logging). */
  onMessage(cb: (from: CompanionId, to: CompanionId, message: string) => void): () => void {
    this.messageListeners.add(cb);
    return () => this.messageListeners.delete(cb);
  }

  get size(): number {
    return this.instances.size;
  }
}

export const swarmManager = new SwarmManager();
