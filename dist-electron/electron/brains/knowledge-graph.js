"use strict";
// Quip V2 — PERSONAL KNOWLEDGE GRAPH
// -----------------------------------------------------------------------------
// Models the user's world as a graph: people, organizations, projects, skills,
// interests — and the relationships between them. Built incrementally from
// conversation-extracted facts. When the user says "email my boss," the graph
// traversal gives Quip: boss → Rajesh Gupta → communication style → formal.
//
// Storage: JSON file in userData (V1). Future: SQLite for query performance.
// -----------------------------------------------------------------------------
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.knowledgeGraph = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const FILENAME = "knowledge-graph.json";
const SCHEMA_VERSION = 1;
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
class KnowledgeGraphBrain {
    graph = {
        schemaVersion: SCHEMA_VERSION,
        entities: [],
        links: [],
        updatedAt: 0,
    };
    filePath = null;
    userEntityId = null;
    init(userDataDir) {
        this.filePath = node_path_1.default.join(userDataDir, FILENAME);
        this.load();
        this.ensureUserNode();
    }
    load() {
        if (!this.filePath)
            return;
        try {
            if (node_fs_1.default.existsSync(this.filePath)) {
                const data = JSON.parse(node_fs_1.default.readFileSync(this.filePath, "utf8"));
                if (data && Array.isArray(data.entities)) {
                    this.graph = data;
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
            this.graph.updatedAt = Date.now();
            node_fs_1.default.writeFileSync(this.filePath, JSON.stringify(this.graph, null, 2));
        }
        catch {
            /* best effort */
        }
    }
    /** Ensure the "user" entity always exists as the graph root. */
    ensureUserNode() {
        let user = this.graph.entities.find((e) => e.type === "person" && e.attributes.isSelf === true);
        if (!user) {
            user = {
                id: uid(),
                type: "person",
                name: "User",
                attributes: { isSelf: true },
                importance: 1.0,
                createdAt: Date.now(),
                lastMentionedAt: Date.now(),
                mentionCount: 0,
            };
            this.graph.entities.push(user);
            this.save();
        }
        this.userEntityId = user.id;
    }
    /** Find or create an entity by name + type. */
    upsertEntity(type, name, attributes, importance) {
        const existing = this.graph.entities.find((e) => e.type === type && e.name.toLowerCase() === name.toLowerCase());
        if (existing) {
            existing.attributes = { ...existing.attributes, ...attributes };
            existing.lastMentionedAt = Date.now();
            existing.mentionCount += 1;
            if (importance !== undefined)
                existing.importance = importance;
            this.save();
            return existing;
        }
        const entity = {
            id: uid(),
            type,
            name,
            attributes: attributes ?? {},
            importance: importance ?? 0.5,
            createdAt: Date.now(),
            lastMentionedAt: Date.now(),
            mentionCount: 1,
        };
        this.graph.entities.push(entity);
        this.save();
        return entity;
    }
    /** Create or reinforce a link between two entities. */
    link(source, target, relation, weight = 1.0) {
        const existing = this.graph.links.find((l) => l.sourceId === source.id &&
            l.targetId === target.id &&
            l.relation === relation);
        if (existing) {
            existing.weight = Math.min(1, existing.weight + 0.1);
            this.save();
            return;
        }
        this.graph.links.push({
            sourceId: source.id,
            targetId: target.id,
            relation,
            weight,
            createdAt: Date.now(),
        });
        this.save();
    }
    /** Convenience: link the user to an entity with a relation. */
    linkToUser(entity, relation, weight = 1.0) {
        if (!this.userEntityId)
            return;
        const user = this.graph.entities.find((e) => e.id === this.userEntityId);
        if (!user)
            return;
        this.link(user, entity, relation, weight);
    }
    /** Find entities by name (fuzzy, case-insensitive). */
    findEntities(query) {
        const q = query.toLowerCase();
        return this.graph.entities.filter((e) => e.name.toLowerCase().includes(q) ||
            Object.values(e.attributes).some((v) => String(v).toLowerCase().includes(q)));
    }
    /** Get all entities related to the user with a specific relation. */
    getUserRelations(relation) {
        if (!this.userEntityId)
            return [];
        const links = this.graph.links.filter((l) => l.sourceId === this.userEntityId &&
            (relation ? l.relation === relation : true));
        return links
            .map((l) => this.graph.entities.find((e) => e.id === l.targetId))
            .filter((e) => e !== undefined);
    }
    /** Get the subgraph around a given entity (1-hop neighbors). */
    getSubgraph(entityId) {
        const links = this.graph.links.filter((l) => l.sourceId === entityId || l.targetId === entityId);
        const entityIds = new Set();
        links.forEach((l) => {
            entityIds.add(l.sourceId);
            entityIds.add(l.targetId);
        });
        entityIds.add(entityId);
        const entities = this.graph.entities.filter((e) => entityIds.has(e.id));
        return { entities, links };
    }
    /** Get a compact summary for the system prompt. */
    getPromptSummary(maxEntities = 8) {
        if (this.graph.entities.length <= 1)
            return "";
        const sorted = [...this.graph.entities]
            .filter((e) => !e.attributes.isSelf)
            .sort((a, b) => b.mentionCount - a.mentionCount)
            .slice(0, maxEntities);
        if (sorted.length === 0)
            return "";
        const lines = sorted.map((e) => {
            const rels = this.graph.links
                .filter((l) => l.targetId === e.id || l.sourceId === e.id)
                .map((l) => l.relation);
            const relStr = rels.length > 0 ? ` (${[...new Set(rels)].join(", ")})` : "";
            const attrs = Object.entries(e.attributes)
                .filter(([k]) => k !== "isSelf")
                .map(([k, v]) => `${k}=${v}`)
                .join(", ");
            return `  - ${e.name} [${e.type}]${relStr}${attrs ? ` {${attrs}}` : ""}`;
        });
        return `Known entities in user's world:\n${lines.join("\n")}`;
    }
    /** Remove an entity and all its links. */
    removeEntity(id) {
        this.graph.entities = this.graph.entities.filter((e) => e.id !== id);
        this.graph.links = this.graph.links.filter((l) => l.sourceId !== id && l.targetId !== id);
        this.save();
    }
    get() {
        return {
            ...this.graph,
            entities: [...this.graph.entities],
            links: [...this.graph.links],
        };
    }
}
exports.knowledgeGraph = new KnowledgeGraphBrain();
//# sourceMappingURL=knowledge-graph.js.map