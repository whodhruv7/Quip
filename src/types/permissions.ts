
import { CapabilityId } from "./capabilities";

export type PermissionLevel = "safe" | "medium" | "dangerous";

export interface PermissionRule {
  capability: CapabilityId;
  level: PermissionLevel;
  granted: boolean;
}

export type PermissionMode = "ask" | "task" | "full";
