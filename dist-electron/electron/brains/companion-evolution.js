"use strict";
// Quip V2 — COMPANION EVOLUTION SYSTEM
// -----------------------------------------------------------------------------
// Tracks long-term progression per companion. Not XP, not levels — a "depth"
// metric based on conversations, messages, tasks, memories, and longevity.
// Unlocks cosmetic upgrades at depth milestones (tier 1/2/3). Purely cosmetic,
// purely emotional. When a new cosmetic unlocks, the companion celebrates.
//
// Storage: JSON file in userData. Updated after every interaction.
// -----------------------------------------------------------------------------
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.companionEvolution = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const FILENAME = "companion-progression.json";
const SCHEMA_VERSION = 1;
const COSMETICS = {
    pix: [
        { tier: 1, name: "Tiny Scarf", description: "A cozy aqua scarf", threshold: 50 },
        { tier: 2, name: "Star Sparkle", description: "A twinkling star accent", threshold: 150 },
        { tier: 3, name: "Color Shift", description: "Eyes shimmer pink-aqua", threshold: 300 },
    ],
    kai: [
        { tier: 1, name: "Leaf Accent", description: "A small green leaf pin", threshold: 50 },
        { tier: 2, name: "Book Badge", description: "A tiny book emblem", threshold: 150 },
        { tier: 3, name: "Constellation Aura", description: "A soft starry glow", threshold: 300 },
    ],
    ren: [
        { tier: 1, name: "Curiosity Spark", description: "A glowing question mark", threshold: 50 },
        { tier: 2, name: "Galaxy Trail", description: "Stardust follows behind", threshold: 150 },
        { tier: 3, name: "Cosmic Crown", description: "A miniature galaxy halo", threshold: 300 },
    ],
};
const WEIGHTS = { maxConv: 300, maxMsg: 2000, maxTask: 100, maxMem: 50, maxLongevity: 90 };
function computeDepth(p) {
    const conversationScore = Math.min(p.conversations / WEIGHTS.maxConv, 1) * 0.4;
    const messageScore = Math.min(p.totalMessages / WEIGHTS.maxMsg, 1) * 0.2;
    const taskScore = Math.min(p.tasksCompleted / WEIGHTS.maxTask, 1) * 0.2;
    const memoryScore = Math.min(p.memoriesCreated / WEIGHTS.maxMem, 1) * 0.1;
    const longevityScore = Math.min(p.daysSinceFirst / WEIGHTS.maxLongevity, 1) * 0.1;
    return Math.min(1, conversationScore + messageScore + taskScore + memoryScore + longevityScore);
}
function makeBaseProgression(id) {
    return {
        companion: id,
        conversations: 0,
        totalMessages: 0,
        tasksCompleted: 0,
        memoriesCreated: 0,
        firstInteractionAt: 0,
        daysSinceFirst: 0,
    };
}
class CompanionEvolutionBrain {
    progressions;
    filePath = null;
    saveTimer = null;
    onUnlockCallback = null;
    constructor() {
        const base = {
            pix: makeBaseProgression("pix"),
            kai: makeBaseProgression("kai"),
            ren: makeBaseProgression("ren"),
        };
        this.progressions = {
            pix: { ...base.pix, depth: 0, unlockedCosmetics: [] },
            kai: { ...base.kai, depth: 0, unlockedCosmetics: [] },
            ren: { ...base.ren, depth: 0, unlockedCosmetics: [] },
        };
    }
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
                    for (const id of ["pix", "kai", "ren"]) {
                        if (data[id]) {
                            this.progressions[id] = { ...this.progressions[id], ...data[id] };
                        }
                    }
                }
            }
        }
        catch (err) {
            console.error("[CompanionEvolution] Failed to load data:", err);
        }
    }
    save() {
        if (!this.filePath)
            return;
        if (this.saveTimer)
            clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => {
            if (!this.filePath)
                return;
            promises_1.default.writeFile(this.filePath, JSON.stringify(this.progressions, null, 2))
                .catch(err => console.error("[CompanionEvolution] Failed to save data:", err));
        }, 2000);
    }
    /** Set a callback fired when a new cosmetic is unlocked. */
    onUnlock(cb) {
        this.onUnlockCallback = cb;
    }
    /** Record a new conversation (first user message in a session). */
    recordConversation(id) {
        const p = this.progressions[id];
        p.conversations++;
        if (p.firstInteractionAt === 0) {
            p.firstInteractionAt = Date.now();
        }
        p.daysSinceFirst = Math.floor((Date.now() - p.firstInteractionAt) / (24 * 60 * 60 * 1000));
        this.recompute(id);
    }
    /** Record a message (user or assistant). */
    recordMessage(id) {
        const p = this.progressions[id];
        p.totalMessages++;
        this.recompute(id);
    }
    /** Record a completed task. */
    recordTask(id) {
        const p = this.progressions[id];
        p.tasksCompleted++;
        this.recompute(id);
    }
    /** Record a new memory created with this companion. */
    recordMemory(id) {
        const p = this.progressions[id];
        p.memoriesCreated++;
        this.recompute(id);
    }
    recompute(id) {
        const p = this.progressions[id];
        const newDepth = computeDepth(p);
        p.depth = newDepth;
        // Check for cosmetic unlocks
        const available = COSMETICS[id];
        for (const cosmetic of available) {
            const alreadyUnlocked = p.unlockedCosmetics.some((c) => c.tier === cosmetic.tier);
            if (!alreadyUnlocked && p.conversations >= cosmetic.threshold) {
                const unlock = {
                    id: `${id}-tier${cosmetic.tier}`,
                    companion: id,
                    tier: cosmetic.tier,
                    name: cosmetic.name,
                    description: cosmetic.description,
                    unlockedAt: Date.now(),
                };
                p.unlockedCosmetics.push(unlock);
                if (this.onUnlockCallback) {
                    this.onUnlockCallback(unlock);
                }
            }
        }
        this.save();
    }
    getProgression(id) {
        return { ...this.progressions[id], unlockedCosmetics: [...this.progressions[id].unlockedCosmetics] };
    }
    getAll() {
        return {
            pix: this.getProgression("pix"),
            kai: this.getProgression("kai"),
            ren: this.getProgression("ren"),
        };
    }
}
exports.companionEvolution = new CompanionEvolutionBrain();
//# sourceMappingURL=companion-evolution.js.map