// Quip V0.1 — preload
//
// Exposes a minimal, typed bridge to the renderer. The OpenRouter key is never
// exposed — the renderer only asks main to "send a chat" and listens for
// streamed chunks.

import { contextBridge, ipcRenderer } from "electron";
import { IPC, ChatSendPayload } from "./shared";

const api = {
  // --- window ---
  moveWindow: (dx: number, dy: number) =>
    ipcRenderer.send(IPC.MOVE_WINDOW, { dx, dy }),
  getWindowPosition: () =>
    ipcRenderer.invoke(IPC.GET_WINDOW_POSITION) as Promise<{
      x: number;
      y: number;
    } | null>,

  // --- chat ---
  chatSend: (payload: ChatSendPayload) =>
    ipcRenderer.invoke(IPC.CHAT_SEND, payload),
  onChatChunk: (cb: (delta: string) => void) => {
    const handler = (_e: unknown, data: { delta: string }) => cb(data.delta);
    ipcRenderer.on(IPC.CHAT_CHUNK, handler as any);
    return () => ipcRenderer.removeListener(IPC.CHAT_CHUNK, handler as any);
  },
  onChatDone: (cb: (full: string) => void) => {
    const handler = (_e: unknown, data: { full: string }) => cb(data.full);
    ipcRenderer.on(IPC.CHAT_DONE, handler as any);
    return () => ipcRenderer.removeListener(IPC.CHAT_DONE, handler as any);
  },
  onChatError: (
    cb: (err: { message: string; kind: string }) => void
  ) => {
    const handler = (
      _e: unknown,
      data: { message: string; kind: string }
    ) => cb(data);
    ipcRenderer.on(IPC.CHAT_ERROR, handler as any);
    return () => ipcRenderer.removeListener(IPC.CHAT_ERROR, handler as any);
  },
};

contextBridge.exposeInMainWorld("quip", api);

export type QuipAPI = typeof api;
