"use strict";
// Quip V2 — COMMUNICATION DNA ENGINE (Phase 2)
// -----------------------------------------------------------------------------
// Sits on top of the Relationship Engine and Memory Brain to compute a live
// "Communication DNA Profile" that is injected into the LLM system prompt.
//
// It synthesizes:
//   1. The UserProfile from the RelationshipEngine (tone, formality, length)
//   2. Style facts extracted by the MemoryExtractor (explicit preferences)
//
// Result: a compact, natural-language prompt fragment that makes the LLM
// mirror the user's exact communication style without being told each time.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.communicationDNA = exports.CommunicationDNAEngine = void 0;
const dream_engine_1 = require("./dream-engine");
const LENGTH_THRESHOLDS = {
    brief: 50,
    moderate: 150,
};
function deriveTone(formality) {
    if (formality < 0.35)
        return "casual";
    if (formality < 0.65)
        return "balanced";
    return "formal";
}
function deriveLength(words) {
    if (words <= LENGTH_THRESHOLDS.brief)
        return "brief";
    if (words <= LENGTH_THRESHOLDS.moderate)
        return "moderate";
    return "detailed";
}
class CommunicationDNAEngine {
    cached = null;
    cacheMs = 30_000; // re-compute every 30s max
    /**
     * Compute the DNA from the current user profile + extracted style memories.
     * Returns a cached result if fresh enough.
     */
    compute(profile, memories) {
        const now = Date.now();
        if (this.cached && now - this.cached.updatedAt < this.cacheMs) {
            return this.cached;
        }
        const tone = deriveTone(profile.formality);
        const length = deriveLength(profile.preferredResponseLength);
        const usesEmoji = profile.emojiUsage > 0.2;
        const prefersCode = profile.wantsCodeInResponses;
        // Pull style-typed facts from memory extractor output
        const styleFacts = memories.memories
            .filter((m) => m.kind === "style" || m.kind === "preference")
            .sort((a, b) => {
            // High importance first
            const imp = { high: 3, medium: 2, low: 1 };
            return (imp[b.importance] ?? 1) - (imp[a.importance] ?? 1);
        })
            .slice(0, 6)
            .map((m) => m.value);
        const lines = [];
        // Tone directive
        if (tone === "casual") {
            lines.push("Speak casually and naturally — like a smart friend, not a corporate assistant.");
        }
        else if (tone === "formal") {
            lines.push("Maintain a professional, respectful tone. Use complete sentences.");
        }
        else {
            lines.push("Use a friendly but professional tone. Conversational but clear.");
        }
        // Length directive
        if (length === "brief") {
            lines.push("Keep responses SHORT — 1-3 sentences unless explicitly asked for more.");
        }
        else if (length === "detailed") {
            lines.push("The user likes detailed responses. Elaborate, explain fully.");
        }
        else {
            lines.push("Aim for concise but complete answers — around a paragraph.");
        }
        // Emoji
        if (usesEmoji) {
            lines.push("Use emojis sparingly to add personality — user likes them.");
        }
        // Code preference
        if (prefersCode) {
            lines.push("Include code examples when relevant — user is technical.");
        }
        // Injected style facts from memory
        if (styleFacts.length > 0) {
            lines.push(`Communication style notes: ${styleFacts.slice(0, 3).join("; ")}.`);
        }
        // Phase 4: Subconscious Dream Insights
        const dreams = dream_engine_1.dreamEngine.getInsights();
        if (dreams.length > 0) {
            lines.push(`Subconscious Insights about User: ${dreams.join(" ")}`);
        }
        const promptFragment = lines.join(" ");
        this.cached = {
            toneLabel: tone,
            preferredLength: length,
            usesEmoji,
            prefersCode,
            styleFacts,
            promptFragment,
            updatedAt: now,
        };
        return this.cached;
    }
    /** Invalidate cache to force recomputation on next call. */
    invalidate() {
        this.cached = null;
    }
}
exports.CommunicationDNAEngine = CommunicationDNAEngine;
exports.communicationDNA = new CommunicationDNAEngine();
//# sourceMappingURL=communication-dna.js.map