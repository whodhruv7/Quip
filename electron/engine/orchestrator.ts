// Quip Execution Engine V2 — Orchestrator
// ─────────────────────────────────────────────────────────────────────────────
// Central execution orchestrator.
//
// Pipeline:
//   User Input
//     → Intent Parser V2 (deterministic, context-aware)
//     → [low confidence] → Model Assist (compact schema, ONE small call)
//     → Risk-gated permission check (inline approval panel in UI)
//     → Task Execution (tool registry, verified)
//     → Context Store update (so "play it" works next time)
//     → Report (verified summary + trust notes)
//
// Token discipline:
//   - Deterministic fast path skips the model entirely for obvious commands.
//   - Model assist sends ONLY the message + 3-line context + compact schema.
//   - App index cached 24h; no repeated environment scans per message.
// ─────────────────────────────────────────────────────────────────────────────

import { parseIntentV2, type ParsedIntent, type TaskStep } from "./intent-parser-v2";
import { permissionSystem, riskForStep, type ApprovalRequest, type RiskLevel } from "./permission-modes";
import { executeTool, type ToolResult, type ToolContext } from "./tool-registry";
import { contextStore } from "./context-store";
import type { ModelRouter } from "../system/model-router";

export interface ExecutionResult {
  success: boolean;
  summary: string;
  notes: string[];
  stepsCompleted: number;
  stepsTotal: number;
  durationMs: number;
}

export interface ProgressUpdate {
  step: number;
  total: number;
  description: string;
  status: "running" | "done" | "failed" | "skipped";
}

interface ExecuteOptions {
  platform: string;
  workspacePath?: string;
  onProgress?: (update: ProgressUpdate) => void;
  onApprovalRequest?: (request: ApprovalRequest) => void;
  /** Optional model router for low-confidence intent resolution (injected to keep this module testable). */
  modelAssist?: {
    complete(systemPrompt: string, history: { role: "user" | "assistant"; content: string }[], timeoutMs?: number): Promise<string>;
  };
}

const ASSIST_SCHEMA = `Reply with ONLY compact JSON, no prose:
{"action":"open|play|search|navigate|type|click|scroll|close|focus|clipboard|read|chat","target":"short target name","query":"search/song/file text or empty","url":"https URL if navigating, else empty"}
Rules: "open VS Code" → open,target:"vs code". "open YouTube and play X" → play,target:"youtube",query:"X". Open installed desktop apps as apps, websites as websites.`;

class Orchestrator {
  private modelRouterRef: ModelRouter | null = null;

  /** Injected once by main.ts (keeps module importable in tests). */
  setModelRouter(router: ModelRouter): void {
    this.modelRouterRef = router;
  }

