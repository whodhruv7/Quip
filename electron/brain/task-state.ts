// Quip Head Brain — Task Lifecycle State Machine (spec §22)
// ─────────────────────────────────────────────────────────────────────────────
// No scattered booleans (isLoading/isRunning/isDone…). One deterministic
// lifecycle with FORBIDDEN transitions enforced — an invalid jump throws
// rather than silently corrupting the task state.
//
//   IDLE → UNDERSTANDING → PLANNING → WAITING_FOR_PERMISSION → EXECUTING
//                                  ⇅                            ⇅
//                    (chat/clarify short-circuit)    OBSERVING / VERIFYING
//                                                                 ⇅
//                    COMPLETED | FAILED | CANCELLED ← RECOVERING
//
// Every transition is recorded in a trace (spec §27 observability): the
// per-task story is dumpable for debugging without leaking secrets.
// ─────────────────────────────────────────────────────────────────────────────

export type TaskState =
  | "IDLE"
  | "UNDERSTANDING"
  | "PLANNING"
  | "WAITING_FOR_PERMISSION"
  | "EXECUTING"
  | "OBSERVING"
  | "VERIFYING"
  | "RECOVERING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

const TERMINAL: ReadonlySet<TaskState> = new Set<TaskState>(["COMPLETED", "FAILED", "CANCELLED"]);

/** Deterministic transition table — anything not listed is forbidden. */
const TRANSITIONS: Record<TaskState, TaskState[]> = {
  IDLE: ["UNDERSTANDING"],
  UNDERSTANDING: ["PLANNING", "COMPLETED", "FAILED", "CANCELLED"],
  PLANNING: ["WAITING_FOR_PERMISSION", "EXECUTING", "COMPLETED", "FAILED", "CANCELLED"],
  WAITING_FOR_PERMISSION: ["EXECUTING", "CANCELLED", "FAILED"],
  EXECUTING: ["OBSERVING", "VERIFYING", "RECOVERING", "COMPLETED", "FAILED", "CANCELLED"],
  OBSERVING: ["EXECUTING", "VERIFYING", "FAILED", "CANCELLED"],
  VERIFYING: ["COMPLETED", "RECOVERING", "FAILED", "CANCELLED"],
  RECOVERING: ["EXECUTING", "COMPLETED", "FAILED", "CANCELLED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export interface TraceEntry {
  state: TaskState;
  at: number;
  note?: string;
}

export class InvalidTransitionError extends Error {
  constructor(public readonly from: TaskState, public readonly to: TaskState) {
    super(`Illegal task transition: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export class TaskLifecycle {
  private current: TaskState = "IDLE";
  private readonly startedAt = Date.now();
  private readonly traceLog: TraceEntry[] = [{ state: "IDLE", at: this.startedAt, note: "task created" }];

  get state(): TaskState {
    return this.current;
  }

  get trace(): TraceEntry[] {
    return [...this.traceLog];
  }

  get elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  can(to: TaskState): boolean {
    return TRANSITIONS[this.current].includes(to);
  }

  /** Move the task to a new state. Throws on illegal transitions. */
  to(to: TaskState, note?: string): TaskState {
    if (!this.can(to)) throw new InvalidTransitionError(this.current, to);
    this.current = to;
    this.traceLog.push({ state: to, at: Date.now(), ...(note ? { note } : {}) });
    return this.current;
  }

  /** Cancel from any non-terminal state (spec §17). */
  cancel(note?: string): TaskState {
    if (TERMINAL.has(this.current)) return this.current;
    return this.to("CANCELLED", note ?? "cancelled by the user");
  }

  finish(ok: boolean, note?: string): TaskState {
    if (TERMINAL.has(this.current)) return this.current;
    return this.to(ok ? "COMPLETED" : "FAILED", note);
  }

  isTerminal(): boolean {
    return TERMINAL.has(this.current);
  }

  /** Structured, privacy-conscious trace dump (spec §27). */
  explain(): string {
    return this.traceLog
      .map((t) => `${t.state}${t.note ? ` (${t.note})` : ""} @+${t.at - this.startedAt}ms`)
      .join(" → ");
  }
}

export function createTaskLifecycle(): TaskLifecycle {
  return new TaskLifecycle();
}

/** Map an orchestrator ExecutionResult to the honest terminal state. */
export function terminalFromResult(result: { success: boolean; cancelled?: boolean }): TaskState {
  if (result.cancelled) return "CANCELLED";
  return result.success ? "COMPLETED" : "FAILED";
}
