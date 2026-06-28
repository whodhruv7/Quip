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

import { modelRouter } from "../system/model-router";
import { memoryBrain } from "./memory-brain-instance";
import { knowledgeGraph } from "./knowledge-graph";
import { companionEvolution } from "./companion-evolution";
import type { CompanionId, MemoryImportance, MemoryKind } from "../../src/types";

const COMPRESSION_THRESHOLD = 10; // extract after every 10 messages
const EXTRACTION_TIMEOUT_MS = 25_000;

interface ChatMessageForExtraction {
  role: "user" | "assistant";
  content: string;
}

interface ExtractedFact {
  key: string;
  value: string;
  type: "contact" | "preference" | "fact" | "style";
  importance: "high" | "medium" | "low";
}

interface ExtractedEntity {
  type: "person" | "org" | "project" | "skill" | "interest" | "place";
  name: string;
  attributes?: Record<string, unknown>;
  relationToUser?: string; // e.g. "ceo_of", "friend", "works_at"
}

interface ExtractionResult {
  facts: ExtractedFact[];
  entities: ExtractedEntity[];
  summary: string;
}

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

/** Track message counts per companion to know when to trigger extraction. */
const messageCounts = new Map<CompanionId, number>();

/** Reset count when a new chat starts. */
export function resetExtractionCount(companionId: CompanionId): void {
  messageCounts.set(companionId, 0);
}

/**
 * Should be called after every user+assistant message pair.
 * Triggers extraction when the threshold is reached.
 * Extraction runs in the background — this function returns immediately.
 */
export function observeMessages(
  companionId: CompanionId,
  messages: ChatMessageForExtraction[]
): void {
  const current = (messageCounts.get(companionId) ?? 0) + 1;
  messageCounts.set(companionId, current);

  if (current >= COMPRESSION_THRESHOLD) {
    messageCounts.set(companionId, 0);
    // Run extraction in the background — never block the caller.
    extractFromMessages(companionId, messages).catch(() => {
      // Silent failure — extraction is best-effort
    });
  }
}

/**
 * Run extraction on the recent conversation. Sends messages to the LLM,
 * parses the JSON response, and feeds facts to the memory brain + entities
 * to the knowledge graph.
 */
async function extractFromMessages(
  companionId: CompanionId,
  messages: ChatMessageForExtraction[]
): Promise<void> {
  // Take the last COMPRESSION_THRESHOLD * 2 messages (user+assistant pairs)
  const recent = messages.slice(-COMPRESSION_THRESHOLD * 2);
  if (recent.length === 0) return;

  // Check if model router is configured
  const status = modelRouter.status();
  if (!status.healthy) return;

  const userPrompt = `Conversation to analyze:\n\n${recent
    .map((m) => `${m.role === "user" ? "User" : "Quip"}: ${m.content}`)
    .join("\n")}`;

  let raw: string;
  try {
    raw = await modelRouter.complete(
      EXTRACTION_SYSTEM_PROMPT,
      [{ role: "user", content: userPrompt }],
      EXTRACTION_TIMEOUT_MS
    );
  } catch {
    return; // silent failure
  }

  // Parse JSON — handle markdown fences if the LLM added them
  const jsonStr = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let result: ExtractionResult;
  try {
    result = JSON.parse(jsonStr);
  } catch {
    return; // malformed JSON — skip this round
  }

  // ─── Feed facts to Memory Brain ─────────────────────────────────────
  if (Array.isArray(result.facts)) {
    for (const fact of result.facts) {
      if (!fact.key || !fact.value) continue;
      try {
        memoryBrain.add({
          kind: (fact.type as MemoryKind) ?? "fact",
          key: fact.key,
          value: fact.value,
          importance: (fact.importance as MemoryImportance) ?? "medium",
        });
        companionEvolution.recordMemory(companionId);
      } catch {
        /* skip individual bad facts */
      }
    }
  }

  // ─── Feed entities to Knowledge Graph ───────────────────────────────
  if (Array.isArray(result.entities)) {
    for (const entity of result.entities) {
      if (!entity.name || !entity.type) continue;
      try {
        const e = knowledgeGraph.upsertEntity(
          entity.type,
          entity.name,
          entity.attributes ?? {},
          0.6
        );
        if (entity.relationToUser) {
          knowledgeGraph.linkToUser(e, entity.relationToUser);
        }
      } catch {
        /* skip individual bad entities */
      }
    }
  }
}
