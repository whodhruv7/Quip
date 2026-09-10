// Quip Execution Engine V3 — Agent Loop
// ─────────────────────────────────────────────────────────────────────────────
// The agentic tier between the deterministic fast path and plain chat.
//
//   user goal
//     → model sees the FULL real-tool catalog (function calling)
//     → picks a tool → Quip executes it for real → verified result fed back
//     → model picks the next tool (or answers)
//     → honest final summary: what was done, what failed, why
//
// Skales parity: this is Quip's port of Skales' orchestrator/agent-tasks
// pattern — but every tool acts on the REAL desktop (apps, files, mouse,
// keyboard, clipboard, real browser) and every result is verified state.
//
// Speed discipline: the deterministic parser handles simple commands with
// ZERO model calls; this loop only runs when the parser couldn't build a
// confident plan. Cancellation is honored between every tool call.
// ─────────────────────────────────────────────────────────────────────────────

import type { ChatPart, ModelRouter, ToolSchema, ToolCall } from "../system/model-router";
import { toolSchemas, progressFor } from "./tool-catalog";
import { executeTool, type ToolResult, type ToolContext } from "./tool-registry";
import { permissionSystem, riskForStep, type RiskLevel } from "./permission-modes";
import { contextStore } from "./context-store";

/** Brain surface — ModelRouter satisfies this; tests inject a mock. */
export interface AgentBrain {
  completeWithTools(
    systemPrompt: string,
    history: ChatPart[],
    tools: ToolSchema[],
    timeoutMs?: number,
    maxTokens?: number
  ): Promise<{ content: string; toolCalls: ToolCall[] }>;
}

export interface AgentProgress {
  step: number;
  description: string;
  status: "running" | "done" | "failed";
  phase: "planning" | "executing" | "observing";
}

export interface AgentLoopOptions {
  goal: string;
  platform: string;
  brain: AgentBrain;
  /** Injectable executor — production uses executeTool; tests inject mocks. */
  executor?: (action: string, step: any, ctx: ToolContext) => Promise<ToolResult>;
  onProgress?: (update: AgentProgress) => void;
  signal?: { aborted: boolean };
  maxTurns?: number;
  budgetMs?: number;
  /** Extra context lines (recent conversation excerpt, if any). */
  historyHint?: string;
}

export interface AgentLoopResult {
  /** A tool ran and every required action succeeded. */
  success: boolean;
  summary: string;
  notes: string[];
  /** Plain-language failure reasons — one per failed step (spec #35). */
  failures: string[];
  toolsUsed: string[];
  turnsUsed: number;
  durationMs: number;
  cancelled?: boolean;
  /** True when the model answered WITHOUT any tool — treat as plain chat. */
  isChat: boolean;
  chatReply?: string;
}

/** Tools that READ state — honestly shown as OBSERVING, never WORKING. */
const OBSERVING_TOOLS = new Set([
  "screen_observe", "windows_list", "read_page", "site_search", "search_web",
  "search_youtube", "youtube_read", "rss_read", "process_list", "app_list",
  "self_check",
]);

function phaseFor(toolName: string): "observing" | "executing" {
  return OBSERVING_TOOLS.has(toolName) ? "observing" : "executing";
}

const SYSTEM_PROMPT = `You are Quip, a desktop companion that ACTUALLY controls the user's laptop. You have real tools — use them.

RULES:
1. When the user asks for anything actionable, CALL TOOLS. Never reply with just words when an action is possible.
2. Multi-step goals: chain tool calls across turns. Look (screen_observe / windows_list) before clicking blind.
3. To click something visible on screen, use screen_click_element with a clear description — Quip will look at a real screenshot, find it, and click it.
4. Be economical: pick the most direct tool. Don't re-open what's already open.
5. NEVER claim success — the tool results tell you what really happened. If a tool failed, read its note, adapt or try a different tool once, then report honestly what failed and the basic reason.
6. When the goal is finished, reply with ONE short friendly sentence summarizing what was done (and what couldn't be done, plainly).
7. If the message is just conversation (no action needed), reply normally with no tool calls.
8. Coordinates on this laptop are real screen pixels — never guess them; use screen tools to find elements.
9. Commands, deleting/moving files, sending messages ALWAYS need approval — that's fine, call the tool; the user will see the approval card.`;

function buildStepArgs(parsed: Record<string, any>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed ?? {})) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
  }
  return out;
}

