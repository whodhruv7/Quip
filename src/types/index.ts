// Quip V2 — Complete type system for all brain layers.

// ─── Platform ────────────────────────────────────────────────────────────────
export type Platform = "win32" | "darwin" | "linux";
export type AppCategory = "browser" | "editor" | "music" | "mail" | "terminal" | "system" | "notes";

// ─── Device Profile ─────────────────────────────────────────────────────────
export interface InstalledApp {
  id: string;
  name: string;
  category: AppCategory;
  launchId?: string;
}

export interface DisplayInfo {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  isPrimary: boolean;
  rotation: number;
}

export interface DeviceProfile {
  schemaVersion: number;
  scannedAt: number;
  scanDurationMs: number;

  platform: Platform;
  platformLabel: string;
  osVersion: string;
  osRelease: string;
  hostname: string;
  arch: string;

  cpuModel: string;
  cpuCores: number;
  totalMemoryGB: number;
  freeMemoryGB: number;

  storage: { totalGB: number; freeGB: number; usedGB: number };

  displays: DisplayInfo[];
  primaryDisplay: DisplayInfo;
  monitorCount: number;
  primaryResolution: { width: number; height: number };
  scaleFactor: number;

  locale: string;
  language: string;
  theme: "light" | "dark" | "unknown";

  apps: InstalledApp[];
  defaultBrowser: string | null;
  defaultMailApp: string | null;
  defaultEditor: string | null;
  defaultTerminal: string | null;

  browsers: { name: string; id: string }[];
  editors: { name: string; id: string }[];
  musicApps: { name: string; id: string }[];
  mailApps: { name: string; id: string }[];
  terminals: { name: string; id: string }[];

  taskbar: { edge: "bottom" | "top" | "left" | "right"; height: number };
}

// ─── World Model ───────────────────────────────────────────────────────────
export interface WorldModel {
  schemaVersion: number;
  generatedAt: number;
  canDo: string[];
  needsPermission: string[];
  cannotDo: string[];
  summary: string;
}

// ─── Spatial Config ─────────────────────────────────────────────────────────
export type FormFactor = "ultrawide" | "desktop" | "tablet" | "phone";

export interface SpatialConfig {
  formFactor: FormFactor;
  windowSize: { width: number; height: number };
  companion: { x: number; y: number };
  chatPanel: { x: number; y: number; width: number; height: number };
  safeMargin: number;
  layout: "floating" | "dock" | "bottom-sheet" | "overlay";
}

// ─── Environment ────────────────────────────────────────────────────────────
export interface EnvironmentState {
  battery: { supported: boolean; level: number; charging: boolean };
  network: { online: boolean; type: "wifi" | "ethernet" | "offline" };
  power: "ac" | "battery" | "unknown";
  idleSeconds: number;
  updated: number;
}

// ─── Memory ─────────────────────────────────────────────────────────────────
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

// ─── Capabilities ───────────────────────────────────────────────────────────
export type CapabilityId =
  | "openBrowser"
  | "openUrl"
  | "webSearch"
  | "launchApp"
  | "openEditor"
  | "openTerminal"
  | "openFiles"
  | "playMedia"
  | "readClipboard"
  | "openMusic"
  | "openSettings"
  | "systemControl"
  | "systemLock"
  | "systemPower"
  | "systemPrivilege"
  | "composeMail"
  | "openMail"
  | "noop";

export interface CapabilityImplementation {
  capability: CapabilityId;
  label: string;
  reason: string;
  executor: string;
  params: Record<string, unknown>;
}

export interface CapabilityResolution {
  capability: CapabilityId;
  available: boolean;
  implementation: CapabilityImplementation | null;
  fallback?: { capability?: CapabilityId; available: boolean; implementation: CapabilityImplementation } | null;
}

// ─── Task Brain ─────────────────────────────────────────────────────────────
export type IntentType =
  | "open_website"
  | "play_media"
  | "search"
  | "compose_mail"
  | "open_app"
  | "system_action"
  | "navigate"
  | "chat"
  | "unknown";

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

// ─── Permissions ────────────────────────────────────────────────────────────
export type PermissionLevel = "safe" | "medium" | "dangerous";

export interface PermissionRule {
  capability: CapabilityId;
  level: PermissionLevel;
  granted: boolean;
}

export type PermissionMode = "ask" | "task" | "full";

