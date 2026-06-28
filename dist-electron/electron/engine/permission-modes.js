"use strict";
// Quip Execution Engine V2 — Permission System
// ─────────────────────────────────────────────────────────────────────────────
// Three permission modes (like Codex):
//   1. Ask Every Time — confirm each action
//   2. Approve Task — confirm plan once, execute all steps
//   3. Full Access — execute automatically (still block dangerous ops)
//
// Dangerous operations ALWAYS require confirmation regardless of mode:
//   - Delete files
//   - System commands
//   - Payments/banking
//   - Password changes
// ─────────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.permissionSystem = void 0;
// Actions that ALWAYS need confirmation, even in Full Access mode
const DANGEROUS_ACTIONS = new Set([
    "delete_file",
    "system_action",
    "move_file",
]);
// Risk level per action type
function getRiskLevel(action) {
    if (DANGEROUS_ACTIONS.has(action))
        return "dangerous";
    const mediumActions = new Set([
        "compose_email",
        "compose_message",
        "write_text",
        "copy_paste",
        "create_folder",
        "organize_files",
    ]);
    if (mediumActions.has(action))
        return "medium";
    return "safe";
}
class PermissionSystem {
    mode = "ask_every_time";
    pendingApprovals = new Map();
    getMode() {
        return this.mode;
    }
    setMode(mode) {
        this.mode = mode;
    }
    cycleMode() {
        const modes = ["ask_every_time", "approve_task", "full_access"];
        const idx = modes.indexOf(this.mode);
        this.mode = modes[(idx + 1) % modes.length];
        return this.mode;
    }
    getModeLabel() {
        switch (this.mode) {
            case "ask_every_time": return "Ask Every Time";
            case "approve_task": return "Approve Task";
            case "full_access": return "Full Access";
        }
    }
    /**
     * Check if an action needs user confirmation based on current mode + risk.
     */
    needsConfirmation(action) {
        const risk = getRiskLevel(action);
        // Dangerous actions ALWAYS need confirmation
        if (risk === "dangerous")
            return true;
        switch (this.mode) {
            case "ask_every_time":
                return true; // everything needs confirmation
            case "approve_task":
                return false; // already approved the plan
            case "full_access":
                return false; // only dangerous needs confirmation
        }
    }
    /**
     * Check if a multi-step plan needs approval before execution.
     */
    planNeedsApproval() {
        return this.mode === "ask_every_time" || this.mode === "approve_task";
    }
    /**
     * Create an approval request and wait for user response.
     */
    requestApproval(title, steps) {
        return new Promise((resolve) => {
            const id = `approval-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const request = {
                id,
                title,
                steps,
                mode: this.mode,
                timestamp: Date.now(),
            };
            this.pendingApprovals.set(id, (result) => {
                this.pendingApprovals.delete(id);
                resolve(result);
            });
            // Emit event — the IPC handler will pick this up
            this.onApprovalRequested?.(request);
        });
    }
    /**
     * Resolve a pending approval (called when user taps Approve/Reject).
     */
    resolveApproval(id, approved) {
        const resolver = this.pendingApprovals.get(id);
        if (resolver) {
            resolver({ approved, mode: this.mode });
        }
    }
    /** Callback set by main.ts to forward approval requests to renderer. */
    onApprovalRequested;
}
exports.permissionSystem = new PermissionSystem();
//# sourceMappingURL=permission-modes.js.map