// Quip Action Engine — the ONLY executor of Head-Brain plans (spec Phase 2)
// ─────────────────────────────────────────────────────────────────────────────
//   Head Brain (understanding)  →  PLAN (steps + verify expectations)
//        →  Permission Manager (mode-aware; identical execution logic in all
//           three modes — only the approval flow differs)
//        →  Action Engine (validate → execute → timeout → recover)
//        →  Device layer (tool-registry executors — the only code that
//           touches the OS)
//
// Guarantees:
//   §2   zero random execution — a step without a contract is refused
//   §14  attempted ≠ successful — a step is done only when its executor's
//        own verification says so
//   §15/16 recovery — classified failures get ONE bounded retry/re-observe
//   §17  cancellation is honored between steps
//   §19  every action carries a safety class (READ/WRITE/DESTRUCTIVE/EXTERNAL)
//   §20  the execution layer validates plan output — models may be wrong,
//        this layer may not
//   §42  never fake success — summary is composed ONLY from verified steps
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolContext, ToolResult } from "../engine/tool-registry";
import { executeTool } from "../engine/tool-registry";
import type { TaskStep } from "../engine/intent-parser-v2";
import {
  permissionSystem,
  riskForStep,
  type PermissionMode,
  type RiskLevel,
} from "../engine/permission-modes";
import type { ExecutionPlan, PlanStep } from "../brain/planner";
import { contractFor, safetyClass, validateStep } from "./contracts";
import { executionLog } from "./execution-log";
import { classifyFailure, decideRecovery, failureLine, type FailureKind } from "./recovery";

export type EnginePhase =
  | "planning"
  | "executing"
  | "observing"
  | "verifying"
  | "waiting_permission"
  | "recovering";

export interface EngineProgress {
  step: number;
  total: number;
  description: string;
  status: "running" | "done" | "failed" | "skipped";
  phase: EnginePhase;
}

export interface ActionEngineResult {
  success: boolean;
  summary: string;
  notes: string[];
  stepsCompleted: number;
  stepsTotal: number;
  durationMs: number;
  failures?: string[];
  cancelled?: boolean;
  /** Step outcomes in order — one entry per plan step. */
  stepVerdicts: { action: string; ok: boolean; note: string }[];
}

export interface ActionEngineDeps {
  ctx: ToolContext;
  mode: () => PermissionMode;
  /** Plan-level approval (approve_task / full_access dangerous). */
  requestPlanApproval: (
    title: string,
    steps: string[],
    risk: RiskLevel
  ) => Promise<{ approved: boolean }>;
  /** Per-step approval (ask_every_time mode). */
  requestStepApproval: (
    stepDesc: string,
    risk: RiskLevel
  ) => Promise<{ approved: boolean }>;
  log?: (line: string) => void;
}

export interface ActionEngineOptions {
  taskId: string;
  signal?: { aborted: boolean };
  onProgress?: (update: EngineProgress) => void;
}

/** Actions that READ the world — the honest observing phase. */
const OBSERVING_ACTIONS = new Set([
  "screen",
  "screen_observe",
  "windows_list",
  "process_list",
  "read_page",
  "site_search",
  "search_web",
  "search_youtube",
  "app_list",
  "sys_info",
  "network_info",
  "self_check",
  "pdf_read",
  "docx_read",
]);

const MAX_ATTEMPTS = 2;

export class ActionEngine {
  constructor(private deps: ActionEngineDeps) {}

