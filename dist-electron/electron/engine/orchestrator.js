"use strict";
// Quip Execution Engine V2 — Orchestrator
// ─────────────────────────────────────────────────────────────────────────────
// Central execution orchestrator. This is the heart of Quip's execution.
//
// Pipeline:
//   User Input
//     → Intent Parser V2 (decompose)
//     → Permission Check (mode-based)
//     → Task Execution (tool registry)
//     → Report Generation (summary)
//
// Supports:
//   - Single-step tasks
//   - Multi-step chains
//   - Permission modes (Ask Every Time, Approve Task, Full Access)
//   - Retry on failure (up to 2 retries)
//   - Progress reporting
//   - Trust layer notes
// ─────────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.orchestrator = void 0;
const intent_parser_v2_1 = require("./intent-parser-v2");
const permission_modes_1 = require("./permission-modes");
const tool_registry_1 = require("./tool-registry");
class Orchestrator {
    /**
     * Main entry point. Takes user input, returns execution result.
     */
    async execute(command, opts) {
        const t0 = Date.now();
        const ctx = { platform: opts.platform };
        // ─── Step 1: Parse intent ──────────────────────────────────────────────
        const intent = (0, intent_parser_v2_1.parseIntentV2)(command);
        // If it's not a task (just chat), return immediately
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
        // ─── Step 2: Permission check ──────────────────────────────────────────
        if (permission_modes_1.permissionSystem.planNeedsApproval()) {
            const stepDescriptions = intent.steps.map((s, i) => `${i + 1}. ${s.description}`);
            const approved = await this.requestApproval(intent.summary || "Execute task", stepDescriptions, opts.onApprovalRequest);
            if (!approved) {
                return {
                    success: false,
                    summary: "Task cancelled",
                    notes: ["You declined the task"],
                    stepsCompleted: 0,
                    stepsTotal: intent.steps.length,
                    durationMs: Date.now() - t0,
                };
            }
        }
        // ─── Step 3: Execute steps ─────────────────────────────────────────────
        const notes = [];
        let stepsCompleted = 0;
        let allSuccess = true;
        for (let i = 0; i < intent.steps.length; i++) {
            const step = intent.steps[i];
            opts.onProgress?.({
                step: i + 1,
                total: intent.steps.length,
                description: step.description,
                status: "running",
            });
            // Per-step confirmation in "ask_every_time" mode
            if (permission_modes_1.permissionSystem.getMode() === "ask_every_time") {
                const approved = await this.requestApproval(step.description, [step.description], opts.onApprovalRequest);
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
            // Execute with retry
            const result = await this.executeWithRetry(step, ctx, 2);
            notes.push(result.note);
            if (result.success) {
                stepsCompleted++;
                opts.onProgress?.({
                    step: i + 1,
                    total: intent.steps.length,
                    description: step.description,
                    status: "done",
                });
            }
            else {
                allSuccess = false;
                opts.onProgress?.({
                    step: i + 1,
                    total: intent.steps.length,
                    description: step.description,
                    status: "failed",
                });
            }
        }
        // ─── Step 4: Generate report ────────────────────────────────────────────
        const summary = this.generateSummary(intent, allSuccess, stepsCompleted);
        return {
            success: allSuccess,
            summary,
            notes,
            stepsCompleted,
            stepsTotal: intent.steps.length,
            durationMs: Date.now() - t0,
        };
    }
    /**
     * Execute a single step with retry logic.
     */
    async executeWithRetry(step, ctx, maxRetries) {
        let lastError = null;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const result = await (0, tool_registry_1.executeTool)(step.action, step.params, ctx);
            if (result.success)
                return result;
            lastError = result;
            // Wait before retry (exponential backoff)
            if (attempt < maxRetries) {
                await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
            }
        }
        return lastError ?? { success: false, output: "Unknown error", note: "Failed after retries" };
    }
    /**
     * Request approval from user.
     */
    async requestApproval(title, steps, callback) {
        if (!callback)
            return true; // no callback = auto-approve (shouldn't happen)
        const result = await permission_modes_1.permissionSystem.requestApproval(title, steps);
        return result.approved;
    }
    /**
     * Generate a human-friendly summary.
     */
    generateSummary(intent, allSuccess, stepsCompleted) {
        if (allSuccess) {
            return intent.isMultiStep
                ? `Done — ${stepsCompleted} steps completed`
                : intent.summary;
        }
        return `Completed ${stepsCompleted} of ${intent.steps.length} steps`;
    }
}
exports.orchestrator = new Orchestrator();
//# sourceMappingURL=orchestrator.js.map