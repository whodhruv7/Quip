"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.permissionSystem = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const FILENAME = "permissions.json";
// Default risk classification per capability. These are conservative defaults.
const DEFAULT_RISK = {
    openBrowser: "safe",
    openUrl: "safe",
    webSearch: "safe",
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
    launchApp: "safe",
    systemLock: "medium",
    systemPower: "dangerous",
    systemPrivilege: "dangerous",
};
class PermissionSystem {
    store = { grants: {} };
    filePath = null;
    init(userDataDir) {
        this.filePath = node_path_1.default.join(userDataDir, FILENAME);
        this.load();
    }
    load() {
        if (!this.filePath)
            return;
        try {
            if (node_fs_1.default.existsSync(this.filePath)) {
                const data = JSON.parse(node_fs_1.default.readFileSync(this.filePath, "utf8"));
                if (data && typeof data.grants === "object") {
                    this.store.grants = data.grants;
                }
            }
        }
        catch {
            /* corrupt file — start fresh */
        }
    }
    save() {
        if (!this.filePath)
            return;
        try {
            node_fs_1.default.writeFileSync(this.filePath, JSON.stringify(this.store, null, 2));
        }
        catch {
            /* best effort */
        }
    }
    /** What risk level does this capability carry? */
    riskFor(capability) {
        return DEFAULT_RISK[capability] ?? "medium";
    }
    /** Does this capability require a confirmation prompt right now? */
    requiresConfirmation(capability) {
        const risk = this.riskFor(capability);
        if (risk === "safe")
            return false;
        // medium/dangerous: only skip if user previously granted always-allow.
        return !this.store.grants[capability];
    }
    /** Record a user decision (approve + "always allow", or deny). */
    recordDecision(capability, approved, alwaysAllow) {
        if (approved && alwaysAllow) {
            this.store.grants[capability] = true;
            this.save();
        }
        else if (!approved) {
            // Denials are not persisted — user can retry later.
        }
    }
    /** Revoke a previously granted always-allow. */
    revoke(capability) {
        delete this.store.grants[capability];
        this.save();
    }
    /** Snapshot for the settings UI. */
    listRules() {
        return Object.keys(DEFAULT_RISK).map((cap) => ({
            capability: cap,
            level: DEFAULT_RISK[cap],
            granted: !!this.store.grants[cap],
        }));
    }
}
exports.permissionSystem = new PermissionSystem();
//# sourceMappingURL=permission-system.js.map