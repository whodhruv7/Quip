// Shared renderer types.

export type QuipAPI = {
  moveWindow: (dx: number, dy: number) => void;
  getWindowPosition: () => Promise<{ x: number; y: number } | null>;
  chatSend: (payload: {
    requestId: string;
    history: { role: "user" | "assistant"; content: string }[];
  }) => Promise<{ ok: boolean }>;
  onChatChunk: (cb: (delta: string) => void) => () => void;
  onChatDone: (cb: (full: string) => void) => () => void;
  onChatError: (
    cb: (err: { message: string; kind: string }) => void
  ) => () => void;
};

declare global {
  interface Window {
    quip: QuipAPI;
  }
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: number;
  streaming?: boolean;
  error?: boolean;
  companionId?: CompanionId;
}

export type PixState =
  | "idle"
  | "hover"
  | "thinking"
  | "responding"
  | "sleeping";

export type CompanionId = "pix" | "kai" | "zee";

/** A saved chat session for history viewing */
export interface ChatSession {
  id: string;
  companionId: CompanionId;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  title?: string;
}
