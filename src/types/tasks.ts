
import { CapabilityId } from "./capabilities";

export type IntentType = "open_website" | "play_media" | "search" | "compose_mail" | "open_app" | "system_action" | "navigate" | "chat" | "unknown";

export interface ParsedIntent {
  type: IntentType;
  target: string | null;
  query: string | null;
  confidence: number;
  verbs: string[];
  raw: string;
}

export interface Subtask {
  id: string;
  step: number;
  description: string;
  capability: CapabilityId;
  params: Record<string, unknown>;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  requiresConfirmation: boolean;
  output?: string;
}

export interface TaskPlan {
  id: string;
  requestId: string;
  intent: ParsedIntent;
  subtasks: Subtask[];
  summary: string;
  isChat: boolean;
  createdAt: number;
}

export interface TaskResultPayload {
  requestId: string;
  success: boolean;
  summary: string;
  notes: string[];
  plan: TaskPlan;
}

export interface TaskProgress {
  requestId: string;
  step: number;
  total: number;
  description: string;
}

export interface ConfirmationRequest {
  id: string;
  requestId: string;
  description: string;
  capability: CapabilityId;
}