function truncate(text: string, max = 1200): string {
  if (!text) return "";
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function toolResultPayload(r: ToolResult): string {
  return JSON.stringify({ success: r.success, output: truncate(r.output), note: truncate(r.note, 400) });
}

export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const t0 = Date.now();
  const maxTurns = opts.maxTurns ?? 8;
  const budgetMs = opts.budgetMs ?? 150_000;
  const ctx: ToolContext = { platform: opts.platform };
  const exec = opts.executor ?? executeTool;

  const notes: string[] = [];
  const failures: string[] = [];
  const toolsUsed: string[] = [];
  let stepsOk = 0;
  let stepsFailed = 0;
  let cancelled = false;

  const messages: ChatPart[] = [{ role: "user", content: opts.goal }];
  const contextSummary = contextStore.summary();
  const systemPrompt =
    SYSTEM_PROMPT +
    (contextSummary ? `\nCurrent context: ${contextSummary}` : "") +
    (opts.historyHint ? `\nRecent conversation (may clarify the goal): ${truncate(opts.historyHint, 500)}` : "");

  for (let turn = 1; turn <= maxTurns; turn++) {
    if (opts.signal?.aborted) {
      cancelled = true;
      break;
    }
    if (Date.now() - t0 > budgetMs) {
      notes.push("Ran out of time — stopped early.");
      break;
    }

    opts.onProgress?.({ step: turn, description: "Thinking…", status: "running", phase: "planning" });

    let answer: { content: string; toolCalls: ToolCall[] };
    try {
      answer = await opts.brain.completeWithTools(systemPrompt, messages, toolSchemas(), 45_000, 2048);
    } catch (err: any) {
      // Provider failure. If real work already happened, report it honestly;
      // otherwise surface the error so the caller can map it for the user.
      if (toolsUsed.length > 0) {
        notes.push(`The AI connection dropped mid-task: ${String(err?.message ?? err)}`);
        failures.push(`The AI connection dropped mid-task: ${String(err?.message ?? err)}`);
        break;
      }
      throw err;
    }

    // ── No tool calls → the model is done (or this was pure chat) ────────
    if (answer.toolCalls.length === 0) {
      const reply = (answer.content ?? "").trim();
      if (toolsUsed.length === 0) {
        // Pure chat — no tools were ever needed.
        return {
          success: true,
          summary: reply,
          notes: [],
          failures: [],
          toolsUsed: [],
          turnsUsed: turn,
          durationMs: Date.now() - t0,
          isChat: true,
          chatReply: reply,
        };
      }
      notes.push(reply);
      break;
    }

    // ── Execute the requested tools (assistant message + results appended) ─
    messages.push({
      role: "assistant",
      content: answer.content ?? "",
      tool_calls: answer.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    for (const call of answer.toolCalls.slice(0, 3)) {
      if (opts.signal?.aborted) {
        cancelled = true;
        break;
      }

      const args = buildStepArgs(call.parsed);
      const label = progressFor(call.name);
      opts.onProgress?.({ step: turn, description: label, status: "running", phase: phaseFor(call.name) });
      // Count the ATTEMPT up front — a declined or crashed call is still real
      // work the model asked for and must never be misreported as "chat".
      toolsUsed.push(call.name);

      // ── Risk gate: dangerous ALWAYS approves; medium only nags in
      //    ask_every_time mode — same contract as the deterministic path. ──
      const risk: RiskLevel = riskForStep(call.name, args);
      const needsApproval =
        risk === "dangerous" ||
        (permissionSystem.getMode() === "ask_every_time" && risk !== "safe");
      if (needsApproval) {
        const approval = await permissionSystem.requestApproval(
          `Allow: ${label}`,
          [`${call.name} ${truncate(JSON.stringify(args), 160)}`],
          risk
        );
        if (!approval.approved) {
          const declined: ToolResult = {
            success: false,
            output: "You declined this action.",
            note: "user declined",
          };
          notes.push(`${label} — declined by you`);
          messages.push({ role: "tool", tool_call_id: call.id, content: toolResultPayload(declined) });
          stepsFailed++;
          failures.push(`${label} — you declined it, so nothing was changed`);
          continue;
        }
      }

      const step = {
        action: call.name,
        target: String(args.target ?? args.query ?? args.command ?? ""),
        params: args,
        description: label,
      };

      let result: ToolResult;
      try {
        result = await exec(call.name, step as any, ctx);
      } catch (err: any) {
        result = {
          success: false,
          output: "That action crashed.",
          note: `executor error: ${String(err?.message ?? err)}`,
        };
      }

      if (result.success) {
        stepsOk++;
        opts.onProgress?.({ step: turn, description: label, status: "done", phase: phaseFor(call.name) });
      } else {
        stepsFailed++;
        failures.push(`${label} — ${result.output || result.note || "it didn't work"}`);
        opts.onProgress?.({ step: turn, description: label, status: "failed", phase: phaseFor(call.name) });
      }
      notes.push(result.note || result.output);

      messages.push({ role: "tool", tool_call_id: call.id, content: toolResultPayload(result) });
    }
    if (cancelled) break;
  }

  // ── Honest wrap-up ───────────────────────────────────────────────────────
  const didSomething = toolsUsed.length > 0;
  const summary = didSomething
    ? stepsFailed === 0
      ? `Done — ${stepsOk} step${stepsOk === 1 ? "" : "s"} completed.`
      : stepsOk === 0
        ? `I couldn't complete that. ${failures[0] ?? ""}`.trim()
        : `Completed ${stepsOk} of ${stepsOk + stepsFailed} steps. ${failures.slice(0, 2).join(" ")}`.trim()
    : "";

  return {
    success: didSomething && stepsFailed === 0,
    summary,
    notes,
    failures,
    toolsUsed,
    turnsUsed: maxTurns,
    durationMs: Date.now() - t0,
    cancelled: cancelled || undefined,
    isChat: !didSomething,
  };
}

/** The real router, bound once by main.ts (type-only import keeps this
 *  module testable — tests inject their own AgentBrain). */
let boundRouter: ModelRouter | null = null;

/** Called by main.ts at boot: bind the real singleton router. */
export function bindAgentBrain(router: ModelRouter): void {
  boundRouter = router;
}

/** Default brain — uses the bound router; throws honestly when unbound. */
export const agentBrain: AgentBrain = {
  async completeWithTools(system, history, tools, timeoutMs, maxTokens) {
    if (!boundRouter) {
      throw new Error("The AI brain isn't wired up yet.");
    }
    return boundRouter.completeWithTools(system, history, tools, timeoutMs, maxTokens);
  },
};
