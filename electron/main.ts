// Quip V0.1 — Electron main process
//
// Responsibilities:
//  - Create a single transparent, frameless, always-on-top window for Pix.
//  - Persist + restore window position locally (JSON in userData).
//  - Relay chat requests to OpenRouter and stream tokens back to the renderer.
//
// Security: the OpenRouter key NEVER reaches the renderer. It lives in the
// process env (loaded from the local .env) and is only used here in main.
//
// Future (NOT in V0.1): Memory Engine, Personality Layer, Kai, Ren,
// Notifications, Floating Toolbar, Voice System, Cross-App Context.

import { app, BrowserWindow, ipcMain, screen, Tray, nativeImage } from "electron";
import path from "node:path";
import fs from "node:fs";

// .env loader (tiny, dependency-free). Node 20 supports --env-file, but we read
// it manually so `npm run dev` works without extra flags.
function loadEnvFile(file: string) {
  const full = path.resolve(file);
  if (!fs.existsSync(full)) return;
  const txt = fs.readFileSync(full, "utf8");
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvFile(path.join(app.getAppPath(), ".env"));
loadEnvFile(path.join(process.cwd(), ".env"));

import { IPC, ChatSendPayload, ChatErrorPayload } from "./shared";

// Prefer the free model declared in env, fall back to a known free model.
const PRIMARY_MODEL =
  process.env.OPENROUTER_MODEL || "google/gemma-3-27b-it:free";
const FALLBACK_MODEL = "openrouter/free";

const isDev = process.env.NODE_ENV === "development";
// Single pixel ~ invisible click area for the tray (we keep a tray so the app
// doesn't fully "disappear" since the window has no taskbar button).
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// ---------------------------------------------------------------------------
// Local persistence — window position only.
// ---------------------------------------------------------------------------
const POS_FILE = "pix-window-position.json";

function readPosition(): { x: number; y: number } | null {
  try {
    const p = path.join(app.getPath("userData"), POS_FILE);
    if (!fs.existsSync(p)) return null;
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    if (typeof data.x === "number" && typeof data.y === "number") return data;
    return null;
  } catch {
    return null;
  }
}

function writePosition(x: number, y: number) {
  try {
    const p = path.join(app.getPath("userData"), POS_FILE);
    fs.writeFileSync(p, JSON.stringify({ x, y }));
  } catch {
    /* ignore — best effort */
  }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function bottomRight(): { x: number; y: number } {
  const saved = readPosition();
  if (saved) return saved;

  const area = screen.getPrimaryDisplay().workArea;
  const margin = 20;
  // Window needs room for companion + panel. Anchor bottom-right.
  const w = 500;
  const h = 600;
  return {
    x: area.x + area.width - w - margin,
    y: area.y + area.height - h - margin,
  };
}

function createWindow() {
  const pos = bottomRight();
  const area = screen.getPrimaryDisplay().workArea;
  const w = 480;
  const h = 640;

  mainWindow = new BrowserWindow({
    width: w,
    height: h,
    x: Math.min(pos.x, area.x + area.width - 120),
    y: Math.min(pos.y, area.y + area.height - 120),
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true, // Pix lives on the desktop, not the taskbar
    alwaysOnTop: true,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Keep it on top across all spaces / fullscreen-ish apps.
  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  // Persist position whenever the window moves.
  mainWindow.on("move", () => {
    if (!mainWindow) return;
    const [x, y] = mainWindow.getPosition();
    writePosition(x, y);
  });

  // Dev tools in dev only.
  if (isDev) {
    mainWindow.webContents.on("did-finish-load", () => {
      mainWindow?.webContents.openDevTools({ mode: "detach" });
    });
  }
}

// ---------------------------------------------------------------------------
// Tray — a quiet way to quit since the window is taskbar-less.
// ---------------------------------------------------------------------------
function createTray() {
  // 16x16 transparent png (1x1 transparent) as the tray icon.
  const icon = nativeImage.createFromBuffer(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAO0lEQVR4nO3OQQ0AIAwEMP7Z36EBcZJmBEwQ1kYSYUdA1uT+rz0AAAAAAAAAAAAAAAAAAAAAAAAAAL51NekDHNd7rTAAAAAASUVORK5CYII=",
      "base64"
    )
  );
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("Quip — Pix");
  tray.on("click", () => mainWindow?.show());
  const { Menu } = require("electron");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show Pix", click: () => mainWindow?.show() },
      { type: "separator" },
      {
        label: "Quit Quip",
        click: () => app.quit(),
      },
    ])
  );
}