  /**
   * Model-assisted intent resolution for ambiguous messages.
   * Sends ONLY the message + compact context — never the whole chat history.
   */
  private async resolveWithModel(
    command: string,
    contextSummary: string
  ): Promise<Partial<ParsedIntent> | null> {
    const router = this.modelRouterRef ?? this.externalModelAssist;
    if (!router) return null;
    try {
      const systemPrompt = `You convert one user message into an action plan for a desktop assistant. ${ASSIST_SCHEMA}${contextSummary ? `\n${contextSummary}` : ""}`;
      const raw = await router.complete(systemPrompt, [{ role: "user", content: command }], 12000);
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed?.action || typeof parsed.action !== "string") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private externalModelAssist: {
    complete(systemPrompt: string, history: { role: "user" | "assistant"; content: string }[], timeoutMs?: number): Promise<string>;
  } | null = null;

  setExternalModelAssist(assist: NonNullable<Orchestrator["externalModelAssist"]>): void {
    this.externalModelAssist = assist;
  }

  /** Main entry point. Takes user input, returns execution result. */
  async execute(
    command: string,
    opts: ExecuteOptions
  ): Promise<ExecutionResult> {
    const t0 = Date.now();
    const ctx: ToolContext = { platform: opts.platform };

    // ─── Step 1: Deterministic parse (context-aware) ───────────────────────
    let intent = parseIntentV2(command, {
      context: contextStore.get(),
      workspacePath: opts.workspacePath,
    });

    // ─── Step 1b: Model assist for ambiguous non-tasks ─────────────────────
    let modelCall = false;
    const contextSummary = contextStore.summary();
    if (!intent.isTask && intent.confidence < 0.5 && command.trim().length > 3) {
      const heuristic = this.looksLikeTask(command);
      if (heuristic) {
        const assist = await this.resolveWithModel(command, contextSummary);
        modelCall = true;
        if (assist && assist.action !== "chat") {
          intent = this.buildIntentFromAssist(command, intent.normalized, assist);
        }
      }
    }

    // Token/perf telemetry (counts only — never secrets)
    console.log(
      `intent=${modelCall ? "model-assisted" : "deterministic"} modelCall=${modelCall} ` +
      `contextChars=${contextSummary.length} toolCount=${intent.steps.length}`
    );

    // Not a task → pure chat
    if (!intent.isTask || intent.steps.length === 0) {
      return {
        success: true,
        summary: "",
        notes: [],
        stepsCompleted: 0,
        stepsTotal: 0,
        durationMs: Date.now() - t0,
      };
    }

    // ─── Step 2: Risk-gated permission check ───────────────────────────────
    const planRisk: RiskLevel = permissionSystem.stepsRisk(intent.steps);

    if (permissionSystem.stepsNeedApproval(intent.steps)) {
      const stepDescriptions = intent.steps.map((s, i) => `${i + 1}. ${s.description}`);
      const approved = await permissionSystem.requestApproval(
        intent.summary || "Execute task",
        stepDescriptions,
        planRisk
      );
      if (!approved) {
        return {
          success: false,
          summary: "Cancelled — you declined the task.",
          notes: ["You declined this task"],
          stepsCompleted: 0,
          stepsTotal: intent.steps.length,
          durationMs: Date.now() - t0,
        };
      }
    }

    // ─── Step 3: Execute steps with verification + context updates ────────
    const notes: string[] = [];
    let stepsCompleted = 0;
    let allSuccess = true;
    let lastEvidence: string[] = [];

    for (let i = 0; i < intent.steps.length; i++) {
      const step = intent.steps[i];
      opts.onProgress?.({
        step: i + 1,
        total: intent.steps.length,
        description: step.description,
        status: "running",
      });

      // Per-step confirmation for medium/dangerous actions in ask_every_time
      if (permissionSystem.getMode() === "ask_every_time" && permissionSystem.needsStepConfirmation(step)) {
        const approved = await permissionSystem.requestApproval(
          step.description,
          [step.description],
          riskForStep(step.action, step.params)
        );
        if (!approved) {
          notes.push(`${step.description} — skipped (declined)`);
          opts.onProgress?.({
            step: i + 1,
            total: intent.steps.length,
            description: step.description,
            status: "skipped",
          });
          allSuccess = false;
          continue;
        }
      }

      const result = await this.executeWithRetry(step, ctx, 2);
      notes.push(result.note || result.output);
      if (result.evidence) lastEvidence = result.evidence;

      if (result.success) {
        stepsCompleted++;
        this.updateContextFromStep(step, result);
        opts.onProgress?.({
          step: i + 1,
          total: intent.steps.length,
          description: step.description,
          status: "done",
        });
      } else {
        allSuccess = false;
        // Don't continue pointless chains when the first step failed hard
        if (intent.isMultiStep && i === 0) {
          notes.push("Stopping — the first step failed.");
          break;
        }
        opts.onProgress?.({
          step: i + 1,
          total: intent.steps.length,
          description: step.description,
          status: "failed",
        });
      }
    }

    // ─── Step 4: Verified report ───────────────────────────────────────────
    const summary = this.generateSummary(intent, allSuccess, stepsCompleted, notes, lastEvidence);

    return {
      success: allSuccess,
      summary,
      notes,
      stepsCompleted,
      stepsTotal: intent.steps.length,
      durationMs: Date.now() - t0,
    };
  }

  /** Cheap lexical check: does this message look like a command? */
  private looksLikeTask(command: string): boolean {
    const t = command.toLowerCase();
    return /\b(open|launch|start|play|search|close|focus|type|press|click|scroll|copy|paste|read|goto|go to|find|kill|navigate)\b/.test(t);
  }

  /** Build a full intent from model-assist JSON. */
  private buildIntentFromAssist(original: string, normalized: string, assist: any): ParsedIntent {
    const action = String(assist.action).toLowerCase();
    const target = String(assist.target ?? "");
    const query = String(assist.query ?? "");
    const url = String(assist.url ?? "");

    const stepMap: Record<string, TaskStep> = {
      open: url
        ? { action: "open_url", target: url, params: { url }, description: `Open ${target || url}` }
        : { action: "open_app", target, params: { appName: target, query: target }, description: `Open ${target}` },
      play: {
        action: "play_media",
        target: target || "youtube",
        params: { query, youtube: "true" },
        description: `Play "${query}"`,
      },
      search: {
        action: "search_web",
        target: "google",
        params: { url: `https://www.google.com/search?q=${encodeURIComponent(query || target)}`, query: query || target },
        description: `Search for "${query || target}"`,
      },
      navigate: url
        ? { action: "open_url", target: url, params: { url }, description: `Go to ${url}` }
        : { action: "open_website", target, params: { url: "", label: target }, description: `Go to ${target}` },
      type: { action: "type_text", target: "", params: { text: query }, description: `Type "${query}"` },
      click: { action: "click", target: "", params: { x: "0", y: "0" }, description: "Click" },
      scroll: { action: "scroll", target: "", params: { deltaY: "-360" }, description: "Scroll" },
      close: { action: "close_app", target, params: { target }, description: `Close ${target}` },
      focus: { action: "focus_app", target, params: { target }, description: `Focus ${target}` },
      clipboard: { action: "clipboard", target: "read", params: { mode: "read" }, description: "Read clipboard" },
      read: { action: "read_page", target: url || target, params: { url: url || target }, description: `Read ${url || target}` },
    };

    const step = stepMap[action];
    if (!step) {
      return parseIntentV2(original); // fall back to deterministic result
    }
    return {
      original,
      normalized,
      action,
      target,
      query,
      isTask: true,
      isMultiStep: false,
      steps: [step],
      summary: step.description,
      confidence: 0.7,
      needsModelAssist: true,
    };
  }

  /** Update the short-term context after a VERIFIED action. */
  private updateContextFromStep(step: TaskStep, result: ToolResult): void {
    try {
      switch (step.action) {
        case "open_website":
          contextStore.update({ activeWebsite: step.target, activeUrl: step.params.url });
          break;
        case "open_url":
          contextStore.update({ activeUrl: step.params.url });
          break;
        case "open_app":
          contextStore.update({ activeApp: step.target });
          break;
        case "play_media":
        case "search_youtube":
          if (step.params.query) contextStore.update({ lastMediaQuery: step.params.query, activeWebsite: step.target || "youtube" });
          break;
        case "open_folder":
        case "open_file":
          if (result.output) contextStore.update({ lastOpenedPath: step.params.query ?? step.target });
          break;
        default:
          break;
      }
    } catch {
      /* non-fatal */
    }
  }

  private async executeWithRetry(
    step: TaskStep,
    ctx: ToolContext,
    maxRetries: number
  ): Promise<ToolResult> {
    let lastError: ToolResult | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const result = await executeTool(step.action, step, ctx);
      if (result.success) return result;
      lastError = result;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }

    return lastError ?? { success: false, output: "Unknown error", note: "Failed after retries" };
  }

  /**
   * Verified summary — never claims more than what actually happened.
   */
  private generateSummary(
    intent: ParsedIntent,
    allSuccess: boolean,
    stepsCompleted: number,
    notes: string[],
    evidence: string[]
  ): string {
    if (allSuccess) {
      if (intent.isMultiStep) {
        return `Done — ${stepsCompleted} of ${intent.steps.length} steps completed. ${evidence[0] ?? ""}`.trim();
      }
      return intent.summary;
    }
    const failed = notes.filter((n) => /couldn't|failed|not found|missing/i.test(n)).slice(0, 2);
    return stepsCompleted === 0
      ? `I couldn't complete that. ${failed.join(" ")}`
      : `Completed ${stepsCompleted} of ${intent.steps.length} steps. ${failed.join(" ")}`.trim();
  }
}

export const orchestrator = new Orchestrator();
