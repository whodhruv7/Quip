
export type MemoryImportance = "high" | "medium" | "low";
export type MemoryKind = "contact" | "preference" | "fact" | "style";

export interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  key: string;
  value: string;
  importance: MemoryImportance;
  weight: number;
  createdAt: number;
  updatedAt: number;
}

export interface UserKnowledge {
  schemaVersion: number;
  memories: MemoryEntry[];
  styleDigest: string;
  updatedAt: number;
}
