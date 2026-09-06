"use strict";
// Quip V2 — MEMORY BRAIN
// -----------------------------------------------------------------------------
// Quip should remember what matters and forget what doesn't. This brain
// stores small, weighted facts about the user and their world:
//
//   - contacts  ("CEO = Rajesh Gupta")
//   - style     ("prefers short replies, uses Hindi casually")
//   - preference("default music app = Spotify")
//   - fact      ("birthday = July 14")
//
// Each memory has an importance weight (high/medium/low) and a reinforcement
// counter. Low-importance memories decay; high ones persist forever. This
// prevents the "remembered I ate pizza once" pollution problem.
//
// The style digest is a compressed summary injected into the system prompt
// so the model talks like the user without re-reading every old message.
// -----------------------------------------------------------------------------
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryBrain = void 0;
const node_path_1 = __importDefault(require("node:path"));
const FILENAME = "memory.json";
const SCHEMA_VERSION = 1;
const MAX_MEMORIES = 200;
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
class MemoryBrain {
    knowledge = {
        schemaVersion: SCHEMA_VERSION,
        memories: [],
        styleDigest: "",
        updatedAt: 0,
    };
    filePath = null;
    saveTimer = null;
    SAVE_DEBOUNCE_MS = 2000;
    storage;
    constructor(storage) {
        this.storage = storage;
    }
    init(userDataDir) {
        this.filePath = node_path_1.default.join(userDataDir, FILENAME);
        this.load();
    }
    load() {
        if (!this.filePath)
            return;
        try {
            if (this.storage.exists(this.filePath)) {
                const data = JSON.parse(this.storage.read(this.filePath));
                if (data && Array.isArray(data.memories)) {
                    this.knowledge = data;
                }
            }
        }
        catch (err) {
            console.error("[MemoryBrain] Failed to load data:", err);
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
            try {
                this.knowledge.updatedAt = Date.now();
                this.storage.writeAsync(this.filePath, JSON.stringify(this.knowledge, null, 2))
                    .catch(err => console.error("[MemoryBrain] Failed to save data:", err));
            }
            catch (err) {
                console.error("[MemoryBrain] Unexpected save error:", err);
            }
            this.saveTimer = null;
        }, this.SAVE_DEBOUNCE_MS);
    }
    flush() {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
            try {
                this.knowledge.updatedAt = Date.now();
                if (this.filePath) {
                    this.storage.writeSync(this.filePath, JSON.stringify(this.knowledge, null, 2));
                }
            }
            catch (err) {
                console.error("[MemoryBrain] Flush error:", err);
            }
        }
    }
    get() {
        return { ...this.knowledge };
    }
    add(entry) {
        const existing = this.knowledge.memories.find((m) => m.kind === entry.kind && m.key.toLowerCase() === entry.key.toLowerCase());
        if (existing) {
            existing.value = entry.value;
            existing.importance = entry.importance;
            existing.weight += 1;
            existing.updatedAt = Date.now();
            this.rebuildDigest();
            this.save();
            return existing;
        }
        const now = Date.now();
        const full = {
            ...entry,
            id: uid(),
            createdAt: now,
            updatedAt: now,
            weight: 1,
        };
        this.knowledge.memories.push(full);
        if (this.knowledge.memories.length > MAX_MEMORIES) {
            this.knowledge.memories.sort((a, b) => weightScore(b) - weightScore(a));
            this.knowledge.memories = this.knowledge.memories.slice(0, MAX_MEMORIES);
        }
        this.rebuildDigest();
        this.save();
        return full;
    }
    forget(id) {
        this.knowledge.memories = this.knowledge.memories.filter((m) => m.id !== id);
        this.rebuildDigest();
        this.save();
    }
    pin(id) {
        const m = this.knowledge.memories.find((e) => e.id === id);
        if (m) {
            m.weight = 10;
            m.importance = "high";
            m.updatedAt = Date.now();
            this.rebuildDigest();
            this.save();
        }
    }
    unpin(id) {
        const m = this.knowledge.memories.find((e) => e.id === id);
        if (m) {
            m.weight = 1;
            m.updatedAt = Date.now();
            this.rebuildDigest();
            this.save();
        }
    }
    replaceAll(memories) {
        this.knowledge.memories = memories;
        this.rebuildDigest();
        this.save();
    }
    rebuildDigest() {
        const m = this.knowledge.memories;
        if (m.length === 0) {
            this.knowledge.styleDigest = "";
            this.knowledge.updatedAt = Date.now();
            return;
        }
        const ordered = [...m].sort((a, b) => weightScore(b) - weightScore(a));
        const lines = ordered.slice(0, 12).map((mem) => {
            const tag = mem.kind === "contact" ? `${mem.key} = ${mem.value}`
                : mem.kind === "preference" ? `prefers ${mem.value}`
                    : `${mem.key}: ${mem.value}`;
            return `  - ${tag}`;
        });
        this.knowledge.styleDigest = `What you know about the user:\n` + lines.join("\n");
        this.knowledge.updatedAt = Date.now();
    }
    decay() {
        const now = Date.now();
        const AGE_30D = 30 * 24 * 60 * 60 * 1000;
        this.knowledge.memories = this.knowledge.memories.filter((m) => {
            if (m.importance === "high")
                return true;
            const age = now - m.updatedAt;
            if (m.importance === "low" && age > AGE_30D && m.weight < 2)
                return false;
            return true;
        });
        this.save();
    }
}
exports.MemoryBrain = MemoryBrain;
function weightScore(m) {
    const base = m.importance === "high" ? 1000 : m.importance === "medium" ? 100 : 10;
    return base + m.weight * 10;
}
//# sourceMappingURL=memory-brain.js.map