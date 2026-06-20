// Quip V2 — preload
//
// Exposes a complete bridge to the renderer for all brain layers.
// API keys never leave main — the renderer only asks main to do things.

import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "./shared";
import type {
  ChatSendPayload,
  TaskExecutePayload,
  ConfirmationResolvePayload,
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
  onTaskProgress: (cb: (p: any) => void) => {
    const handler = (_e: unknown, data: any) => cb(data);
    ipcRenderer.on(IPC.TASK_PROGRESS, handler as any);
    return () => ipcRenderer.removeListener(IPC.TASK_PROGRESS, handler as any);
  },
  onConfirmationRequest: (cb: (req: any) => void) => {
    const handler = (_e: unknown, data: any) => cb(data);
    ipcRenderer.on(IPC.CONFIRMATION_REQUEST, handler as any);
    return () =>
      ipcRenderer.removeListener(IPC.CONFIRMATION_REQUEST, handler as any);
  },
  resolveConfirmation: (id: string, approved: boolean) =>
    ipcRenderer.send(IPC.CONFIRMATION_RESOLVE, {
      id,
      approved,
    } as ConfirmationResolvePayload),

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

  // ─── Model router ────────────────────────────────────────────────────
  getModelStatus: () =>
    ipcRenderer.invoke(IPC.GET_MODEL_STATUS),

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
};

contextBridge.exposeInMainWorld("quip", api);

export type QuipAPI = typeof api;
