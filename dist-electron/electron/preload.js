"use strict";
// Quip V2 — preload
//
// Exposes a complete bridge to the renderer for all brain layers.
// API keys never leave main — the renderer only asks main to do things.
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const shared_1 = require("./shared");
const api = {
    // ─── Window movement ─────────────────────────────────────────────────
    moveWindow: (dx, dy) => electron_1.ipcRenderer.send(shared_1.IPC.MOVE_WINDOW, { dx, dy }),
    getWindowPosition: () => electron_1.ipcRenderer.invoke(shared_1.IPC.GET_WINDOW_POSITION),
    // ─── Chat streaming ──────────────────────────────────────────────────
    chatSend: (payload) => electron_1.ipcRenderer.invoke(shared_1.IPC.CHAT_SEND, payload),
    onChatChunk: (cb) => {
        const handler = (_e, data) => cb(data.delta, data.requestId);
        electron_1.ipcRenderer.on(shared_1.IPC.CHAT_CHUNK, handler);
        return () => electron_1.ipcRenderer.removeListener(shared_1.IPC.CHAT_CHUNK, handler);
    },
    onChatDone: (cb) => {
        const handler = (_e, data) => cb(data.full, data.requestId);
        electron_1.ipcRenderer.on(shared_1.IPC.CHAT_DONE, handler);
        return () => electron_1.ipcRenderer.removeListener(shared_1.IPC.CHAT_DONE, handler);
    },
    onChatError: (cb) => {
        const handler = (_e, data) => cb({ message: data.message, kind: data.kind, requestId: data.requestId });
        electron_1.ipcRenderer.on(shared_1.IPC.CHAT_ERROR, handler);
        return () => electron_1.ipcRenderer.removeListener(shared_1.IPC.CHAT_ERROR, handler);
    },
    // ─── Task execution ──────────────────────────────────────────────────
    executeTask: (payload) => electron_1.ipcRenderer.invoke(shared_1.IPC.TASK_EXECUTE, payload),
    // ─── Set active companion (so the system prompt adapts personality/mood) ─
    setCompanion: (id) => electron_1.ipcRenderer.send("quip:set-companion", id),
    // ─── Execution Engine V2 — Permission modes ────────────────────────
    getPermissionMode: () => electron_1.ipcRenderer.invoke("quip:get-permission-mode"),
    setPermissionMode: (mode) => electron_1.ipcRenderer.invoke("quip:set-permission-mode", mode),
    cyclePermissionMode: () => electron_1.ipcRenderer.invoke("quip:cycle-permission-mode"),
    onApprovalRequest: (cb) => {
        const handler = (_e, data) => cb(data);
        electron_1.ipcRenderer.on("quip:approval-request", handler);
        return () => electron_1.ipcRenderer.removeListener("quip:approval-request", handler);
    },
    resolveApproval: (id, approved) => electron_1.ipcRenderer.send("quip:approval-resolve", { id, approved }),
    onTaskProgress: (cb) => {
        const handler = (_e, data) => cb(data);
        electron_1.ipcRenderer.on(shared_1.IPC.TASK_PROGRESS, handler);
        return () => electron_1.ipcRenderer.removeListener(shared_1.IPC.TASK_PROGRESS, handler);
    },
    onConfirmationRequest: (cb) => {
        const handler = (_e, data) => cb(data);
        electron_1.ipcRenderer.on(shared_1.IPC.CONFIRMATION_REQUEST, handler);
        return () => electron_1.ipcRenderer.removeListener(shared_1.IPC.CONFIRMATION_REQUEST, handler);
    },
    resolveConfirmation: (id, approved) => electron_1.ipcRenderer.send(shared_1.IPC.CONFIRMATION_RESOLVE, {
        id,
        approved,
    }),
    // ─── Device brain ────────────────────────────────────────────────────
    getDeviceProfile: () => electron_1.ipcRenderer.invoke(shared_1.IPC.GET_DEVICE_PROFILE),
    rescanDevice: () => electron_1.ipcRenderer.invoke(shared_1.IPC.RESCAN_DEVICE),
    // ─── Spatial brain ───────────────────────────────────────────────────
    getSpatialConfig: () => electron_1.ipcRenderer.invoke(shared_1.IPC.GET_SPATIAL_CONFIG),
    onSpatialChange: (cb) => {
        const handler = (_e, data) => cb(data);
        electron_1.ipcRenderer.on(shared_1.IPC.SPATIAL_CHANGE, handler);
        return () => electron_1.ipcRenderer.removeListener(shared_1.IPC.SPATIAL_CHANGE, handler);
    },
    // ─── Environment brain ───────────────────────────────────────────────
    onEnvironmentChange: (cb) => {
        const handler = (_e, data) => cb(data);
        electron_1.ipcRenderer.on(shared_1.IPC.ENVIRONMENT_CHANGE, handler);
        return () => electron_1.ipcRenderer.removeListener(shared_1.IPC.ENVIRONMENT_CHANGE, handler);
    },
    // ─── Memory brain ───────────────────────────────────────────────────
    getMemories: () => electron_1.ipcRenderer.invoke(shared_1.IPC.GET_MEMORIES),
    forgetMemory: (id) => electron_1.ipcRenderer.invoke(shared_1.IPC.FORGET_MEMORY, id),
    pinMemory: (id) => electron_1.ipcRenderer.invoke(shared_1.IPC.PIN_MEMORY, id),
    pruneMemories: () => electron_1.ipcRenderer.invoke(shared_1.IPC.PRUNE_MEMORIES),
    // ─── Knowledge graph ────────────────────────────────────────────────
    getKnowledgeGraph: () => electron_1.ipcRenderer.invoke(shared_1.IPC.GET_KNOWLEDGE_GRAPH),
    removeEntity: (id) => electron_1.ipcRenderer.invoke(shared_1.IPC.REMOVE_ENTITY, id),
    // ─── Workspace context ──────────────────────────────────────────────
    getWorkspaceContext: () => electron_1.ipcRenderer.invoke(shared_1.IPC.GET_WORKSPACE_CONTEXT),
    // ─── Relationship engine (communication DNA) ───────────────────────
    getUserProfile: () => electron_1.ipcRenderer.invoke(shared_1.IPC.GET_USER_PROFILE),
    resetUserProfile: () => electron_1.ipcRenderer.invoke(shared_1.IPC.RESET_USER_PROFILE),
    // ─── Companion mood ─────────────────────────────────────────────────
    getCompanionMood: (companionId) => electron_1.ipcRenderer.invoke(shared_1.IPC.GET_COMPANION_MOOD, companionId),
    // ─── Companion evolution ────────────────────────────────────────────
    getCompanionProgression: () => electron_1.ipcRenderer.invoke(shared_1.IPC.GET_COMPANION_PROGRESSION),
    onCosmeticUnlock: (cb) => {
        const handler = (_e, data) => cb(data);
        electron_1.ipcRenderer.on(shared_1.IPC.ON_COSMETIC_UNLOCK, handler);
        return () => electron_1.ipcRenderer.removeListener(shared_1.IPC.ON_COSMETIC_UNLOCK, handler);
    },
    // ─── Model router ────────────────────────────────────────────────────
    getModelStatus: () => electron_1.ipcRenderer.invoke(shared_1.IPC.GET_MODEL_STATUS),
    // ─── Permission system ──────────────────────────────────────────────
    getPermissions: () => electron_1.ipcRenderer.invoke(shared_1.IPC.GET_PERMISSIONS),
    updatePermission: (capability, granted) => electron_1.ipcRenderer.invoke(shared_1.IPC.UPDATE_PERMISSION, { capability, granted }),
    // ─── Bootstrap ────────────────────────────────────────────────────────
    onBootstrapProgress: (cb) => {
        const handler = (_e, data) => cb(data);
        electron_1.ipcRenderer.on(shared_1.IPC.BOOTSTRAP_PROGRESS, handler);
        return () => electron_1.ipcRenderer.removeListener(shared_1.IPC.BOOTSTRAP_PROGRESS, handler);
    },
    // ─── Phase 2: Communication DNA ──────────────────────────────────────
    getCommunicationDNA: () => electron_1.ipcRenderer.invoke(shared_1.IPC.GET_COMMUNICATION_DNA),
    // ─── Phase 2: Proactive Suggestions ──────────────────────────────────
    onProactiveSuggestion: (cb) => {
        const handler = (_e, data) => cb(data);
        electron_1.ipcRenderer.on(shared_1.IPC.PROACTIVE_SUGGESTION, handler);
        return () => electron_1.ipcRenderer.removeListener(shared_1.IPC.PROACTIVE_SUGGESTION, handler);
    },
    dismissProactive: () => electron_1.ipcRenderer.send(shared_1.IPC.DISMISS_PROACTIVE),
    // ─── Phase 2: Weekly Reflection ──────────────────────────────────────
    getWeeklyDigest: () => electron_1.ipcRenderer.invoke(shared_1.IPC.GET_WEEKLY_DIGEST),
    triggerWeeklyReflection: () => electron_1.ipcRenderer.invoke(shared_1.IPC.TRIGGER_WEEKLY_REFLECTION),
    recordReflectionFeedback: (feedback) => electron_1.ipcRenderer.invoke(shared_1.IPC.RECORD_REFLECTION_FEEDBACK, { feedback }),
    // ─── Phase 3: Swarm Mode ─────────────────────────────────────────────
    spawnCompanion: (companionId, headless, autoTask) => electron_1.ipcRenderer.invoke(shared_1.IPC.SPAWN_COMPANION, { companionId, headless, autoTask }),
    dismissCompanion: (winId) => electron_1.ipcRenderer.invoke(shared_1.IPC.DISMISS_COMPANION, { winId }),
    getSwarmInstances: () => electron_1.ipcRenderer.invoke(shared_1.IPC.GET_SWARM_INSTANCES),
    sendInterCompanionMsg: (to, message) => electron_1.ipcRenderer.send(shared_1.IPC.INTER_COMPANION_MSG, { to, message }),
    onInterCompanionMsg: (cb) => {
        const handler = (_e, data) => cb(data);
        electron_1.ipcRenderer.on(shared_1.IPC.INTER_COMPANION_MSG, handler);
        return () => electron_1.ipcRenderer.removeListener(shared_1.IPC.INTER_COMPANION_MSG, handler);
    },
    onAutoTask: (cb) => {
        const handler = (_e, data) => cb(data);
        electron_1.ipcRenderer.on(shared_1.IPC.AUTO_TASK, handler);
        return () => electron_1.ipcRenderer.removeListener(shared_1.IPC.AUTO_TASK, handler);
    },
};
electron_1.contextBridge.exposeInMainWorld("quip", api);
//# sourceMappingURL=preload.js.map