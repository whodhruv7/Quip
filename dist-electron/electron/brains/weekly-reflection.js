"use strict";
// Quip V2 — WEEKLY REFLECTION ENGINE (Phase 2)
// -----------------------------------------------------------------------------
// Generates a natural-language weekly digest based on the timeline + memory.
// Quip reads what happened this week, summarizes it conversationally, then
// asks the user for feedback. This is the "self-improvement loop" foundation.
//
// Reflection includes:
//   - Total conversations + tasks executed
//   - Top topics discussed (from relationship engine)
//   - Key memories formed this week
//   - Companion evolution progress
//   - "What can I do better?" prompt
// -----------------------------------------------------------------------------
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.weeklyReflection = exports.WeeklyReflectionEngine = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const REFLECTION_FILE = "weekly-reflection.json";
const DEFAULT_STATE = {
    lastReflectionMs: 0,
    lastReflectionSummary: "",
    feedbackHistory: [],
};
class WeeklyReflectionEngine {
    state = { ...DEFAULT_STATE };
    filePath = "";
    init(userDataDir) {
        this.filePath = node_path_1.default.join(userDataDir, REFLECTION_FILE);
        this.load();
    }
    getLastReflectionMs() {
        return this.state.lastReflectionMs;
    }
    /** Build a digest from the week's data. */
    buildDigest(events, memories, profile) {
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const weekEvents = events.filter((e) => e.timestamp >= weekAgo);
        const conversationCount = weekEvents.filter((e) => e.title.startsWith("Started conversation")).length;
        const taskCount = weekEvents.filter((e) => e.title.startsWith("Executed task")).length;
        // Memories formed this week
        const memoriesFormed = memories.memories.filter((m) => m.createdAt !== undefined && m.createdAt >= weekAgo).length;
        // Top topics from relationship engine
        const topTopics = profile.topTopics
            .sort((a, b) => b.count - a.count)
            .slice(0, 4)
            .map((t) => t.topic);
        // Build highlights
        const highlights = [];
        if (conversationCount > 0) {
            highlights.push(`Had ${conversationCount} conversation${conversationCount > 1 ? "s" : ""} with you`);
        }
        if (taskCount > 0) {
            highlights.push(`Completed ${taskCount} task${taskCount > 1 ? "s" : ""} for you`);
        }
        if (memoriesFormed > 0) {
            highlights.push(`Learned ${memoriesFormed} new thing${memoriesFormed > 1 ? "s" : ""} about you`);
        }
        // Natural summary
        let naturalSummary = "Here's what we did together this week:\n\n";
        if (highlights.length === 0) {
            naturalSummary += "Looks like it was a quiet week! Still here whenever you need me. 🤗";
        }
        else {
            naturalSummary += highlights.map((h) => `• ${h}`).join("\n");
            if (topTopics.length > 0) {
                naturalSummary += `\n\nWe talked a lot about: ${topTopics.join(", ")}.`;
            }
        }
        const askFeedback = "How am I doing? Is there anything you wish I did differently — like being more concise, more detailed, or just something different? I want to get better for you 💬";
        return {
            conversationCount,
            taskCount,
            memoriesFormed,
            topTopics,
            highlights,
            naturalSummary,
            askFeedback,
        };
    }
    /** Mark a reflection as completed and save feedback. */
    recordReflection(summary, feedback) {
        const now = Date.now();
        const weekNum = Math.floor(now / (7 * 24 * 60 * 60 * 1000));
        this.state.lastReflectionMs = now;
        this.state.lastReflectionSummary = summary;
        if (feedback) {
            this.state.feedbackHistory.push({ week: weekNum, feedback, ts: now });
            // Keep last 52 weeks of feedback
            if (this.state.feedbackHistory.length > 52) {
                this.state.feedbackHistory = this.state.feedbackHistory.slice(-52);
            }
        }
        this.save();
    }
    load() {
        try {
            if (node_fs_1.default.existsSync(this.filePath)) {
                const data = JSON.parse(node_fs_1.default.readFileSync(this.filePath, "utf8"));
                if (data && typeof data === "object") {
                    this.state = { ...DEFAULT_STATE, ...data };
                }
            }
        }
        catch (e) {
            console.error("[WeeklyReflection] Failed to load state:", e);
        }
    }
    save() {
        try {
            node_fs_1.default.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
        }
        catch (e) {
            console.error("[WeeklyReflection] Failed to save state:", e);
        }
    }
}
exports.WeeklyReflectionEngine = WeeklyReflectionEngine;
exports.weeklyReflection = new WeeklyReflectionEngine();
//# sourceMappingURL=weekly-reflection.js.map