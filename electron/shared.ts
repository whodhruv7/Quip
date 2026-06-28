// Quip V2 — IPC channel names + shared types.
// Kept in a single file so main process and renderer stay in sync.

export const IPC = {
  // Window movement
  MOVE_WINDOW: "quip:move-window",
  GET_WINDOW_POSITION: "quip:get-window-position",

  // Chat streaming
  CHAT_SEND: "quip:chat-send",
  CHAT_CHUNK: "quip:chat-chunk",
  CHAT_DONE: "quip:chat-done",
  CHAT_ERROR: "quip:chat-error",

  // Task execution
  TASK_EXECUTE: "quip:task-execute",
  TASK_PROGRESS: "quip:task-progress",
  CONFIRMATION_REQUEST: "quip:confirmation-request",
  CONFIRMATION_RESOLVE: "quip:confirmation-resolve",

  // Device brain
  GET_DEVICE_PROFILE: "quip:get-device-profile",
  RESCAN_DEVICE: "quip:rescan-device",

  // Spatial brain
  GET_SPATIAL_CONFIG: "quip:get-spatial-config",
  SPATIAL_CHANGE: "quip:spatial-change",

  // Environment brain
  ENVIRONMENT_CHANGE: "quip:environment-change",

  // Memory brain
  GET_MEMORIES: "quip:get-memories",
  FORGET_MEMORY: "quip:forget-memory",
  PIN_MEMORY: "quip:pin-memory",
  PRUNE_MEMORIES: "quip:prune-memories",

  // Knowledge graph
  GET_KNOWLEDGE_GRAPH: "quip:get-knowledge-graph",
  REMOVE_ENTITY: "quip:remove-entity",

  // Workspace context
  GET_WORKSPACE_CONTEXT: "quip:get-workspace-context",

  // Relationship engine (user profile / communication DNA)
  GET_USER_PROFILE: "quip:get-user-profile",
  RESET_USER_PROFILE: "quip:reset-user-profile",

  // Companion mood
  GET_COMPANION_MOOD: "quip:get-companion-mood",

  // Companion evolution
  GET_COMPANION_PROGRESSION: "quip:get-companion-progression",
  ON_COSMETIC_UNLOCK: "quip:cosmetic-unlock",

  // Model router
  GET_MODEL_STATUS: "quip:get-model-status",

  // Permission system
  GET_PERMISSIONS: "quip:get-permissions",
  UPDATE_PERMISSION: "quip:update-permission",

  // Bootstrap
  BOOTSTRAP_PROGRESS: "quip:bootstrap-progress",

  // Phase 2 — Proactive Suggestions
  PROACTIVE_SUGGESTION: "quip:proactive-suggestion",
  DISMISS_PROACTIVE: "quip:dismiss-proactive",

  // Phase 2 — Weekly Reflection
  GET_WEEKLY_DIGEST: "quip:get-weekly-digest",
  RECORD_REFLECTION_FEEDBACK: "quip:record-reflection-feedback",
  TRIGGER_WEEKLY_REFLECTION: "quip:trigger-weekly-reflection",

  // Phase 2 — Communication DNA
  GET_COMMUNICATION_DNA: "quip:get-communication-dna",

  // Phase 3 — Swarm Mode (Multi-Instance)
  SPAWN_COMPANION: "quip:spawn-companion",
  DISMISS_COMPANION: "quip:dismiss-companion",
  GET_SWARM_INSTANCES: "quip:get-swarm-instances",
  INTER_COMPANION_MSG: "quip:inter-companion-msg",
  AUTO_TASK: "quip:auto-task",
  SWARM_BROADCAST: "quip:swarm-broadcast",
} as const;

// ─── Chat payloads ─────────────────────────────────────────────────────────
export interface ChatSendPayload {
  requestId: string;
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

// ─── Task payloads ─────────────────────────────────────────────────────────
export interface TaskExecutePayload {
  requestId: string;
  command: string;
}

export interface TaskProgressPayload {
  requestId: string;
  step: number;
  total: number;
  description: string;
}

export interface TaskResultPayload {
  requestId: string;
  success: boolean;
  summary: string;
  notes: string[];
  plan: {
    id: string;
    intent: { type: string; raw: string };
    subtasks: { id: string; description: string; status: string; output?: string }[];
    isChat: boolean;
  };
}

export interface ConfirmationPayload {
  id: string;
  requestId: string;
  description: string;
  capability: string;
}

export interface ConfirmationResolvePayload {
  id: string;
  approved: boolean;
}

// ─── Phase 2 payloads ──────────────────────────────────────────────────────

export interface ProactiveSuggestionPayload {
  trigger: string;
  message: string;
  actionLabel?: string;
  actionId?: string;
  timestamp: number;
}

export interface WeeklyDigestPayload {
  conversationCount: number;
  taskCount: number;
  memoriesFormed: number;
  topTopics: string[];
  highlights: string[];
  naturalSummary: string;
  askFeedback: string;
}

export interface ReflectionFeedbackPayload {
  feedback: string;
}

export interface CommunicationDNAPayload {
  toneLabel: string;
  preferredLength: string;
  usesEmoji: boolean;
  prefersCode: boolean;
  styleFacts: string[];
}

// ─── Phase 3 payloads ──────────────────────────────────────────────────────

export interface SpawnCompanionPayload {
  companionId: "pix" | "kai" | "ren";
  headless?: boolean;
  autoTask?: string;
}

export interface SwarmInstance {
  winId: number;
  companionId: "pix" | "kai" | "ren";
  headless: boolean;
  spawnedAt: number;
  label: string;
}

export interface InterCompanionMsgPayload {
  from: "pix" | "kai" | "ren";
  to: "pix" | "kai" | "ren";
  message: string;
}

