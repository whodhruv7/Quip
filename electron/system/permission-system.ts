// Quip V2 — PERMISSION SYSTEM
// -----------------------------------------------------------------------------
// Trust > power. Every action Quip can take is classified into one of three
// risk levels:
//
//   SAFE       — open apps, search, read clipboard. Auto-execute, no prompt.
//   MEDIUM     — compose mail, change settings. Ask once, remember choice.
//   DANGEROUS  — delete, system shutdown, registry changes. Always ask.
//
// The permission system is the gate between the task brain's plan and the
// tool executor's action. It never blocks SAFE actions (they're instant) but
// it ALWAYS stops DANGEROUS ones for explicit user approval. This is what
// makes Quip trustworthy enough to "take over the device".
// -----------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import type {
  CapabilityId,
  PermissionLevel,
  PermissionRule,
} from "../../src/types";

const FILENAME = "permissions.json";
<<<<<<< HEAD
=======
export type PermissionMode = "ask" | "task" | "full";
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276

// Default risk classification per capability. These are conservative defaults.
const DEFAULT_RISK: Record<CapabilityId, PermissionLevel> = {
  openBrowser: "safe",
  openUrl: "safe",
  webSearch: "safe",
<<<<<<< HEAD
=======
  launchApp: "safe",
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
  openEditor: "safe",
  openTerminal: "safe",
  openFiles: "safe",
  playMedia: "safe",
  readClipboard: "safe",
  openMusic: "safe",
  openSettings: "medium",
  systemControl: "medium",
  composeMail: "medium",
  openMail: "medium",
  noop: "safe",
};

interface PermissionStore {
  // Persisted grants: capability -> granted (always allow).
  grants: Record<string, boolean>;
<<<<<<< HEAD
}

class PermissionSystem {
  private store: PermissionStore = { grants: {} };
=======
  mode: PermissionMode;
}

class PermissionSystem {
  private store: PermissionStore = { grants: {}, mode: "task" };
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
  private filePath: string | null = null;

  init(userDataDir: string): void {
    this.filePath = path.join(userDataDir, FILENAME);
    this.load();
  }

  private load(): void {
    if (!this.filePath) return;
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
        if (data && typeof data.grants === "object") {
          this.store.grants = data.grants;
        }
<<<<<<< HEAD
=======
        if (data && (data.mode === "ask" || data.mode === "task" || data.mode === "full")) {
          this.store.mode = data.mode;
        }
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
      }
    } catch {
      /* corrupt file — start fresh */
    }
  }

  private save(): void {
    if (!this.filePath) return;
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.store, null, 2));
    } catch {
      /* best effort */
    }
  }

  /** What risk level does this capability carry? */
  riskFor(capability: CapabilityId): PermissionLevel {
    return DEFAULT_RISK[capability] ?? "medium";
  }

<<<<<<< HEAD
  /** Does this capability require a confirmation prompt right now? */
  requiresConfirmation(capability: CapabilityId): boolean {
    const risk = this.riskFor(capability);
=======
  getMode(): PermissionMode {
    return this.store.mode;
  }

  setMode(mode: PermissionMode): void {
    this.store.mode = mode;
    this.save();
  }

  /** Does this capability require a confirmation prompt right now? */
  requiresConfirmation(capability: CapabilityId): boolean {
    const risk = this.riskFor(capability);
    if (this.store.mode === "ask") return true;
    if (this.store.mode === "full") return risk === "dangerous";
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
    if (risk === "safe") return false;
    // medium/dangerous: only skip if user previously granted always-allow.
    return !this.store.grants[capability];
  }

  /** Record a user decision (approve + "always allow", or deny). */
  recordDecision(
    capability: CapabilityId,
    approved: boolean,
    alwaysAllow: boolean
  ): void {
    if (approved && alwaysAllow) {
      this.store.grants[capability] = true;
      this.save();
    } else if (!approved) {
      // Denials are not persisted — user can retry later.
    }
  }

  /** Revoke a previously granted always-allow. */
  revoke(capability: CapabilityId): void {
    delete this.store.grants[capability];
    this.save();
  }

  /** Snapshot for the settings UI. */
  listRules(): PermissionRule[] {
    return (Object.keys(DEFAULT_RISK) as CapabilityId[]).map((cap) => ({
      capability: cap,
      level: DEFAULT_RISK[cap],
      granted: !!this.store.grants[cap],
    }));
  }
}

export const permissionSystem = new PermissionSystem();
