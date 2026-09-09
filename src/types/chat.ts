
export type PixState =
  | "idle"
  | "hover"
  | "thinking"
  | "responding"
  | "sleeping"
  /** resolving the task into steps — before the first action runs */
  | "planning"
  /** executing a multi-step task — engaged, determined */
  | "working"
  /** reading the screen / page / results — honest observation */
  | "observing"
  /** double-checking an action's result before reporting success */
  | "verifying"
  /** waiting for the user to approve a plan */
  | "waiting"
  /** brief happy flash after a verified success */
  | "success"
  /** brief concerned flash after a failure */
  | "error"
  /** brief droop after the user cancels a task */
  | "cancelled";
export type CompanionId = "pix" | "kai" | "ren" | "bubbles" | "capy" | "skales";

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
