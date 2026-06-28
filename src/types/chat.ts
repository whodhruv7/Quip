
export type PixState = "idle" | "hover" | "thinking" | "responding" | "sleeping";
export type CompanionId = "pix" | "kai" | "ren";

export interface ExecutionResult {
  success: boolean;
  summary: string;
  notes: string[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: number;
  streaming?: boolean;
  error?: boolean;
  companionId?: CompanionId;
  contextNote?: string;
  action?: ExecutionResult;
}

export interface ChatSession {
  id: string;
  companionId: CompanionId;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  title?: string;
}
