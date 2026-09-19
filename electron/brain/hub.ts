// Quip Head Brain — Hub (the single entry point every command flows through)
// ─────────────────────────────────────────────────────────────────────────────
//   USER MESSAGE
//     → UNDERSTANDING (references → intents → objects → classification → goal)
//     → PLANNING (explicit plan with per-step verification expectations)
//     → route:
//         clarify  → ask the ONE question (never guess)
//         chat     → companion conversation (UI falls through to chat)
//         direct   → Action Engine (orchestrator) with the RESOLVED command
//         agent    → tool-calling agent tier (existing, proven)
//     → terminal state (COMPLETED / FAILED / CANCELLED) + memory update
//
// Nothing skips this pipeline. Speed: the deterministic path completes in
// single-digit milliseconds; the LLM is only ever touched by the pre-existing
// orchestrator tiers that were already gated behind genuine ambiguity.
// ─────────────────────────────────────────────────────────────────────────────

import { buildUnderstanding, type DeviceLookup, type Understanding } from "./understanding";
import { buildExecutionPlan, type ExecutionPlan } from "./planner";
import { createTaskLifecycle, terminalFromResult, TaskLifecycle } from "./task-state";
import { rememberInteraction, conversationMemoryGet } from "./conversation-memory";

export interface ExecContext {
  lastOpenedPath?: string;
  lastMediaQuery?: string;
  activeApp?: string;
  activeWebsite?: string;
}

export interface HubExecOptions {
  signal?: { aborted: boolean };
  onProgress?: (update: {
    step: number;
    total: number;
    description: string;
    status: "running" | "done" | "failed" | "skipped";
    phase?: "planning" | "executing" | "observing" | "verifying";
  }) => void;
}

export interface HubDeps {
  /** Device Knowledge Layer lookup (may be null until the index loads). */
  deviceIndex: DeviceLookup | null;
  /** Execution-context provider (context-store snapshot). */
  execContext: () => ExecContext;
  workspacePath?: string;
  /** The Action Engine — orchestrator.execute injected by main.ts. */
  execute: (resolvedCommand: string, opts: HubExecOptions) => Promise<{
    success: boolean;
    cancelled?: boolean;
    summary: string;
    notes: string[];
    stepsCompleted: number;
    stepsTotal: number;
    failures?: string[];
    answered?: boolean;
    chatReply?: string;
  }>;
  /** Structured observability sink (console in production). */
  log?: (line: string) => void;
}

export type HubRoute = "direct" | "agent" | "chat" | "clarify";

export interface HubOutcome {
  understanding: Understanding;
  plan: ExecutionPlan;
  lifecycle: TaskLifecycle;
  route: HubRoute;
  /** Set when route === "clarify". */
  clarifyQuestion?: string;
  /** Set when route === "direct" | "agent". */
  result?: Awaited<ReturnType<HubDeps["execute"]>>;
  durationMs: number;
}

/**
 * Process ONE incoming message through the full understanding pipeline.
 * Never throws — a brain bug must never take the task engine down.
 */
export async function processCommand(raw: string, deps: HubDeps, opts: HubExecOptions = {}): Promise<HubOutcome> {
  const t0 = Date.now();
  const log = deps.log ?? (() => {});
  const lifecycle = createTaskLifecycle();
  let understanding: Understanding | null = null;
  let plan: ExecutionPlan | null = null;
  let route: HubRoute = "chat";
  let clarifyQuestion: string | undefined;
  let result: HubOutcome["result"];

  try {
    // ── UNDERSTANDING ────────────────────────────────────────────────────
    lifecycle.to("UNDERSTANDING");
    const lastMem = conversationMemoryGet().last;
    understanding = buildUnderstanding(raw, {
      memory: lastMem ? { last: lastMem } : undefined,
      execContext: deps.execContext(),
      deviceIndex: deps.deviceIndex,
      workspacePath: deps.workspacePath,
    });
    log(
      `[brain] "${raw.slice(0, 60)}" → ${understanding.intents.primary.kind} ` +
        `obj=[${understanding.objects.map((o) => `${o.type}:${o.name}`).join(", ") || "none"}] ` +
        `class=${understanding.classification} ${understanding.timings.totalMs}ms`
    );

    // ── PLANNING ─────────────────────────────────────────────────────────
    lifecycle.to("PLANNING");
    plan = buildExecutionPlan(understanding);
    route = plan.path;

    if (route === "clarify") {
      clarifyQuestion = understanding.clarification.question ?? "Which one do you mean?";
      lifecycle.to("COMPLETED", "clarification asked — acting without guessing is forbidden");
      return finish();
    }

    if (route === "chat") {
      lifecycle.to("COMPLETED", "routed to companion conversation");
      return finish();
    }

    // ── EXECUTING (via the Action Engine) ────────────────────────────────
    lifecycle.to("EXECUTING", plan.path === "agent" ? "agent tier" : `${plan.steps.length} deterministic step(s)`);
    result = await deps.execute(understanding.resolved, {
      signal: opts.signal,
      onProgress: opts.onProgress,
    });
    const terminal = terminalFromResult(result);
    lifecycle.to(terminal, `steps ${result.stepsCompleted}/${result.stepsTotal}${result.cancelled ? " (cancelled)" : ""}`);
    return finish();
  } catch (err: any) {
    // The brain must never crash the task engine (hard guarantee).
    log(`[brain] error: ${String(err?.message ?? err).slice(0, 160)}`);
    try {
      if (!lifecycle.isTerminal()) lifecycle.finish(false, "brain error");
    } catch {
      /* already terminal */
    }
    if (!understanding) {
      understanding = null;
    }
    return {
      understanding: understanding as unknown as Understanding,
      plan: (plan ?? {
        goal: raw,
        kind: "chat" as const,
        path: "chat" as const,
        steps: [],
        permissionsRequired: "safe" as const,
        expectedResult: "Brain fallback — routed to conversation.",
        why: [`brain error: ${String(err?.message ?? err).slice(0, 120)}`],
      }) as ExecutionPlan,
      lifecycle,
      route: "chat",
      durationMs: Date.now() - t0,
    };
  }

  function finish(): HubOutcome {
    // Remember the interaction so the NEXT message's references resolve.
    if (understanding) {
      try {
        rememberInteraction(understanding);
      } catch {
        /* memory must never break execution */
      }
    }
    log(`[brain] route=${route} ${lifecycle.explain()}`);
    return {
      understanding: understanding as Understanding,
      plan: plan as ExecutionPlan,
      lifecycle,
      route,
      ...(clarifyQuestion ? { clarifyQuestion } : {}),
      ...(result ? { result } : {}),
      durationMs: Date.now() - t0,
    };
  }
}