  /**
   * Execute a Head-Brain plan. Never throws — every failure becomes an
   * honest result. `success` is true only when EVERY step verified.
   */
  async executePlan(plan: ExecutionPlan, opts: ActionEngineOptions): Promise<ActionEngineResult> {
    const t0 = Date.now();
    const log = this.deps.log ?? (() => {});
    const steps = plan.steps;
    const mode = this.deps.mode();
    const failures: string[] = [];
    const notes: string[] = [];
    const verdicts: ActionEngineResult["stepVerdicts"] = [];
    let completed = 0;
    let cancelled = false;

    const emit = (u: EngineProgress) => opts.onProgress?.(u);

    log(`[action-engine] task=${opts.taskId} plan="${plan.goal}" steps=${steps.length} mode=${mode}`);

    // ── Permission gate ──────────────────────────────────────────────────
    // ask_every_time: confirm each medium/dangerous step individually.
    // approve_task / full_access: one plan-level approval when needed.
    // Dangerous steps are confirmed in EVERY mode.
    const declined = new Set<number>();
    if (mode === "ask_every_time") {
      for (let r = 0; r < steps.length; r++) {
        const s = steps[r];
        if (this.riskOf(s) === "safe") continue;
        emit({
          step: r + 1,
          total: steps.length,
          description: `Asking permission: ${s.description}`,
          status: "running",
          phase: "waiting_permission",
        });
        const verdict = await this.deps.requestStepApproval(s.description, this.riskOf(s));
        if (!verdict.approved) {
          declined.add(r);
          executionLog.record({
            taskId: opts.taskId,
            stepIndex: r,
            action: s.action,
            target: s.target,
            safety: safetyClass(s.action, s.params),
            risk: this.riskOf(s),
            mode,
            attempt: 1,
            durationMs: 0,
            ok: false,
            summary: "not approved — the step was not run",
            evidence: [],
            failureKind: "permission",
            params: s.params,
          });
          failures.push(failureLine(s.description, "permission", "You didn't approve this step, so I didn't run it."));
          verdicts.push({ action: s.action, ok: false, note: "not approved" });
        }
      }
      if (declined.size === steps.length && steps.length > 0) {
        // Every step was declined — nothing to do at all.
        return this.finish(opts, t0, {
          success: false,
          summary: "I didn't run anything — none of the steps were approved.",
          notes,
          stepsCompleted: 0,
          stepsTotal: steps.length,
          failures,
          stepVerdicts: verdicts,
        });
      }
    } else if (steps.length > 0 && permissionSystem.stepsNeedApproval(steps)) {
      emit({
        step: 0,
        total: steps.length,
        description: "Waiting for your approval…",
        status: "running",
        phase: "waiting_permission",
      });
      const verdict = await this.deps.requestPlanApproval(
        plan.goal,
        steps.map((s) => s.description),
        permissionSystem.stepsRisk(steps)
      );
      if (!verdict.approved) {
        executionLog.record({
          taskId: opts.taskId,
          stepIndex: -1,
          action: "plan",
          target: plan.goal,
          safety: permissionSystem.stepsRisk(steps),
          risk: permissionSystem.stepsRisk(steps),
          mode,
          attempt: 1,
          durationMs: 0,
          ok: false,
          summary: "plan not approved — nothing was run",
          evidence: [],
          failureKind: "permission",
        });
        return this.finish(opts, t0, {
          success: false,
          summary: "I didn't run anything — the plan wasn't approved.",
          notes: ["Nothing was executed. Approve the plan and I'll run it exactly as shown."],
          stepsCompleted: 0,
          stepsTotal: steps.length,
          failures: ["The plan was not approved, so no step ran."],
          stepVerdicts: [],
        });
      }
    }

    // ── Execute steps ────────────────────────────────────────────────────
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      // A step declined during the ask_every_time gate is DONE (as declined)
      // — running it here would execute what the user explicitly refused.
      if (declined.has(i)) {
        emit({ step: i + 1, total: steps.length, description: step.description, status: "skipped", phase: "executing" });
        continue;
      }
      if (opts.signal?.aborted) {
        cancelled = true;
        for (let j = i; j < steps.length; j++) {
          verdicts.push({ action: steps[j].action, ok: false, note: "not run — task stopped" });
        }
        break;
      }

      // §20 validate BEFORE running — the execution layer is authoritative.
      const issues = validateStep(step);
      if (issues.length > 0) {
        const problem = issues.map((x) => `${x.slot}: ${x.problem}`).join(", ");
        executionLog.record({
          taskId: opts.taskId,
          stepIndex: i,
          action: step.action,
          target: step.target,
          safety: safetyClass(step.action, step.params),
          risk: this.riskOf(step),
          mode,
          attempt: 1,
          durationMs: 0,
          ok: false,
          summary: `refused — malformed step (${problem})`,
          evidence: [],
          failureKind: "fatal",
          params: step.params,
        });
        failures.push(
          `Step ${i + 1} (${step.description}): I couldn't run it safely — the instruction was incomplete (${problem}).`
        );
        verdicts.push({ action: step.action, ok: false, note: `refused: ${problem}` });
        emit({ step: i + 1, total: steps.length, description: step.description, status: "failed", phase: "executing" });
        continue;
      }

      const verdict = await this.runWithRecovery(step, {
        taskId: opts.taskId,
        stepIndex: i,
        total: steps.length,
        mode,
        signal: opts.signal,
        emit,
      });
      verdicts.push({ action: step.action, ok: verdict.ok, note: verdict.note });
      if (verdict.ok) {
        completed++;
        notes.push(step.description);
        emit({ step: i + 1, total: steps.length, description: step.description, status: "done", phase: "verifying" });
      } else {
        failures.push(verdict.failureLine);
        emit({ step: i + 1, total: steps.length, description: step.description, status: "failed", phase: "executing" });
      }
      if (verdict.cancelled) cancelled = true;
      if (verdict.cancelled) break;
    }

