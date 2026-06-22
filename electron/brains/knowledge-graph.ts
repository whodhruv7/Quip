// Quip V2 — PERSONAL KNOWLEDGE GRAPH
// -----------------------------------------------------------------------------
// Models the user's world as a graph: people, organizations, projects, skills,
// interests — and the relationships between them. Built incrementally from
// conversation-extracted facts. When the user says "email my boss," the graph
// traversal gives Quip: boss → Rajesh Gupta → communication style → formal.
//
// Storage: JSON file in userData (V1). Future: SQLite for query performance.
// -----------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";

const FILENAME = "knowledge-graph.json";
const SCHEMA_VERSION = 1;

export type EntityType =
  | "person"
  | "org"
  | "project"
  | "skill"
  | "interest"
  | "place"
  | "event";

export interface Entity {
  id: string;
  type: EntityType;
  name: string;
  attributes: Record<string, unknown>;
  importance: number; // 0-1
  createdAt: number;
  lastMentionedAt: number;
  mentionCount: number;
}

export interface EntityLink {
  sourceId: string;
  targetId: string;
  relation: string; // "knows", "works_at", "likes", "ceo_of", "member_of"
  weight: number;
  createdAt: number;
}

export interface KnowledgeGraph {
  schemaVersion: number;
  entities: Entity[];
  links: EntityLink[];
  updatedAt: number;
}

export interface Subgraph {
  entities: Entity[];
  links: EntityLink[];
}

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

class KnowledgeGraphBrain {
  private graph: KnowledgeGraph = {
    schemaVersion: SCHEMA_VERSION,
    entities: [],
    links: [],
    updatedAt: 0,
  };
  private filePath: string | null = null;
  private userEntityId: string | null = null;

  init(userDataDir: string): void {
    this.filePath = path.join(userDataDir, FILENAME);
    this.load();
    this.ensureUserNode();
  }

  private load(): void {
    if (!this.filePath) return;
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
        if (data && Array.isArray(data.entities)) {
          this.graph = data as KnowledgeGraph;
        }
      }
    } catch {
      /* start fresh */
    }
  }

  private save(): void {
    if (!this.filePath) return;
    try {
      this.graph.updatedAt = Date.now();
      fs.writeFileSync(this.filePath, JSON.stringify(this.graph, null, 2));
    } catch {
      /* best effort */
    }
  }

  /** Ensure the "user" entity always exists as the graph root. */
  private ensureUserNode(): void {
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
  upsertEntity(
    type: EntityType,
    name: string,
    attributes?: Record<string, unknown>,
    importance?: number
  ): Entity {
    const existing = this.graph.entities.find(
      (e) => e.type === type && e.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) {
      existing.attributes = { ...existing.attributes, ...attributes };
      existing.lastMentionedAt = Date.now();
      existing.mentionCount += 1;
      if (importance !== undefined) existing.importance = importance;
      this.save();
      return existing;
    }
    const entity: Entity = {
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
  link(
    source: Entity,
    target: Entity,
    relation: string,
    weight = 1.0
  ): void {
    const existing = this.graph.links.find(
      (l) =>
        l.sourceId === source.id &&
        l.targetId === target.id &&
        l.relation === relation
    );
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
  linkToUser(entity: Entity, relation: string, weight = 1.0): void {
    if (!this.userEntityId) return;
    const user = this.graph.entities.find((e) => e.id === this.userEntityId);
    if (!user) return;
    this.link(user, entity, relation, weight);
  }

  /** Find entities by name (fuzzy, case-insensitive). */
  findEntities(query: string): Entity[] {
    const q = query.toLowerCase();
    return this.graph.entities.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        Object.values(e.attributes).some((v) =>
          String(v).toLowerCase().includes(q)
        )
    );
  }

  /** Get all entities related to the user with a specific relation. */
  getUserRelations(relation?: string): Entity[] {
    if (!this.userEntityId) return [];
    const links = this.graph.links.filter(
      (l) =>
        l.sourceId === this.userEntityId &&
        (relation ? l.relation === relation : true)
    );
    return links
      .map((l) => this.graph.entities.find((e) => e.id === l.targetId))
      .filter((e): e is Entity => e !== undefined);
  }

  /** Get the subgraph around a given entity (1-hop neighbors). */
  getSubgraph(entityId: string): Subgraph {
    const links = this.graph.links.filter(
      (l) => l.sourceId === entityId || l.targetId === entityId
    );
    const entityIds = new Set<string>();
    links.forEach((l) => {
      entityIds.add(l.sourceId);
      entityIds.add(l.targetId);
    });
    entityIds.add(entityId);
    const entities = this.graph.entities.filter((e) => entityIds.has(e.id));
    return { entities, links };
  }

  /** Get a compact summary for the system prompt. */
  getPromptSummary(maxEntities = 8): string {
    if (this.graph.entities.length <= 1) return "";
    const sorted = [...this.graph.entities]
      .filter((e) => !e.attributes.isSelf)
      .sort((a, b) => b.mentionCount - a.mentionCount)
      .slice(0, maxEntities);

    if (sorted.length === 0) return "";

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
  removeEntity(id: string): void {
    this.graph.entities = this.graph.entities.filter((e) => e.id !== id);
    this.graph.links = this.graph.links.filter(
      (l) => l.sourceId !== id && l.targetId !== id
    );
    this.save();
  }

  get(): KnowledgeGraph {
    return {
      ...this.graph,
      entities: [...this.graph.entities],
      links: [...this.graph.links],
    };
  }
}

export const knowledgeGraph = new KnowledgeGraphBrain();
