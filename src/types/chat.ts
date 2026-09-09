
export type PixState =
  | "idle"
  | "hover"
  | "thinking"
  | "responding"
  | "sleeping"
  /** executing a multi-step task — engaged, determined */
  | "working"
  /** waiting for the user to approve a plan */
  | "waiting"
  /** brief happy flash after a verified success */
  | "success"
  /** brief concerned flash after a failure */
  | "error";
export type CompanionId = "pix" | "kai" | "ren" | "bubbles" | "capy" | "ivy";

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
  proactive?: boolean;
}

export interface ChatSession {
  id: string;
  companionId: CompanionId;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  title?: string;
}