    const success = !cancelled && failures.length === 0 && completed === steps.length && steps.length > 0;
    const summary = this.composeSummary(plan, steps, completed, verdicts, failures, cancelled);

    return this.finish(opts, t0, {
      success,
      summary,
      notes,
      stepsCompleted: completed,
      stepsTotal: steps.length,
      ...(failures.length ? { failures } : {}),
      ...(cancelled ? { cancelled: true } : {}),
      stepVerdicts: verdicts,
    });
  }

  // ── One step with bounded recovery (§15/16) ────────────────────────────

  private async runWithRecovery(
    step: PlanStep,
    env: {
      taskId: string;
      stepIndex: number;
      total: number;
      mode: PermissionMode;
      signal?: { aborted: boolean };
      emit: (u: EngineProgress) => void;
    }
  ): Promise<{ ok: boolean; note: string; failureLine: string; cancelled: boolean }> {
    const contract = contractFor(step.action);
    const timeoutMs = step.timeoutMs || contract?.timeoutMs || 10_000;
    let attempt = 0;
    let last: { result: ToolResult; timedOut: boolean } | null = null;

    while (attempt < MAX_ATTEMPTS) {
      attempt++;
      if (env.signal?.aborted) {
        return { ok: false, note: "stopped", failureLine: `${step.description}: stopped before it ran.`, cancelled: true };
      }

      const phase = OBSERVING_ACTIONS.has(step.action) ? "observing" : "executing";
      env.emit({
        step: env.stepIndex + 1,
        total: env.total,
        description: `${step.description}${attempt > 1 ? " (try " + attempt + ")" : ""}`,
        status: "running",
        phase,
      });

      const t0 = Date.now();
      const { result, timedOut } = await this.runStepWithTimeout(step, timeoutMs);
      const durationMs = Date.now() - t0;

      if (result.success) {
        executionLog.record({
          taskId: env.taskId,
          stepIndex: env.stepIndex,
          action: step.action,
          target: step.target,
          safety: safetyClass(step.action, step.params),
          risk: this.riskOf(step),
          mode: env.mode,
          attempt,
          durationMs,
          ok: true,
          summary: result.output.slice(0, 300),
          evidence: result.evidence ?? [],
          params: step.params,
        });
        return { ok: true, note: result.note || result.output, failureLine: "", cancelled: false };
      }

      last = { result, timedOut };
      const kind = classifyFailure({
        note: result.note ?? "",
        timedOut,
        cancelled: false,
      });

      executionLog.record({
        taskId: env.taskId,
        stepIndex: env.stepIndex,
        action: step.action,
        target: step.target,
        safety: safetyClass(step.action, step.params),
        risk: this.riskOf(step),
        mode: env.mode,
        attempt,
        durationMs,
        ok: false,
        summary: (result.note || result.output || "failed").slice(0, 300),
        evidence: result.evidence ?? [],
        failureKind: kind,
        params: step.params,
      });

      const decision = decideRecovery({ kind, attempt, retryable: step.retryable });
      if (decision.strategy === "give-up") {
        return {
          ok: false,
          note: result.note,
          failureLine: failureLine(step.description, kind, decision.reason),
          cancelled: false,
        };
      }

      // retry | reobserve — bounded (attempt < MAX_ATTEMPTS loop guard)
      env.emit({
        step: env.stepIndex + 1,
        total: env.total,
        description: `${step.description} — ${decision.reason}`,
        status: "running",
        phase: "recovering",
      });
      await new Promise((r) => setTimeout(r, decision.backoffMs));
    }

    const kind = last
      ? classifyFailure({ note: last.result.note ?? "", timedOut: last.timedOut, cancelled: false })
      : "fatal";
    return {
      ok: false,
      note: last?.result.note ?? "failed",
      failureLine: failureLine(step.description, kind, "It didn't succeed after a retry, so I stopped."),
      cancelled: false,
    };
  }

  /**
   * Timeout-wrapped execution — a hung device call becomes an honest timeout.
   * Note: a timed-out executor may STILL finish in the background (we do not
   * kill device calls mid-flight — interrupting a half-typed action is worse
   * than letting it land). The report says "stopped waiting", which is exactly
   * what happened; a retry of an idempotent action re-verifies from scratch.
   */
  private async runStepWithTimeout(
    step: PlanStep,
    timeoutMs: number
  ): Promise<{ result: ToolResult; timedOut: boolean }> {
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<ToolResult>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        resolve({
          success: false,
          output: `The step took too long (over ${Math.round(timeoutMs / 1000)}s) — I stopped waiting.`,
          note: "step timed out",
          evidence: [`timeout: ${timeoutMs}ms`],
        });
      }, timeoutMs);
    });
    try {
      const result = await Promise.race([
        executeTool(step.action, step as unknown as TaskStep, this.deps.ctx),
        timeoutPromise,
      ]);
      return { result, timedOut };
    } catch (err: any) {
      return {
        result: {
          success: false,
          output: "Something went wrong running that step.",
          note: `executor threw: ${String(err?.message ?? err).slice(0, 200)}`,
        },
        timedOut: false,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private riskOf(step: PlanStep): RiskLevel {
    return riskForStep(step.action, step.params);
  }

  /** §42 — the summary only claims what actually verified. */
  private composeSummary(
    plan: ExecutionPlan,
    steps: PlanStep[],
    completed: number,
    verdicts: ActionEngineResult["stepVerdicts"],
    failures: string[],
    cancelled: boolean
  ): string {
    if (cancelled) {
      return `Stopped — ${completed} of ${steps.length} step${steps.length === 1 ? "" : "s"} completed.`;
    }
    if (failures.length === 0 && completed === steps.length && steps.length > 0) {
      const firstOk = verdicts.find((v) => v.ok);
      return steps.length === 1
        ? firstOk?.note?.slice(0, 300) || plan.expectedResult
        : `Done — all ${steps.length} steps verified. ${plan.expectedResult}`.slice(0, 400);
    }
    if (completed === 0) {
      return "I couldn't complete any step of that.";
    }
    return `Completed ${completed} of ${steps.length} steps — ${failures.length} step${failures.length === 1 ? "" : "s"} failed.`;
  }

  private finish(
    opts: ActionEngineOptions,
    t0: number,
    result: Omit<ActionEngineResult, "durationMs">
  ): ActionEngineResult {
    return { ...result, durationMs: Date.now() - t0 };
  }
}

// ─── Production wiring (real permission system) ─────────────────────────────

export function createActionEngine(ctx: ToolContext, log?: (line: string) => void): ActionEngine {
  return new ActionEngine({
    ctx,
    mode: () => permissionSystem.getMode(),
    requestPlanApproval: (title, steps, risk) => permissionSystem.requestApproval(title, steps, risk),
    requestStepApproval: (desc, risk) => permissionSystem.requestApproval(desc, [desc], risk),
    log,
  });
}
