
import { CompanionId } from "./chat";
import type { WindowMode } from "../../electron/shared";
import { TaskResultPayload, TaskProgress } from "./tasks";
import { DeviceProfile } from "./device";
import { SpatialConfig, EnvironmentState, BootstrapProgress } from "./other";
import { UserKnowledge } from "./memory";
import { ModelRouterStatus } from "./models";
import { PermissionRule } from "./permissions";
import { CapabilityId } from "./capabilities";

/** Compact approval request shown in the inline panel above the chat input. */
export interface ApprovalRequestUI {
  id: string;
  title: string;
  steps: string[];
  mode: string;
  risk?: "safe" | "medium" | "dangerous";
  timestamp: number;
}

export interface WindowAPI {
  moveWindow: (dx: number, dy: number) => void;
  getWindowPosition: () => Promise<{ x: number; y: number } | null>;
  setWindowMode: (mode: WindowMode) => Promise<boolean>;
  getWindowMode: () => Promise<WindowMode>;
  onWindowModeChanged: (cb: (mode: WindowMode) => void) => () => void;
}

export interface ChatAPI {
  chatSend: (payload: { requestId: string; history: { role: "user" | "assistant"; content: string }[]; }) => Promise<{ ok: boolean }>;
  onChatChunk: (cb: (delta: string, requestId: string) => void) => () => void;
  onChatDone: (cb: (full: string, requestId: string, meta?: { provider?: string; switched?: boolean }) => void) => () => void;
  onChatError: (cb: (err: { message: string; kind: string; requestId: string }) => void) => () => void;
  setCompanion: (id: CompanionId) => void;
}

export interface TaskAPI {
  executeTask: (payload: { requestId: string; command: string; }) => Promise<TaskResultPayload>;
  onTaskProgress: (cb: (p: TaskProgress) => void) => () => void;
  cancelTask: () => void;
  onProactiveSuggestion: (cb: (s: { trigger: string; message: string; actionLabel?: string; actionId?: string; timestamp: number }) => void) => () => void;
}

export interface PermissionAPI {
  getPermissionMode: () => Promise<{ mode: string; label: string }>;
  setPermissionMode: (mode: string) => Promise<{ mode: string; label: string }>;
  cyclePermissionMode: () => Promise<{ mode: string; label: string }>;
  onApprovalRequest: (cb: (request: ApprovalRequestUI) => void) => () => void;
  resolveApproval: (id: string, approved: boolean) => void;
  getPermissions: () => Promise<PermissionRule[]>;
  updatePermission: (capability: CapabilityId, granted: boolean) => Promise<void>;
}

export interface DeviceAPI {
  getDeviceProfile: () => Promise<DeviceProfile | null>;
  rescanDevice: () => Promise<DeviceProfile | null>;
  getSpatialConfig: () => Promise<SpatialConfig | null>;
  onSpatialChange: (cb: (cfg: SpatialConfig) => void) => () => void;
  onEnvironmentChange: (cb: (env: EnvironmentState) => void) => () => void;
}

export interface SystemAPI {
  getMemories: () => Promise<UserKnowledge | null>;
  forgetMemory: (id: string) => Promise<void>;
  pinMemory: (id: string) => Promise<void>;
  pruneMemories: () => Promise<{ total: number; pruned: number; retained: number }>;
  getKnowledgeGraph: () => Promise<unknown | null>;
  removeEntity: (id: string) => Promise<void>;
  getWorkspaceContext: () => Promise<unknown | null>;
  getUserProfile: () => Promise<unknown | null>;
  resetUserProfile: () => Promise<void>;
  getCompanionMood: (companionId: CompanionId) => Promise<unknown | null>;
  getCompanionProgression: () => Promise<unknown | null>;
  onCosmeticUnlock: (cb: (unlock: unknown) => void) => () => void;
  getModelStatus: () => Promise<ModelRouterStatus | null>;
  onBootstrapProgress: (cb: (p: BootstrapProgress) => void) => () => void;
}

export type ProviderIdUI = "openrouter" | "groq" | "cerebras" | "nvidia";

export interface ModelSetupAPI {
  saveModelKeys: (payload: {
    provider: ProviderIdUI;
    apiKey?: string;
    model?: string;
  }) => Promise<{ ok: boolean; masked: string; message: string }>;
  testModelConnection: (payload: {
    provider: ProviderIdUI;
    apiKey?: string;
    model?: string;
  }) => Promise<{ ok: boolean; latencyMs: number; message: string; kind: string }>;
  resolveProvider: () => Promise<
    Array<{ provider: ProviderIdUI; configured: boolean; ok: boolean; latencyMs: number; message: string; kind: string; model: string }>
  >;
  listProviderModels: (payload: {
    provider: ProviderIdUI;
    apiKey?: string;
  }) => Promise<{ ok: boolean; models: Array<{ id: string; ownedBy?: string }>; message: string }>;
  getProviderConfig: () => Promise<{
    primary: ProviderIdUI;
    enabled: Record<string, boolean>;
    visionModel: string | null;
    chain: string[];
  }>;
  setProviderConfig: (payload: {
    primary: ProviderIdUI;
    enabled: Record<string, boolean>;
  }) => Promise<{ ok: boolean; message: string; active?: string }>;
}

export interface SpeechAPI {
  ttsSpeak: (payload: { requestId?: string; text: string }) => Promise<{ ok: boolean; engine: string; message: string }>;
  ttsStop: () => void;
  onTtsAudio: (cb: (data: { requestId: string; engine: string; audioBase64: string; mime: string }) => void) => () => void;
  getSpeakConfig: () => Promise<{
    enabled: boolean;
    engine: "auto" | "groq" | "local";
    voice: string;
    localVoice: string;
    platform: string;
  }>;
  setSpeakConfig: (payload: {
    enabled?: boolean;
    engine?: "auto" | "groq" | "local";
    voice?: string;
    localVoice?: string;
  }) => Promise<{ ok: boolean; message: string }>;
}

export interface LifecycleAPI {
  getCompanionVisible: () => Promise<boolean>;
  setCompanionVisible: (visible: boolean) => Promise<boolean>;
  onCompanionVisibleChanged: (cb: (visible: boolean) => void) => () => void;
  getCheckInsEnabled: () => Promise<boolean>;
  setCheckInsEnabled: (enabled: boolean) => Promise<boolean>;
  quitApp: () => void;
}

export type QuipAPI = WindowAPI & ChatAPI & TaskAPI & PermissionAPI & DeviceAPI & SystemAPI & ModelSetupAPI & SpeechAPI & LifecycleAPI;

declare global {
  interface Window {
    quip: QuipAPI;
  }
}
