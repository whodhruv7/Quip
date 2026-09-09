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

import { BrowserWindow } from "electron";

/**
 * The SINGLE window factory — injected by main.ts. Every companion window
 * must be created through it so close-interception, crash recovery,
 * self-heal, visibility control, position persistence and broadcast
 * delivery apply to ALL companions (root-cause fix: swarm windows used to
 * bypass every stability system).
 */
export type CompanionWindowFactory = (
  companionId: CompanionId,
  offsetX?: number,
  offsetY?: number
) => BrowserWindow;

export type CompanionId = "pix" | "kai" | "ren" | "bubbles" | "capy" | "skales";

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
  bubbles: "Bubbles — Playful",
  capy: "Capy — Calm",
  skales: "Skales — The Original",
};

class SwarmManager {
  private instances = new Map<number, SwarmInstance>();
  private windowFactory: CompanionWindowFactory | null = null;
  private messageListeners = new Set<(from: CompanionId, to: CompanionId, message: string) => void>();

  /**
   * Inject the single window factory (main.createWindow). Every spawned
   * companion then inherits ALL lifecycle guarantees — one factory, one
   * set of maps, zero duplicated window systems.
   */
  setWindowFactory(factory: CompanionWindowFactory): void {
    this.windowFactory = factory;
  }

  /**
   * Spawn a new companion through the injected factory.
   * Headless spawns no window at all (an invisible zombie window would
   * fight the self-heal loop — headless companions are registry-only).
   * Returns the window ID, or -1 for headless instances.
   */
  spawn(companionId: CompanionId, opts: SpawnOptions = {}): number {
    const { headless = false, offsetX = 0, offsetY = 0, autoTask } = opts;

    if (headless || !this.windowFactory) {
      // Registry-only instance — no window, no sprite, no lifecycle risk.
      const ghostId = -1 - this.instances.size;
      this.instances.set(ghostId, {
        winId: ghostId,
        companionId,
        headless: true,
        spawnedAt: Date.now(),
        label: COMPANION_LABELS[companionId],
      });
      return ghostId;
    }

    // Stack extra companions so they never sit exactly on top of each other.
    const existingCount = this.instances.size;
    const stack = existingCount * 40;
    const win = this.windowFactory(
      companionId,
      offsetX + stack,
      offsetY + stack
    );

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
      headless: false,
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

  /** Get the BrowserWindow for a companion (first match, live windows only). */
  getWindowForCompanion(companionId: CompanionId): BrowserWindow | null {
    for (const [winId, inst] of this.instances.entries()) {
      if (inst.headless || winId < 0) continue;
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

  /** Broadcast a message to all running (windowed) companions. */
  broadcast(channel: string, data: unknown): void {
    for (const [winId, inst] of this.instances.entries()) {
      if (inst.headless || winId < 0) continue;
      const win = BrowserWindow.fromId(winId);
      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    }
  }

  /** Dismiss a companion window. destroy() bypasses the close-interception
   *  (which intentionally hides the PRIMARY companion on Alt+F4) — dismissal
   *  must actually remove the extra sprite, and its "closed" event must fire
   *  so the instance registry stays truthful. */
  dismiss(winId: number): void {
    if (winId >= 0) {
      const win = BrowserWindow.fromId(winId);
      if (win && !win.isDestroyed()) {
        win.destroy();
      }
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