// ---------------------------------------------------------------------------
// IPC — window movement
// ---------------------------------------------------------------------------
ipcMain.on(IPC.MOVE_WINDOW, (_e, { dx, dy }: { dx: number; dy: number }) => {
  if (!mainWindow) return;
  const [x, y] = mainWindow.getPosition();
  mainWindow.setPosition(x + dx, y + dy, false);
});

ipcMain.handle(IPC.GET_WINDOW_POSITION, () => {
  if (!mainWindow) return null;
  const [x, y] = mainWindow.getPosition();
  return { x, y };
});

// ---------------------------------------------------------------------------
// OpenRouter streaming chat — key stays in main.
// ---------------------------------------------------------------------------
async function streamOpenRouter(
  payload: ChatSendPayload,
  model: string
): Promise<void> {
  const key = process.env.OPENROUTER_API_KEY;
  const win = mainWindow;
  if (!win) return;

  if (!key) {
    const err: ChatErrorPayload = {
      requestId: payload.requestId,
      message:
        "No OPENROUTER_API_KEY found. Add it to quip-v01-desktop/.env and restart.",
      kind: "no-key",
    };
    win.webContents.send(IPC.CHAT_ERROR, err);
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const resp = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://quip.app",
          "X-Title": "Quip",
        },
        body: JSON.stringify({
          model,
          stream: true,
          messages: [
            {
              role: "system",
              content:
                "You are a calm, friendly, concise AI companion living on the user's desktop. " +
                "Be warm and human, never robotic. Keep answers short and helpful unless asked for detail. " +
                "Use markdown when it improves clarity. You are playful yet thoughtful.",
            },
            ...payload.history,
          ],
        }),
        signal: controller.signal,
      }
    );

    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => "");
      const err: ChatErrorPayload = {
        requestId: payload.requestId,
        message:
          resp.status === 401
            ? "OpenRouter rejected the API key (401). Check .env."
            : resp.status === 429
              ? "Rate limited by OpenRouter (429). Try again in a moment."
              : `OpenRouter error ${resp.status}: ${text.slice(0, 200)}`,
        kind: "http",
      };
      win.webContents.send(IPC.CHAT_ERROR, err);
      return;
    }

    // Parse SSE stream manually.
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;

        try {
          const json = JSON.parse(data);
          const delta: string = json?.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            full += delta;
            win.webContents.send(IPC.CHAT_CHUNK, {
              requestId: payload.requestId,
              delta,
            });
          }
        } catch {
          /* partial JSON across chunks — ignore, will resolve next chunk */
        }
      }
    }

    win.webContents.send(IPC.CHAT_DONE, {
      requestId: payload.requestId,
      full,
    });
  } catch (e: any) {
    const err: ChatErrorPayload = {
      requestId: payload.requestId,
      message: e?.name === "AbortError"
        ? "Request timed out. Try again."
        : `Network error: ${e?.message ?? String(e)}`,
      kind: e?.name === "AbortError" ? "network" : "network",
    };
    win.webContents.send(IPC.CHAT_ERROR, err);
  } finally {
    clearTimeout(timeout);
  }
}

ipcMain.handle(IPC.CHAT_SEND, async (_e, payload: ChatSendPayload) => {
  // Try primary free model, fall back if it fails outright.
  try {
    await streamOpenRouter(payload, PRIMARY_MODEL);
  } catch {
    await streamOpenRouter(payload, FALLBACK_MODEL);
  }
  return { ok: true };
});

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    createWindow();
    createTray();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
