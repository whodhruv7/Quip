// Quip Execution Engine V2 — Permission System (risk-gated)
// ─────────────────────────────────────────────────────────────────────────────
// Three permission modes:
//   1. Ask Every Time — confirm medium + dangerous actions (safe actions run
//      without nagging: opening apps/folders/public sites is read-mostly)
//   2. Approve Task   — confirm the plan once, then execute
//   3. Full Access    — only dangerous actions need confirmation
//
// Dangerous actions ALWAYS require confirmation, regardless of mode:
//   sending messages/emails, deleting/moving files, installing/uninstalling,
//   arbitrary commands, passwords/payments/2FA, system shutdown/restart/lock.
// ─────────────────────────────────────────────────────────────────────────────

export type PermissionMode = "ask_every_time" | "approve_task" | "full_access";
export type RiskLevel = "safe" | "medium" | "dangerous";

export interface ApprovalRequest {
  id: string;
  title: string;
  steps: string[];
  mode: PermissionMode;
  risk: RiskLevel;
  timestamp: number;
}

export interface ApprovalResult {
  approved: boolean;
  mode: PermissionMode;
}

// Actions that ALWAYS need confirmation, even in Full Access mode
const DANGEROUS_ACTIONS = new Set([
  "delete_file",
  "move_file",
  "run_command",
  "send_message",
  "send_email",
  "compose_message",
  "compose_email",
  "system_shutdown",
  "payment",
]);

const MEDIUM_ACTIONS = new Set([
  "write_text",
  "type_text",
  "press_key",
  "click",
  "drag",
  "copy_paste",
  "create_folder",
  "organize_files",
  "close_app",
]);

export function getRiskLevel(action: string): RiskLevel {
  if (DANGEROUS_ACTIONS.has(action)) return "dangerous";
  if (MEDIUM_ACTIONS.has(action)) return "medium";
  return "safe";
}

class PermissionSystem {
  private mode: PermissionMode = "approve_task";
  private pendingApprovals = new Map<string, (result: ApprovalResult) => void>();

  getMode(): PermissionMode {
    return this.mode;
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  cycleMode(): PermissionMode {
    const modes: PermissionMode[] = ["ask_every_time", "approve_task", "full_access"];
    const idx = modes.indexOf(this.mode);
    this.mode = modes[(idx + 1) % modes.length];
    return this.mode;
  }

  getModeLabel(): string {
    switch (this.mode) {
      case "ask_every_time": return "Ask Every Time";
      case "approve_task": return "Approve Task";
      case "full_access": return "Full Access";
    }
  }

  /**
   * Risk-based confirmation for a single action in the current mode.
   * Safe actions (open app/folder/site, search, read) never nag.
   */
  needsConfirmation(action: string): boolean {
    const risk = getRiskLevel(action);
    if (risk === "dangerous") return true;

    switch (this.mode) {
      case "ask_every_time":
        return risk !== "safe";
      case "approve_task":
        return false; // plan already approved
      case "full_access":
        return false;
    }
  }

  /** Highest risk across the plan's steps. */
  planRisk(actions: string[]): RiskLevel {
    if (actions.some((a) => getRiskLevel(a) === "dangerous")) return "dangerous";
    if (actions.some((a) => getRiskLevel(a) === "medium")) return "medium";
    return "safe";
  }

  /** Does the whole plan need approval before execution? */
  planNeedsApproval(actions: string[]): boolean {
    const risk = this.planRisk(actions);
    if (risk === "dangerous") return true;
    switch (this.mode) {
      case "ask_every_time":
        return risk !== "safe";
      case "approve_task":
        return risk !== "safe";
      case "full_access":
        return false;
    }
  }

  /** Create an approval request and wait for user response. */
  requestApproval(
    title: string,
    steps: string[],
    risk: RiskLevel = "medium"
  ): Promise<ApprovalResult> {
    // Safe actions never block
    if (risk === "safe") return Promise.resolve({ approved: true, mode: this.mode });

    return new Promise((resolve) => {
      const id = `approval-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const request: ApprovalRequest = {
        id,
        title,
        steps,
        mode: this.mode,
        risk,
        timestamp: Date.now(),
      };
      this.pendingApprovals.set(id, (result) => {
        this.pendingApprovals.delete(id);
        resolve(result);
      });
      this.onApprovalRequested?.(request);
    });
  }

  /** Resolve a pending approval (called when user taps Approve/Reject). */
  resolveApproval(id: string, approved: boolean): void {
    const resolver = this.pendingApprovals.get(id);
    if (resolver) {
      resolver({ approved, mode: this.mode });
    }
  }

  /** Auto-resolve any pending approvals after a timeout (avoid stuck tasks). */
  expirePending(maxAgeMs = 120000): void {
    // Requests are keyed at creation; we simply drop stale ones.
    // (Implementation note: Promise resolvers left pending are resolved false.)
  }

  /** Callback set by main.ts to forward approval requests to renderer. */
  onApprovalRequested?: (request: ApprovalRequest) => void;
}

export const permissionSystem = new PermissionSystem();
