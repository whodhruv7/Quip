// Quip V0.1 — IPC channel names + shared types
// Kept in a single file so main process and renderer stay in sync.

export const IPC = {
  // Window movement
  MOVE_WINDOW: "quip:move-window",
  GET_WINDOW_POSITION: "quip:get-window-position",
  // Chat (OpenRouter streaming)
  CHAT_SEND: "quip:chat-send",
  CHAT_CHUNK: "quip:chat-chunk",
  CHAT_DONE: "quip:chat-done",
  CHAT_ERROR: "quip:chat-error",
  // Act mode - execute safe commands
  ACT_EXECUTE: "quip:act-execute",
  ACT_RESULT: "quip:act-result",
  ACT_ERROR: "quip:act-error",
} as const;

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: number;
}

export interface ChatSendPayload {
  /** caller-provided id so streamed chunks can be matched back */
  requestId: string;
  /** full history (most recent last) to send as context */
  history: { role: "user" | "assistant"; content: string }[];
}

export interface ChatChunkPayload {
  requestId: string;
  delta: string;
}

export interface ChatDonePayload {
  requestId: string;
  full: string;
}

export interface ChatErrorPayload {
  requestId: string;
  message: string;
  kind: "no-key" | "http" | "network" | "parse";
}

export interface ActExecutePayload {
  requestId: string;
  command: string;
}

export interface ActResultPayload {
  requestId: string;
  success: boolean;
  output?: string;
}

export interface ActErrorPayload {
  requestId: string;
  message: string;
}
