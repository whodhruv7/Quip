// Quip Ghost Cursor — overlay preload.
// The overlay is a private, click-through decoration surface with no Node
// access; this bridge hands it exactly one thing: the cursor event stream.

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("quipCursor", {
  onEvent: (cb: (ev: Record<string, unknown>) => void) => {
    const handler = (_e: unknown, ev: Record<string, unknown>) => cb(ev);
    ipcRenderer.on("ghost-cursor-event", handler as never);
    return () => ipcRenderer.removeListener("ghost-cursor-event", handler as never);
  },
});
