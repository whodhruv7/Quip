
import { CompanionId } from "./chat";
import { TaskResultPayload, TaskProgress, ConfirmationRequest } from "./tasks";
import { DeviceProfile } from "./device";
import { SpatialConfig, EnvironmentState, BootstrapProgress } from "./other";
import { UserKnowledge } from "./memory";
import { ModelRouterStatus } from "./models";
import { PermissionRule } from "./permissions";
import { CapabilityId } from "./capabilities";

export interface WindowAPI {
  moveWindow: (dx: number, dy: number) => void;
  getWindowPosition: () => Promise<{ x: number; y: number } | null>;
}

export interface ChatAPI {
  chatSend: (payload: { requestId: string; history: { role: "user" | "assistant"; content: string }[]; }) => Promise<{ ok: boolean }>;
  onChatChunk: (cb: (delta: string, requestId: string) => void) => () => void;
  onChatDone: (cb: (full: string, requestId: string) => void) => () => void;
  onChatError: (cb: (err: { message: string; kind: string; requestId: string }) => void) => () => void;
  setCompanion: (id: CompanionId) => void;
}

export interface TaskAPI {
  executeTask: (payload: { requestId: string; command: string; }) => Promise<TaskResultPayload>;
  onTaskProgress: (cb: (p: TaskProgress) => void) => () => void;
  onConfirmationRequest: (cb: (req: ConfirmationRequest) => void) => () => void;
  resolveConfirmation: (id: string, approved: boolean) => void;
}

export interface PermissionAPI {
  getPermissionMode: () => Promise<{ mode: string; label: string }>;
  setPermissionMode: (mode: string) => Promise<{ mode: string; label: string }>;
  cyclePermissionMode: () => Promise<{ mode: string; label: string }>;
  onApprovalRequest: (cb: (request: unknown) => void) => () => void;
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

export type QuipAPI = WindowAPI & ChatAPI & TaskAPI & PermissionAPI & DeviceAPI & SystemAPI;

declare global {
  interface Window {
    quip: QuipAPI;
  }
}
