// Quip V2 — preload
//
// Exposes a complete bridge to the renderer for all brain layers.
// API keys never leave main — the renderer only asks main to do things.

import { contextBridge, ipcRenderer, webUtils } from "electron";
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
  onChatDone: (cb: (full: string, requestId: string, meta?: { provider?: string; switched?: boolean }) => void) => {
    const handler = (
      _e: unknown,
      data: { requestId: string; full: string; provider?: string; switched?: boolean }
    ) => cb(data.full, data.requestId, { provider: data.provider, switched: data.switched });
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
  onChatProvider: (cb: (data: { provider: string; confirmed: boolean; requestId: string }) => void) => {
    const handler = (_e: unknown, data: { requestId: string; provider: string; confirmed: boolean }) =>
      cb({ provider: data.provider, confirmed: data.confirmed, requestId: data.requestId });
    ipcRenderer.on(IPC.CHAT_PROVIDER, handler as any);
    return () => ipcRenderer.removeListener(IPC.CHAT_PROVIDER, handler as any);
  },

  // ─── Task execution ──────────────────────────────────────────────────
  executeTask: (payload: TaskExecutePayload) =>
    ipcRenderer.invoke(IPC.TASK_EXECUTE, payload),
  cancelTask: () => ipcRenderer.send(IPC.TASK_CANCEL),

  // ─── Set active companion (so the system prompt adapts personality/mood) ─
  setCompanion: (id: "pix" | "kai" | "ren" | "bubbles" | "capy" | "skales") =>
    ipcRenderer.send(IPC.SET_COMPANION, id),
  
  // ─── Execution Engine V2 — Permission modes ────────────────────────
  getPermissionMode: () =>
    ipcRenderer.invoke(IPC.GET_PERMISSION_MODE),
  setPermissionMode: (mode: string) =>
    ipcRenderer.invoke(IPC.SET_PERMISSION_MODE, mode),
  cyclePermissionMode: () =>
    ipcRenderer.invoke(IPC.CYCLE_PERMISSION_MODE),
  onApprovalRequest: (cb: (request: any) => void) => {
    const handler = (_e: unknown, data: any) => cb(data);
    ipcRenderer.on("quip:approval-request", handler as any);
    return () => ipcRenderer.removeListener("quip:approval-request", handler as any);
  },
  resolveApproval: (id: string, approved: boolean) =>
    ipcRenderer.send(IPC.APPROVAL_RESOLVE, { id, approved }),
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
  saveModelKeys: (payload: { provider: "openrouter" | "groq" | "cerebras" | "nvidia" | "gemini" | "ollama"; apiKey?: string; model?: string }) =>
    ipcRenderer.invoke(IPC.SAVE_MODEL_KEYS, payload) as Promise<{
      ok: boolean;
      masked: string;
      message: string;
    }>,
  testModelConnection: (payload: { provider: "openrouter" | "groq" | "cerebras" | "nvidia" | "gemini" | "ollama"; apiKey?: string; model?: string }) =>
    ipcRenderer.invoke(IPC.TEST_MODEL_CONNECTION, payload) as Promise<{
      ok: boolean;
      latencyMs: number;
      message: string;
      kind: string;
    }>,
  resolveProvider: () =>
    ipcRenderer.invoke(IPC.RESOLVE_PROVIDER) as Promise<
      Array<{ provider: string; configured: boolean; ok: boolean; latencyMs: number; message: string; kind: string; model: string }>
    >,
  listProviderModels: (payload: { provider: "openrouter" | "groq" | "cerebras" | "nvidia" | "gemini" | "ollama"; apiKey?: string }) =>
    ipcRenderer.invoke(IPC.LIST_PROVIDER_MODELS, payload) as Promise<{
      ok: boolean;
      models: Array<{ id: string; ownedBy?: string }>;
      message: string;
    }>,
  getProviderConfig: () =>
    ipcRenderer.invoke(IPC.GET_PROVIDER_CONFIG) as Promise<{
      primary: "groq" | "openrouter" | "cerebras" | "nvidia" | "gemini" | "ollama";
      enabled: Record<string, boolean>;
      visionModel: string | null;
      chain: string[];
    }>,
  setProviderConfig: (payload: { primary: "groq" | "openrouter" | "cerebras" | "nvidia" | "gemini" | "ollama"; enabled: Record<string, boolean> }) =>
    ipcRenderer.invoke(IPC.SET_PROVIDER_CONFIG, payload) as Promise<{
      ok: boolean;
      message: string;
      active?: string;
    }>,

  // ─── Brain health + Doctor + journal + transport (V3.1) ─────────────
  getBrainHealth: () =>
    ipcRenderer.invoke(IPC.GET_BRAIN_HEALTH) as Promise<any>,
  onBrainHealth: (cb: (health: any) => void) => {
    const handler = (_e: unknown, data: any) => cb(data);
    ipcRenderer.on(IPC.BRAIN_HEALTH_CHANGED, handler as any);
    return () => ipcRenderer.removeListener(IPC.BRAIN_HEALTH_CHANGED, handler as any);
  },
  runDoctor: () =>
    ipcRenderer.invoke(IPC.RUN_DOCTOR) as Promise<any>,
  getConnectionJournal: () =>
    ipcRenderer.invoke(IPC.GET_CONNECTION_JOURNAL) as Promise<
      Array<{ ts: number; provider: string; model: string; ok: boolean; kind: string; latencyMs: number; note: string; switched?: boolean }>
    >,
  getActionLog: () =>
    ipcRenderer.invoke(IPC.GET_ACTION_LOG) as Promise<
      Array<{ ts: number; action: string; target: string; ok: boolean; attempt: number; durationMs: number; summary: string; failureKind?: string }>
    >,
  fetchUpdates: () =>
    ipcRenderer.invoke(IPC.APP_FETCH_UPDATES) as Promise<{
      ok: boolean;
      behind: number;
      pulled: boolean;
      needsRestart?: boolean;
      message: string;
    }>,
  getTransportSetting: () =>
    ipcRenderer.invoke(IPC.GET_TRANSPORT_SETTING) as Promise<{ mode: "auto" | "net" | "node" }>,
  setTransportSetting: (mode: "auto" | "net" | "node") =>
    ipcRenderer.invoke(IPC.SET_TRANSPORT_SETTING, { mode }) as Promise<{ ok: boolean; message: string }>,

  // ─── Speech (the companion's real voice) ─────────────────────────────
  ttsSpeak: (payload: { requestId?: string; text: string }) =>
    ipcRenderer.invoke(IPC.TTS_SPEAK, payload) as Promise<{
      ok: boolean;
      engine: string;
      message: string;
    }>,
  ttsStop: () => ipcRenderer.send(IPC.TTS_STOP),
  onTtsAudio: (cb: (data: { requestId: string; engine: string; audioBase64: string; mime: string }) => void) => {
    const handler = (_e: unknown, data: any) => cb(data);
    ipcRenderer.on(IPC.TTS_ON_AUDIO, handler as any);
    return () => ipcRenderer.removeListener(IPC.TTS_ON_AUDIO, handler as any);
  },
  getSpeakConfig: () =>
    ipcRenderer.invoke(IPC.GET_SPEAK_CONFIG) as Promise<{
      enabled: boolean;
      engine: "auto" | "groq" | "edge" | "local";
      voice: string;
      edgeVoice: string;
      localVoice: string;
      platform: string;
    }>,
  setSpeakConfig: (payload: { enabled?: boolean; engine?: "auto" | "groq" | "edge" | "local"; voice?: string; edgeVoice?: string; localVoice?: string }) =>
    ipcRenderer.invoke(IPC.SET_SPEAK_CONFIG, payload) as Promise<{
      ok: boolean;
      message: string;
    }>,

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

  // ─── Quip Appearance (Settings → Appearance tab button) ──────────────
  showQuipDesktop: () =>
    ipcRenderer.invoke(IPC.SHOW_QUIP_DESKTOP) as Promise<{ ok: boolean; visible: boolean }>,
  addDesktopShortcut: () =>
    ipcRenderer.invoke(IPC.ADD_DESKTOP_SHORTCUT) as Promise<{
      ok: boolean;
      created: boolean;
      present: boolean;
      shortcutPath?: string;
      message: string;
    }>,

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

  // ─── Autonomy wave (MailWing / Contacts / clipboard / events) ─────────
  mailwingAccountsList: () =>
    ipcRenderer.invoke(IPC.MAILWING_ACCOUNTS_LIST) as Promise<
      { id: string; label: string; user: string; smtpHost: string; smtpPort: number; secure: boolean; isDefault: boolean; passEncrypted: boolean; lastTestOk?: boolean }[]
    >,
  mailwingAccountsUpsert: (input: {
    label: string; smtpHost: string; smtpPort: number; secure: boolean;
    user: string; pass: string; fromEmail?: string; fromName?: string; isDefault?: boolean;
  }) => ipcRenderer.invoke(IPC.MAILWING_ACCOUNTS_UPSERT, input) as Promise<{ ok: boolean; accountId?: string; error?: string }>,
  mailwingAccountsRemove: (idOrLabel: string) =>
    ipcRenderer.invoke(IPC.MAILWING_ACCOUNTS_REMOVE, idOrLabel) as Promise<{ ok: boolean; removed?: string; error?: string }>,
  mailwingAccountsTest: (idOrLabel?: string) =>
    ipcRenderer.invoke(IPC.MAILWING_ACCOUNTS_TEST, idOrLabel) as Promise<{ ok: boolean; detail: string; tls?: boolean; stage?: string }>,
  mailwingOutboxGet: () =>
    ipcRenderer.invoke(IPC.MAILWING_OUTBOX_GET) as Promise<
      { id: string; ts: number; status: "sent" | "failed"; to: string[]; subject: string; detail: string }[]
    >,
  contactsSearch: (query: string) => ipcRenderer.invoke(IPC.CONTACTS_SEARCH, query),
  contactsList: (limit?: number) => ipcRenderer.invoke(IPC.CONTACTS_LIST, limit),
  contactsExport: (filePath?: string) => ipcRenderer.invoke(IPC.CONTACTS_EXPORT, filePath) as Promise<{ ok: boolean; path?: string; count?: number; error?: string }>,
  contactsSave: (input: { email?: string; phone?: string; name?: string; company?: string; note?: string; source?: string }) =>
    ipcRenderer.invoke(IPC.CONTACTS_SAVE, input) as Promise<{ ok: boolean; contact?: { id: string; email?: string }; error?: string }>,
  clipboardHistoryGet: () => ipcRenderer.invoke(IPC.CLIPBOARD_HISTORY_GET) as Promise<{ ts: number; text: string; origin: string }[]>,
  onQuestEvent: (cb: (event: {
    questId: string; questTitle: string; stepIndex: number; stepTotal: number;
    stepName: string; status: "running" | "done" | "failed" | "skipped" | "waiting_permission" | "cancelled";
    detail?: string;
  }) => void) => {
    const handler = (_e: unknown, data: any) => cb(data);
    ipcRenderer.on(IPC.QUEST_EVENT, handler as any);
    return () => ipcRenderer.removeListener(IPC.QUEST_EVENT, handler as any);
  },
  onWatchEvent: (cb: (event: { dir: string; moved: { name: string; to: string }[] }) => void) => {
    const handler = (_e: unknown, data: any) => cb(data);
    ipcRenderer.on(IPC.WATCH_EVENT, handler as any);
    return () => ipcRenderer.removeListener(IPC.WATCH_EVENT, handler as any);
  },

  // ─── Problem Diary (Settings → Problems: every failure, remembered) ────
  problemDiaryGet: (opts?: { status?: "open" | "resolved" | "all"; limit?: number }) =>
    ipcRenderer.invoke(IPC.PROBLEM_DIARY_GET, opts) as Promise<
      import("./shared").ProblemDiaryGetResult
    >,
  problemDiaryResolve: (id: string) =>
    ipcRenderer.invoke(IPC.PROBLEM_DIARY_RESOLVE, id) as Promise<{ ok: boolean; error?: string }>,
  problemDiaryExport: () =>
    ipcRenderer.invoke(IPC.PROBLEM_DIARY_EXPORT) as Promise<{ ok: boolean; path?: string; count?: number; error?: string }>,
  problemDiaryClear: (scope?: "resolved" | "all") =>
    ipcRenderer.invoke(IPC.PROBLEM_DIARY_CLEAR, scope) as Promise<{ ok: boolean; removed: number }>,
  onProblemDiaryChanged: (cb: (stats: import("./shared").ProblemDiaryStats) => void) => {
    const handler = (_e: unknown, data: any) => cb(data);
    ipcRenderer.on(IPC.PROBLEM_DIARY_CHANGED, handler as any);
    return () => ipcRenderer.removeListener(IPC.PROBLEM_DIARY_CHANGED, handler as any);
  },

  // ─── Drag & drop (UX-010): absolute path of a dropped File ─────────────
  getPathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },

  // ─── CAP-060 autonomy budget (Settings → Desktop) ──────────────────────
  getQuestBudget: () =>
    ipcRenderer.invoke(IPC.QUEST_BUDGET_GET) as Promise<{ budget: number }>,
  setQuestBudget: (budget: number) =>
    ipcRenderer.invoke(IPC.QUEST_BUDGET_SET, budget) as Promise<{ ok: boolean; budget: number; message: string }>,

  // ─── Ghost Cursor — keep the magical hand in the current theme ─────────
  setGhostCursorStyle: (style: import("./shared").GhostCursorStyle) =>
    ipcRenderer.send(IPC.GHOST_CURSOR_STYLE, style),

  // ─── Care routines (hydrate / eyes / posture / screen time) ────────────
  getCareEnabled: () =>
    ipcRenderer.invoke(IPC.CARE_GET) as Promise<{ enabled: boolean }>,
  setCareEnabled: (enabled: boolean) =>
    ipcRenderer.invoke(IPC.CARE_SET, enabled) as Promise<{ ok: boolean; enabled: boolean }>,
  onCareEvent: (cb: (event: import("./shared").CareEventPayload) => void) => {
    const handler = (_e: unknown, data: any) => cb(data);
    ipcRenderer.on(IPC.CARE_EVENT, handler as any);
    return () => ipcRenderer.removeListener(IPC.CARE_EVENT, handler as any);
  },

  // ─── App watcher — "need any help?" when a new app comes to front ──────
  getAppNoticeEnabled: () =>
    ipcRenderer.invoke(IPC.APP_NOTICE_GET) as Promise<{ enabled: boolean }>,
  setAppNoticeEnabled: (enabled: boolean) =>
    ipcRenderer.invoke(IPC.APP_NOTICE_SET, enabled) as Promise<{ ok: boolean; enabled: boolean }>,
  focusApp: (target: string) =>
    ipcRenderer.invoke(IPC.FOCUS_APP, target) as Promise<{ ok: boolean; message: string }>,
  onAppNotice: (cb: (notice: import("./shared").AppNoticePayload) => void) => {
    const handler = (_e: unknown, data: any) => cb(data);
    ipcRenderer.on(IPC.APP_NOTICE_EVENT, handler as any);
    return () => ipcRenderer.removeListener(IPC.APP_NOTICE_EVENT, handler as any);
  },
};


contextBridge.exposeInMainWorld("quip", api);

export type QuipAPI = typeof api;
