// Quip V2 — preload
//
// Exposes a complete bridge to the renderer for all brain layers.
// API keys never leave main — the renderer only asks main to do things.

import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "./shared";
import type {
  ChatSendPayload,
  TaskExecutePayload,
  WindowMode,
} from "./shared";

const api = {
  // ─── Window movement ─────────────────────────────────────────────────
  moveWindow: (dx: number, dy: number) =>
    ipcRenderer.send(IPC.MOVE_WINDOW, { dx, dy }),
  getWindowPosition: () =>
    ipcRenderer.invoke(IPC.GET_WINDOW_POSITION) as Promise<{
      x: number;
      y: number;
    } | null>,

  // ─── Window modes: companion sprite → small panel → full app ────────
  setWindowMode: (mode: WindowMode) =>
    ipcRenderer.invoke(IPC.WINDOW_MODE_SET, mode) as Promise<boolean>,
  getWindowMode: () =>
    ipcRenderer.invoke(IPC.WINDOW_MODE_GET) as Promise<WindowMode>,
  onWindowModeChanged: (cb: (mode: WindowMode) => void) => {
    const handler = (_e: unknown, mode: WindowMode) => cb(mode);
    ipcRenderer.on(IPC.WINDOW_MODE_CHANGED, handler as any);
    return () => ipcRenderer.removeListener(IPC.WINDOW_MODE_CHANGED, handler as any);
  },

  // ─── Chat streaming ──────────────────────────────────────────────────
  chatSend: (payload: ChatSendPayload) =>
    ipcRenderer.invoke(IPC.CHAT_SEND, payload),
  onChatChunk: (cb: (delta: string, requestId: string) => void) => {
    const handler = (
      _e: unknown,
      data: { requestId: string; delta: string }
    ) => cb(data.delta, data.requestId);
    ipcRenderer.on(IPC.CHAT_CHUNK, handler as any);
    return () => ipcRenderer.removeListener(IPC.CHAT_CHUNK, handler as any);
  },
  onChatDone: (cb: (full: string, requestId: string) => void) => {
    const handler = (
      _e: unknown,
      data: { requestId: string; full: string }
    ) => cb(data.full, data.requestId);
    ipcRenderer.on(IPC.CHAT_DONE, handler as any);
    return () => ipcRenderer.removeListener(IPC.CHAT_DONE, handler as any);
  },
  onChatError: (
    cb: (err: { message: string; kind: string; requestId: string }) => void
  ) => {
    const handler = (
      _e: unknown,
      data: { requestId: string; message: string; kind: string }
    ) => cb({ message: data.message, kind: data.kind, requestId: data.requestId });
    ipcRenderer.on(IPC.CHAT_ERROR, handler as any);
    return () => ipcRenderer.removeListener(IPC.CHAT_ERROR, handler as any);
  },

  // ─── Task execution ──────────────────────────────────────────────────
  executeTask: (payload: TaskExecutePayload) =>
    ipcRenderer.invoke(IPC.TASK_EXECUTE, payload),
  cancelTask: () => ipcRenderer.send(IPC.TASK_CANCEL),

  // ─── Set active companion (so the system prompt adapts personality/mood) ─
  setCompanion: (id: "pix" | "kai" | "ren" | "bubbles" | "capy" | "skales") =>
    ipcRenderer.send("quip:set-companion", id),
  
  // ─── Execution Engine V2 — Permission modes ────────────────────────
  getPermissionMode: () =>
    ipcRenderer.invoke("quip:get-permission-mode"),
  setPermissionMode: (mode: string) =>
    ipcRenderer.invoke("quip:set-permission-mode", mode),
  cyclePermissionMode: () =>
    ipcRenderer.invoke("quip:cycle-permission-mode"),
  onApprovalRequest: (cb: (request: any) => void) => {
    const handler = (_e: unknown, data: any) => cb(data);
    ipcRenderer.on("quip:approval-request", handler as any);
    return () => ipcRenderer.removeListener("quip:approval-request", handler as any);
  },
  resolveApproval: (id: string, approved: boolean) =>
    ipcRenderer.send("quip:approval-resolve", { id, approved }),
  onTaskProgress: (cb: (p: any) => void) => {
    const handler = (_e: unknown, data: any) => cb(data);
    ipcRenderer.on(IPC.TASK_PROGRESS, handler as any);
    return () => ipcRenderer.removeListener(IPC.TASK_PROGRESS, handler as any);
  },

  // ─── Device brain ────────────────────────────────────────────────────
  getDeviceProfile: () =>
    ipcRenderer.invoke(IPC.GET_DEVICE_PROFILE),
  rescanDevice: () =>
    ipcRenderer.invoke(IPC.RESCAN_DEVICE),

  // ─── Spatial brain ───────────────────────────────────────────────────
  getSpatialConfig: () =>
    ipcRenderer.invoke(IPC.GET_SPATIAL_CONFIG),
  onSpatialChange: (cb: (cfg: any) => void) => {
    const handler = (_e: unknown, data: any) => cb(data);
    ipcRenderer.on(IPC.SPATIAL_CHANGE, handler as any);
    return () => ipcRenderer.removeListener(IPC.SPATIAL_CHANGE, handler as any);
  },

  // ─── Environment brain ───────────────────────────────────────────────
  onEnvironmentChange: (cb: (env: any) => void) => {
    const handler = (_e: unknown, data: any) => cb(data);
    ipcRenderer.on(IPC.ENVIRONMENT_CHANGE, handler as any);
    return () =>
      ipcRenderer.removeListener(IPC.ENVIRONMENT_CHANGE, handler as any);
  },

  // ─── Memory brain ───────────────────────────────────────────────────
  getMemories: () =>
    ipcRenderer.invoke(IPC.GET_MEMORIES),
  forgetMemory: (id: string) =>
    ipcRenderer.invoke(IPC.FORGET_MEMORY, id),
  pinMemory: (id: string) =>
    ipcRenderer.invoke(IPC.PIN_MEMORY, id),
  pruneMemories: () =>
    ipcRenderer.invoke(IPC.PRUNE_MEMORIES),

  // ─── Knowledge graph ────────────────────────────────────────────────
  getKnowledgeGraph: () =>
    ipcRenderer.invoke(IPC.GET_KNOWLEDGE_GRAPH),
  removeEntity: (id: string) =>
    ipcRenderer.invoke(IPC.REMOVE_ENTITY, id),

  // ─── Workspace context ──────────────────────────────────────────────
  getWorkspaceContext: () =>
    ipcRenderer.invoke(IPC.GET_WORKSPACE_CONTEXT),

  // ─── Relationship engine (communication DNA) ───────────────────────
  getUserProfile: () =>
    ipcRenderer.invoke(IPC.GET_USER_PROFILE),
  resetUserProfile: () =>
    ipcRenderer.invoke(IPC.RESET_USER_PROFILE),

  // ─── Companion mood ─────────────────────────────────────────────────
  getCompanionMood: (companionId: string) =>
    ipcRenderer.invoke(IPC.GET_COMPANION_MOOD, companionId),

  // ─── Companion evolution ────────────────────────────────────────────
  getCompanionProgression: () =>
    ipcRenderer.invoke(IPC.GET_COMPANION_PROGRESSION),
  onCosmeticUnlock: (cb: (unlock: any) => void) => {
    const handler = (_e: unknown, data: any) => cb(data);
    ipcRenderer.on(IPC.ON_COSMETIC_UNLOCK, handler as any);
    return () =>
      ipcRenderer.removeListener(IPC.ON_COSMETIC_UNLOCK, handler as any);
  },

  // ─── Model router ────────────────────────────────────────────────────
  getModelStatus: () =>
    ipcRenderer.invoke(IPC.GET_MODEL_STATUS),
  saveModelKeys: (payload: { provider: "openrouter" | "groq"; apiKey: string; model?: string }) =>
    ipcRenderer.invoke(IPC.SAVE_MODEL_KEYS, payload) as Promise<{
      ok: boolean;
      masked: string;
      message: string;
    }>,
  testModelConnection: (payload: { provider: "openrouter" | "groq"; apiKey?: string; model?: string }) =>
    ipcRenderer.invoke(IPC.TEST_MODEL_CONNECTION, payload) as Promise<{
      ok: boolean;
      latencyMs: number;
      message: string;
      kind: string;
    }>,
  resolveProvider: () =>
    ipcRenderer.invoke(IPC.RESOLVE_PROVIDER) as Promise<
      Array<{ provider: "openrouter" | "groq"; configured: boolean; ok: boolean; latencyMs: number; message: string; kind: string; model: string }>
    >,

  // ─── Companion visibility + real quit ────────────────────────────────
  getCompanionVisible: () =>
    ipcRenderer.invoke(IPC.GET_COMPANION_VISIBLE) as Promise<boolean>,
  setCompanionVisible: (visible: boolean) =>
    ipcRenderer.invoke(IPC.SET_COMPANION_VISIBLE, visible) as Promise<boolean>,
  onCompanionVisibleChanged: (cb: (visible: boolean) => void) => {
    const handler = (_e: unknown, visible: boolean) => cb(visible);
    ipcRenderer.on(IPC.COMPANION_VISIBLE_CHANGED, handler as any);
    return () => ipcRenderer.removeListener(IPC.COMPANION_VISIBLE_CHANGED, handler as any);
  },
  quitApp: () => ipcRenderer.send(IPC.QUIT_APP),

  // ─── Proactive check-ins toggle (Settings → Desktop) ─────────────────
  getCheckInsEnabled: () =>
    ipcRenderer.invoke(IPC.GET_CHECKINS_ENABLED) as Promise<boolean>,
  setCheckInsEnabled: (enabled: boolean) =>
    ipcRenderer.invoke(IPC.SET_CHECKINS_ENABLED, enabled) as Promise<boolean>,

  // ─── Permission system ──────────────────────────────────────────────
  getPermissions: () =>
    ipcRenderer.invoke(IPC.GET_PERMISSIONS),
  updatePermission: (capability: string, granted: boolean) =>
    ipcRenderer.invoke(IPC.UPDATE_PERMISSION, { capability, granted }),

  // ─── Bootstrap ────────────────────────────────────────────────────────
  onBootstrapProgress: (cb: (p: any) => void) => {
    const handler = (_e: unknown, data: any) => cb(data);
    ipcRenderer.on(IPC.BOOTSTRAP_PROGRESS, handler as any);
    return () =>
      ipcRenderer.removeListener(IPC.BOOTSTRAP_PROGRESS, handler as any);
  },

  // ─── Phase 2: Communication DNA ──────────────────────────────────────
  getCommunicationDNA: () =>
    ipcRenderer.invoke(IPC.GET_COMMUNICATION_DNA),

  // ─── Phase 2: Proactive Suggestions ──────────────────────────────────
  onProactiveSuggestion: (cb: (suggestion: any) => void) => {
    const handler = (_e: unknown, data: any) => cb(data);
    ipcRenderer.on(IPC.PROACTIVE_SUGGESTION, handler as any);
    return () => ipcRenderer.removeListener(IPC.PROACTIVE_SUGGESTION, handler as any);
  },
  dismissProactive: () =>
    ipcRenderer.send(IPC.DISMISS_PROACTIVE),

  // ─── Phase 2: Weekly Reflection ──────────────────────────────────────
  getWeeklyDigest: () =>
    ipcRenderer.invoke(IPC.GET_WEEKLY_DIGEST),
  triggerWeeklyReflection: () =>
    ipcRenderer.invoke(IPC.TRIGGER_WEEKLY_REFLECTION),
  recordReflectionFeedback: (feedback: string) =>
    ipcRenderer.invoke(IPC.RECORD_REFLECTION_FEEDBACK, { feedback }),

  // ─── Phase 3: Swarm Mode ─────────────────────────────────────────────
  spawnCompanion: (companionId: "pix" | "kai" | "ren" | "bubbles" | "capy" | "skales", headless?: boolean, autoTask?: string) =>
    ipcRenderer.invoke(IPC.SPAWN_COMPANION, { companionId, headless, autoTask }),
  dismissCompanion: (winId: number) =>
    ipcRenderer.invoke(IPC.DISMISS_COMPANION, { winId }),
  getSwarmInstances: () =>
    ipcRenderer.invoke(IPC.GET_SWARM_INSTANCES),
  sendInterCompanionMsg: (to: "pix" | "kai" | "ren" | "bubbles" | "capy" | "skales", message: string) =>
    ipcRenderer.send(IPC.INTER_COMPANION_MSG, { to, message }),
  onInterCompanionMsg: (cb: (msg: { from: string; to: string; message: string }) => void) => {
    const handler = (_e: unknown, data: any) => cb(data);
    ipcRenderer.on(IPC.INTER_COMPANION_MSG, handler as any);
    return () => ipcRenderer.removeListener(IPC.INTER_COMPANION_MSG, handler as any);
  },
  onAutoTask: (cb: (payload: { task: string }) => void) => {
    const handler = (_e: unknown, data: any) => cb(data);
    ipcRenderer.on(IPC.AUTO_TASK, handler as any);
    return () => ipcRenderer.removeListener(IPC.AUTO_TASK, handler as any);
  },
};


contextBridge.exposeInMainWorld("quip", api);

export type QuipAPI = typeof api;
