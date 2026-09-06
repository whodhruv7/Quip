"use strict";
// Quip V2 — MEMORY EXTRACTOR
// -----------------------------------------------------------------------------
// The heart of Quip's memory. After every N messages in a conversation,
// this module sends the conversation chunk to the LLM with a compression
// prompt that extracts:
//   1. Atomic facts about the user (preferences, contacts, habits)
//   2. Entities (people, organizations, projects) + their relationships
//
// Extracted facts go to the Memory Brain. Entities + relations go to the
// Knowledge Graph. This is what makes Quip LEARN from conversations instead
// of just echoing them back.
//
// This runs in the background — never blocks the chat. Failures are silent
// (logged but not shown to the user) because extraction is best-effort.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryExtractorBrain = void 0;
const COMPRESSION_THRESHOLD = 10; // extract after every 10 messages
const EXTRACTION_TIMEOUT_MS = 25_000;
const EXTRACTION_SYSTEM_PROMPT = `You are Quip's memory extraction engine. Your job is to read a conversation between the user and Quip, then extract durable knowledge.

Extract ONLY things worth remembering long-term:
- Contacts: people mentioned by name + their role/relationship to the user (e.g. "CEO is Rajesh Gupta")
- Preferences: what the user likes/dislikes (e.g. "prefers Hindi", "uses VS Code", "default music app is Spotify")
- Facts: biographical/contextual facts (e.g. "birthday is July 14", "works at Acme Corp")
- Style: communication patterns (e.g. "writes formally", "uses lots of emojis")

DO NOT extract:
- Trivial chatter ("how are you", "thanks")
- Temporary moods or one-off questions
- Things the user asked about but didn't reveal about themselves

Also extract ENTITIES — people, organizations, projects, skills the user interacts with. For each, note their relationship to the user (e.g. "ceo", "friend", "works_at").

Return ONLY valid JSON, no markdown fences:
{
  "facts": [
    { "key": "ceo_name", "value": "Rajesh Gupta", "type": "contact", "importance": "high" },
    { "key": "preferred_language", "value": "Hindi", "type": "preference", "importance": "medium" }
  ],
  "entities": [
    { "type": "person", "name": "Rajesh Gupta", "attributes": { "role": "CEO" }, "relationToUser": "ceo" },
    { "type": "org", "name": "Acme Corp", "attributes": {}, "relationToUser": "works_at" }
  ],
  "summary": "One sentence summary of what was discussed."
}

If there's nothing worth extracting, return: { "facts": [], "entities": [], "summary": "Nothing notable." }`;
class MemoryExtractorBrain {
    deps;
    messageCounts = new Map();
    constructor(deps) {
        this.deps = deps;
    }
    resetExtractionCount(companionId) {
        this.messageCounts.set(companionId, 0);
    }
    observeMessages(companionId, messages) {
        const current = (this.messageCounts.get(companionId) ?? 0) + 1;
        this.messageCounts.set(companionId, current);
        if (current >= COMPRESSION_THRESHOLD) {
            this.messageCounts.set(companionId, 0);
            this.extractFromMessages(companionId, messages).catch((e) => {
                console.error("[MemoryExtractor] Background extraction failed:", e);
            });
        }
    }
    async extractFromMessages(companionId, messages) {
        const recent = messages.slice(-COMPRESSION_THRESHOLD * 2);
        if (recent.length === 0)
            return;
        const status = this.deps.modelRouter.status();
        if (!status.healthy)
            return;
        const userPrompt = `Conversation to analyze:\n\n${recent
            .map((m) => {
            const content = m.content.length > 1000 ? m.content.slice(0, 1000) + "..." : m.content;
            return `${m.role === "user" ? "User" : "Quip"}: ${content}`;
        })
            .join("\n")}`;
        let raw;
        try {
            raw = await this.deps.modelRouter.complete(EXTRACTION_SYSTEM_PROMPT, [{ role: "user", content: userPrompt }], EXTRACTION_TIMEOUT_MS);
        }
        catch (e) {
            console.error("[MemoryExtractor] LLM call failed:", e);
            return;
        }
        const jsonStr = raw
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim();
        let result;
        try {
            result = JSON.parse(jsonStr);
        }
        catch (e) {
            console.error("[MemoryExtractor] Failed to parse JSON:", e, "Raw output:", raw);
            return;
        }
        if (Array.isArray(result.facts)) {
            for (const fact of result.facts) {
                if (!fact.key || !fact.value)
                    continue;
                try {
                    const validKinds = ["contact", "preference", "fact", "style"];
                    const validImportances = ["high", "medium", "low"];
                    const kind = validKinds.includes(fact.type) ? fact.type : "fact";
                    const importance = validImportances.includes(fact.importance) ? fact.importance : "medium";
                    this.deps.memoryBrain.add({
                        kind,
                        key: fact.key,
                        value: fact.value,
                        importance,
                    });
                    this.deps.companionEvolution.recordMemory(companionId);
                }
                catch (e) {
                    console.error("[MemoryExtractor] Failed to add fact to memory:", e);
                }
            }
        }
        if (Array.isArray(result.entities)) {
            for (const entity of result.entities) {
                if (!entity.name || !entity.type)
                    continue;
                try {
                    const e = this.deps.knowledgeGraph.upsertEntity(entity.type, entity.name, entity.attributes ?? {}, 0.6);
                    if (entity.relationToUser) {
                        this.deps.knowledgeGraph.linkToUser(e, entity.relationToUser);
                    }
                }
                catch (e) {
                    console.error("[MemoryExtractor] Failed to upsert entity:", e);
                }
            }
        }
    }
}
exports.MemoryExtractorBrain = MemoryExtractorBrain;
//# sourceMappingURL=memory-extractor.js.map