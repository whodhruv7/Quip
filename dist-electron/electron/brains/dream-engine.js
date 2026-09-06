"use strict";
// Quip V2 — DREAM ENGINE (Phase 4)
// -----------------------------------------------------------------------------
// Analyzes the user's communication patterns and daily activities silently
// in the background when the system is idle.
//
// Extracts "Dream Insights" — profound, high-level directives about the user's
// goals or style. These insights are fed directly into the Communication DNA
// to deeply personalize Quip.
// -----------------------------------------------------------------------------
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dreamEngine = exports.DreamEngine = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const FILENAME = "dreams.json";
// Dream only once every 6 hours max to save tokens
const DREAM_COOLDOWN_MS = 6 * 60 * 60 * 1000;
// Trigger after 5 minutes of system idle time
const IDLE_TRIGGER_SECONDS = 5 * 60;
const DEFAULT_STATE = {
    lastDreamMs: 0,
    insights: [],
};
class DreamEngine {
    state = { ...DEFAULT_STATE };
    filePath = "";
    isDreaming = false;
    modelRouter;
    init(userDataDir, router) {
        this.filePath = node_path_1.default.join(userDataDir, FILENAME);
        this.modelRouter = router;
        this.load();
    }
    getInsights() {
        return this.state.insights;
    }
    /**
     * Called by the environment brain on its tick.
     * Checks if it's time to dream based on idle time and cooldown.
     */
    async checkIdleAndDream(idleSeconds, events, profile, memories) {
        if (this.isDreaming)
            return;
        if (idleSeconds < IDLE_TRIGGER_SECONDS)
            return;
        const now = Date.now();
        if (now - this.state.lastDreamMs < DREAM_COOLDOWN_MS)
            return;
        this.isDreaming = true;
        try {
            await this.dream(events, profile, memories);
        }
        catch (err) {
            console.error("[DreamEngine] Dreaming failed:", err);
        }
        finally {
            this.isDreaming = false;
        }
    }
    async dream(events, profile, memories) {
        const today = Date.now() - 24 * 60 * 60 * 1000;
        const recentEvents = events.filter((e) => e.timestamp > today);
        // Build the subconscious prompt
        let context = `## USER ACTIVITY LAST 24H\n`;
        recentEvents.forEach(e => {
            context += `- [${new Date(e.timestamp).toLocaleTimeString()}] ${e.title}\n`;
        });
        context += `\n## USER PROFILE\n`;
        context += `- Top Topics: ${profile.topTopics.map(t => t.topic).join(", ")}\n`;
        context += `- Avg Length: ${profile.avgMessageLength} words\n`;
        const recentMems = memories.memories
            .filter((m) => m.createdAt && m.createdAt > today)
            .slice(0, 5);
        context += `\n## RECENT MEMORIES LEARNED\n`;
        recentMems.forEach((m) => {
            context += `- ${m.key}: ${m.value}\n`;
        });
        const systemPrompt = `You are the subconscious Dream Engine of Quip (an AI companion).
Analyze the following context about the user's recent day.
Extract 1 to 3 profound, high-level insights about their work habits, communication style, or long-term goals.
DO NOT return a chat response. Return ONLY a valid JSON array of strings.

Example:
["The user is highly focused on React performance today and prefers extremely brief, code-heavy answers.", "The user tends to work late into the night on creative tasks."]`;
        const result = await this.modelRouter.complete(systemPrompt, [
            { role: "user", content: context }
        ]);
        let parsed = [];
        try {
            // Find JSON array in the response
            const match = result.match(/\[([\s\S]*)\]/);
            if (match) {
                parsed = JSON.parse(match[0]);
            }
            else {
                parsed = JSON.parse(result);
            }
        }
        catch (e) {
            console.error("[DreamEngine] Failed to parse dream insights JSON", e, "Raw:", result);
            return;
        }
        if (Array.isArray(parsed) && parsed.length > 0) {
            this.state.insights = parsed.slice(0, 3).map(s => String(s));
            this.state.lastDreamMs = Date.now();
            this.save();
            console.log("[DreamEngine] Woke up from dream. Insights:", this.state.insights);
        }
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
            console.error("[DreamEngine] Failed to load state:", e);
        }
    }
    save() {
        try {
            node_fs_1.default.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
        }
        catch (e) {
            console.error("[DreamEngine] Failed to save state:", e);
        }
    }
}
exports.DreamEngine = DreamEngine;
exports.dreamEngine = new DreamEngine();
//# sourceMappingURL=dream-engine.js.map