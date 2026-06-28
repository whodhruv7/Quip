"use strict";
// Quip V2 — RELATIONSHIP ENGINE
// -----------------------------------------------------------------------------
// Observes HOW the user interacts with Quip and tunes Quip's behavior to match.
// Tracks: response length preference, formality, emoji usage, humor level,
// active hours, top topics. Updates via exponential moving average so recent
// interactions weigh more. Injects a "Communication Style Guide" into the
// system prompt so the LLM talks like the user without being told each time.
//
// Privacy: the profile is stored locally and shown in Settings as
// "Communication DNA." The user can see and override it.
// -----------------------------------------------------------------------------
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.relationshipEngine = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const FILENAME = "user-profile.json";
const SCHEMA_VERSION = 1;
const EMA_ALPHA = 0.1; // exponential moving average factor
const DEFAULT_PROFILE = {
    schemaVersion: SCHEMA_VERSION,
    avgMessageLength: 0,
    preferredResponseLength: 80, // default to medium
    formality: 0.5,
    emojiUsage: 0.1,
    humorLevel: 0.3,
    wantsCodeInResponses: true,
    activeHours: new Array(24).fill(0),
    topTopics: [],
    totalInteractions: 0,
    updatedAt: 0,
};
// Casual indicators (lower formality)
const CASUAL_MARKERS = [
    "hey",
    "lol",
    "haha",
    "yeah",
    "nope",
    "yep",
    "btw",
    "tbh",
    "idk",
    "smh",
    "lol",
    "lmao",
    "fr",
    "ngl",
];
// Formal indicators (higher formality)
const FORMAL_MARKERS = [
    "please",
    "thank you",
    "regards",
    "sincerely",
    "dear",
    "kindly",
    "would you",
    "could you",
    "may i",
    "i would like",
    "i appreciate",
];
const EMOJI_REGEX = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
const TECH_TOPICS = [
    "react",
    "typescript",
    "javascript",
    "python",
    "node",
    "css",
    "html",
    "sql",
    "api",
    "git",
    "docker",
    "aws",
    "code",
    "bug",
    "function",
    "component",
    "database",
    "server",
    "frontend",
    "backend",
];
/** Exponential moving average update. */
function ema(current, newValue, alpha = EMA_ALPHA) {
    return current * (1 - alpha) + newValue * alpha;
}
/** Score formality of a message: 0 = casual, 1 = formal. */
function scoreFormality(message) {
    const lower = message.toLowerCase();
    const words = lower.split(/\s+/).length || 1;
    let casualCount = 0;
    let formalCount = 0;
    for (const m of CASUAL_MARKERS) {
        if (lower.includes(m))
            casualCount++;
    }
    for (const m of FORMAL_MARKERS) {
        if (lower.includes(m))
            formalCount++;
    }
    // Punctuation: exclamations = casual, semicolons = formal
    if (/\!/.test(message))
        casualCount += 0.5;
    if (/;/.test(message))
        formalCount += 0.5;
    if (casualCount === 0 && formalCount === 0)
        return 0.5; // neutral
    const total = casualCount + formalCount;
    return Math.max(0, Math.min(1, formalCount / total));
}
/** Count emojis in a message. */
function countEmojis(message) {
    const matches = message.match(EMOJI_REGEX);
    return matches ? matches.length : 0;
}
/** Extract tech topics mentioned in a message. */
function extractTopics(message) {
    const lower = message.toLowerCase();
    return TECH_TOPICS.filter((t) => lower.includes(t));
}
class RelationshipEngine {
    profile = { ...DEFAULT_PROFILE };
    filePath = null;
    init(userDataDir) {
        this.filePath = node_path_1.default.join(userDataDir, FILENAME);
        this.load();
    }
    load() {
        if (!this.filePath)
            return;
        try {
            if (node_fs_1.default.existsSync(this.filePath)) {
                const data = JSON.parse(node_fs_1.default.readFileSync(this.filePath, "utf8"));
                if (data && typeof data === "object") {
                    this.profile = { ...DEFAULT_PROFILE, ...data };
                }
            }
        }
        catch {
            /* start fresh */
        }
    }
    save() {
        if (!this.filePath)
            return;
        try {
            this.profile.updatedAt = Date.now();
            node_fs_1.default.writeFileSync(this.filePath, JSON.stringify(this.profile, null, 2));
        }
        catch {
            /* best effort */
        }
    }
    /** Observe a user message and update the profile. */
    observeUserMessage(message) {
        const length = message.length;
        const formality = scoreFormality(message);
        const emojiCount = countEmojis(message);
        const hasEmoji = emojiCount > 0 ? 1 : 0;
        const hour = new Date().getHours();
        this.profile.avgMessageLength =
            this.profile.avgMessageLength === 0
                ? length
                : ema(this.profile.avgMessageLength, length);
        this.profile.formality = ema(this.profile.formality, formality);
        this.profile.emojiUsage = ema(this.profile.emojiUsage, hasEmoji);
        this.profile.activeHours[hour] = (this.profile.activeHours[hour] || 0) + 1;
        // Topic tracking
        const topics = extractTopics(message);
        for (const topic of topics) {
            const existing = this.profile.topTopics.find((t) => t.topic === topic);
            if (existing) {
                existing.count++;
            }
            else {
                this.profile.topTopics.push({ topic, count: 1 });
            }
        }
        // Keep top 10 topics
        this.profile.topTopics.sort((a, b) => b.count - a.count);
        this.profile.topTopics = this.profile.topTopics.slice(0, 10);
        this.profile.totalInteractions++;
        this.save();
    }
    /** Observe an assistant response — track its length to learn preference. */
    observeAssistantResponse(response, userFeedback) {
        const wordCount = response.split(/\s+/).length;
        if (userFeedback === "too_long") {
            this.profile.preferredResponseLength = Math.max(20, Math.round(this.profile.preferredResponseLength * 0.7));
        }
        else if (userFeedback === "too_short") {
            this.profile.preferredResponseLength = Math.min(500, Math.round(this.profile.preferredResponseLength * 1.3));
        }
        else {
            // Slowly drift toward the response length the user is engaging with
            this.profile.preferredResponseLength = Math.round(ema(this.profile.preferredResponseLength, wordCount));
        }
        this.save();
    }
    /** Detect if the user asked a technical question (likely wants code). */
    observeCodePreference(message) {
        const lower = message.toLowerCase();
        const codeIndicators = [
            "code",
            "function",
            "bug",
            "error",
            "implement",
            "fix",
            "component",
            "api",
            "script",
        ];
        if (codeIndicators.some((c) => lower.includes(c))) {
            this.profile.wantsCodeInResponses = true;
            this.save();
        }
    }
    /** Get a compact style guide for the system prompt. */
    getStyleGuide() {
        const p = this.profile;
        const lengthLabel = p.preferredResponseLength < 30
            ? "very short"
            : p.preferredResponseLength < 80
                ? "short"
                : p.preferredResponseLength < 150
                    ? "medium"
                    : "detailed";
        const formalityLabel = p.formality < 0.3 ? "casual" : p.formality < 0.7 ? "balanced" : "formal";
        const emojiLabel = p.emojiUsage < 0.1 ? "rarely" : p.emojiUsage < 0.4 ? "occasionally" : "frequently";
        const humorLabel = p.humorLevel < 0.3 ? "serious" : p.humorLevel < 0.6 ? "light humor ok" : "humor welcome";
        const topTopicsStr = p.topTopics.length > 0
            ? `\n- Often asks about: ${p.topTopics.slice(0, 4).map((t) => t.topic).join(", ")}`
            : "";
        return `Communication style guide for this user:
- Preferred response length: ${lengthLabel} (~${p.preferredResponseLength} words)
- Tone: ${formalityLabel}
- Emoji usage: ${emojiLabel}
- Humor: ${humorLabel}
- Code in responses: ${p.wantsCodeInResponses ? "yes" : "no"}${topTopicsStr}`;
    }
    get() {
        return { ...this.profile };
    }
    /** Allow user to override any field from Settings. */
    override(patch) {
        this.profile = { ...this.profile, ...patch };
        this.save();
    }
    reset() {
        this.profile = { ...DEFAULT_PROFILE };
        this.save();
    }
}
exports.relationshipEngine = new RelationshipEngine();
//# sourceMappingURL=relationship-engine.js.map