// ─── Bootstrap ───────────────────────────────────────────────────────────────
export type BootstrapStage =
  | "health-check"
  | "device-scan"
  | "environment"
  | "world-model"
  | "model-router"
  | "window"
  | "ready";

export interface BootstrapProgress {
  stage: BootstrapStage;
  message: string;
  progress: number;
  done: boolean;
  error: string | null;
}

// ─── Model Router ────────────────────────────────────────────────────────────
export type ModelProvider = "groq" | "openrouter" | "local";

export interface ModelConfig {
  provider: ModelProvider;
  model: string;
  label: string;
  available: boolean;
}

export interface ModelRouterStatus {
  primary: ModelConfig;
  fallback: ModelConfig | null;
  active: ModelConfig;
  healthy: boolean;
}

// ─── Chat & UI ────────────────────────────────────────────────────────────────
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: number;
  streaming?: boolean;
  error?: boolean;
  companionId?: CompanionId;
  /** Trust-layer note explaining WHY Quip did something */
  contextNote?: string;
  /** Action result for task execution */
  action?: { success: boolean; summary: string; notes: string[] };
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

// ─── Window API (preload bridge) ────────────────────────────────────────────
export type QuipAPI = {
  // Window movement
  moveWindow: (dx: number, dy: number) => void;
  getWindowPosition: () => Promise<{ x: number; y: number } | null>;

  // Chat streaming
  chatSend: (payload: {
    requestId: string;
    history: { role: "user" | "assistant"; content: string }[];
  }) => Promise<{ ok: boolean }>;
  onChatChunk: (cb: (delta: string, requestId: string) => void) => () => void;
  onChatDone: (cb: (full: string, requestId: string) => void) => () => void;
  onChatError: (cb: (err: { message: string; kind: string; requestId: string }) => void) => () => void;

  // Task execution
  executeTask: (payload: {
    requestId: string;
    command: string;
  }) => Promise<TaskResultPayload>;
  setCompanion: (id: CompanionId) => void;

  // Execution Engine V2 — Permission modes
  getPermissionMode: () => Promise<{ mode: string; label: string }>;
  setPermissionMode: (mode: string) => Promise<{ mode: string; label: string }>;
  cyclePermissionMode: () => Promise<{ mode: string; label: string }>;
  onApprovalRequest: (cb: (request: unknown) => void) => () => void;
  resolveApproval: (id: string, approved: boolean) => void;
  onTaskProgress: (cb: (p: TaskProgress) => void) => () => void;
  onConfirmationRequest: (cb: (req: ConfirmationRequest) => void) => () => void;
  resolveConfirmation: (id: string, approved: boolean) => void;

  // Device
  getDeviceProfile: () => Promise<DeviceProfile | null>;
  rescanDevice: () => Promise<DeviceProfile | null>;

  // Spatial
  getSpatialConfig: () => Promise<SpatialConfig | null>;
  onSpatialChange: (cb: (cfg: SpatialConfig) => void) => () => void;

  // Environment
  onEnvironmentChange: (cb: (env: EnvironmentState) => void) => () => void;

  // Memory
  getMemories: () => Promise<UserKnowledge | null>;
  forgetMemory: (id: string) => Promise<void>;
  pinMemory: (id: string) => Promise<void>;
  pruneMemories: () => Promise<{ total: number; pruned: number; retained: number }>;

  // Knowledge graph
  getKnowledgeGraph: () => Promise<unknown | null>;
  removeEntity: (id: string) => Promise<void>;

  // Workspace context
  getWorkspaceContext: () => Promise<unknown | null>;

  // Relationship engine
  getUserProfile: () => Promise<unknown | null>;
  resetUserProfile: () => Promise<void>;

  // Companion mood
  getCompanionMood: (companionId: CompanionId) => Promise<unknown | null>;

  // Companion evolution
  getCompanionProgression: () => Promise<unknown | null>;
  onCosmeticUnlock: (cb: (unlock: unknown) => void) => () => void;

  // Model
  getModelStatus: () => Promise<ModelRouterStatus | null>;

  // Permissions
  getPermissions: () => Promise<PermissionRule[]>;
  updatePermission: (capability: CapabilityId, granted: boolean) => Promise<void>;

  // Bootstrap
  onBootstrapProgress: (cb: (p: BootstrapProgress) => void) => () => void;
};

declare global {
  interface Window {
    quip: QuipAPI;
  }
}
