import re
import os

with open("electron/main.ts", "r", encoding="utf-8") as f:
    content = f.read()

# Chunk 1: State
content = re.sub(
    r"let mainWindow: BrowserWindow \| null = null;.*?let currentCompanionId: \"pix\" \| \"kai\" \| \"zee\" = \"pix\";",
    r"""const windows = new Map<number, BrowserWindow>();
const windowCompanionMap = new Map<number, "pix" | "kai" | "zee">();
let tray: Tray | null = null;

let deviceProfile: DeviceProfile | null = null;
let worldModel: WorldModel | null = null;
let spatialConfig: SpatialConfig | null = null;

// The default companion (set by renderer via IPC). Defaults to "pix".
let defaultCompanionId: "pix" | "kai" | "zee" = "pix";""",
    content,
    flags=re.DOTALL
)

# Chunk 2: buildSystemPrompt signature and personalities
content = re.sub(
    r"function buildSystemPrompt\(userMessage\?: string\): string \{.*?const companionPersonalities: Record<string, string> = \{.*?`You are \$\{companionPersonalities\[currentCompanionId\] \?\? companionPersonalities\.pix\}`",
    r"""function buildSystemPrompt(userMessage?: string, companionId: "pix" | "kai" | "zee" = "pix"): string {
  const env = environmentBrain.get();
  const sections: string[] = [];

  // ─── 1. Core identity + companion (always) ──────────────────────────
  const companionPersonalities: Record<string, string> = {
    pix: "Pix — playful, energetic, creative. Light humor. Social + creative tasks.",
    kai: "Kai — calm, analytical, wise. Clear explanations. Planning + research.",
    zee: "Zee — curious, empathetic, reflective. Personal + emotional support.",
  };
  sections.push(
    "You are QUIP, a calm, concise AI companion on the user's desktop. " +
      "Warm, human, never robotic. Short answers unless asked for detail. " +
      `You are ${companionPersonalities[companionId] ?? companionPersonalities.pix}`""",
    content,
    flags=re.DOTALL
)

# Chunk 3: buildSystemPrompt moodHint
content = re.sub(
    r"const moodHint = companionMood\.getPromptHint\(currentCompanionId\);",
    r"const moodHint = companionMood.getPromptHint(companionId);",
    content
)

# Chunk 4: Window Functions
content = re.sub(
    r"function createWindow\(\) \{.*?function sendToRenderer\(channel: string, data: unknown\) \{\n  if \(mainWindow && !mainWindow\.isDestroyed\(\)\) \{\n    mainWindow\.webContents\.send\(channel, data\);\n  \}\n\}",
    r"""function createWindow(companionId: "pix" | "kai" | "zee" = "pix", offsetX = 0, offsetY = 0) {
  const panel = spatialConfig?.chatPanel ?? {
    x: 0,
    y: 0,
    width: 440,
    height: 680,
  };
  const area = screen.getPrimaryDisplay().workArea;
  const saved = readPosition();
  const w = panel.width;
  const h = panel.height;

  let x: number, y: number;
  if (saved) {
    const clamped = clampPosition(saved.x, saved.y, w, h);
    x = clamped.x + offsetX;
    y = clamped.y + offsetY;
  } else if (panel.x > 0 || panel.y > 0) {
    const clamped = clampPosition(panel.x, panel.y, w, h);
    x = clamped.x + offsetX;
    y = clamped.y + offsetY;
  } else {
    x = area.x + area.width - w - 20 + offsetX;
    y = area.y + area.height - h - 20 + offsetY;
  }

  const win = new BrowserWindow({
    width: w,
    height: h,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  windows.set(win.id, win);
  windowCompanionMap.set(win.id, companionId);

  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
  });
  win.showInactive();
  win.moveTop();

  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) {
      win.show();
      win.focus();
      win.moveTop();
    }
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(`${process.env.VITE_DEV_SERVER_URL}?companion=${companionId}`);
  } else if (isDev) {
    win.loadURL(`http://localhost:5173?companion=${companionId}`);
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"), { search: `companion=${companionId}` });
  }

  win.on("move", () => {
    if (windows.size === 1) {
      const [px, py] = win.getPosition();
      writePosition(px, py);
    }
  });
  
  win.on("closed", () => {
    windows.delete(win.id);
    windowCompanionMap.delete(win.id);
  });

  if (isDev) {
    win.webContents.on("did-finish-load", () => {
      win.webContents.openDevTools({ mode: "detach" });
    });
  }
  return win;
}

function broadcastToRenderers(channel: string, data: unknown) {
  windows.forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  });
}

function sendToWindow(win: BrowserWindow | null, channel: string, data: unknown) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data);
  }
}""",
    content,
    flags=re.DOTALL
)

# Chunk 5: Tray
content = re.sub(
    r"tray\.on\(\"click\", \(\) => mainWindow\?\.show\(\)\);.*?label: \"Show Quip\", click: \(\) => mainWindow\?\.show\(\)",
    r"""tray.on("click", () => {
    if (windows.size === 0) createWindow(defaultCompanionId);
    else windows.forEach(w => w.show());
  });
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show Quip", click: () => {
          if (windows.size === 0) createWindow(defaultCompanionId);
          else windows.forEach(w => w.show());
      } }""",
    content,
    flags=re.DOTALL
)

# Chunk 6: Window position IPC
content = re.sub(
    r"ipcMain\.on\(\n  IPC\.MOVE_WINDOW,\n  \(_e, \{ dx, dy \}: \{ dx: number; dy: number \}\) => \{\n    if \(!mainWindow\) return;\n    const \[x, y\] = mainWindow\.getPosition\(\);\n    mainWindow\.setPosition\(x \+ dx, y \+ dy, false\);\n  \}\n\);\n\nipcMain\.handle\(IPC\.GET_WINDOW_POSITION, \(\) => \{\n  if \(!mainWindow\) return null;\n  const \[x, y\] = mainWindow\.getPosition\(\);\n  return \{ x, y \};\n\}\);",
    r"""ipcMain.on(
  IPC.MOVE_WINDOW,
  (_e, { dx, dy }: { dx: number; dy: number }) => {
    const win = BrowserWindow.fromWebContents(_e.sender);
    if (!win) return;
    const [x, y] = win.getPosition();
    win.setPosition(x + dx, y + dy, false);
  }
);

ipcMain.handle(IPC.GET_WINDOW_POSITION, (_e) => {
  const win = BrowserWindow.fromWebContents(_e.sender);
  if (!win) return null;
  const [x, y] = win.getPosition();
  return { x, y };
});""",
    content,
    flags=re.DOTALL
)

# Chunk 7: CHAT_SEND IPC
content = re.sub(
    r"ipcMain\.handle\(IPC\.CHAT_SEND, async \(_e, payload: ChatSendPayload\) => \{\n  const win = mainWindow;\n  if \(!win \|\| win\.isDestroyed\(\)\) return \{ ok: false \};(.*?)const systemPrompt = buildSystemPrompt\(lastUserMsg\?\.content\);\n(.*?)companionEvolution\.recordMessage\(currentCompanionId\);(.*?)companionEvolution\.recordConversation\(currentCompanionId\);\n(.*?)title: `Started conversation with \$\{currentCompanionId\}`(.*?)sendToRenderer\(IPC\.CHAT_CHUNK(.*?)sendToRenderer\(IPC\.CHAT_DONE(.*?)sendToRenderer\(IPC\.CHAT_ERROR",
    r"""ipcMain.handle(IPC.CHAT_SEND, async (_e, payload: ChatSendPayload) => {
  const win = BrowserWindow.fromWebContents(_e.sender);
  if (!win || win.isDestroyed()) return { ok: false };
  const companionId = windowCompanionMap.get(win.id) ?? defaultCompanionId;
\1const systemPrompt = buildSystemPrompt(lastUserMsg?.content, companionId);
\2companionEvolution.recordMessage(companionId);\3companionEvolution.recordConversation(companionId);\n\4title: `Started conversation with ${companionId}`\5sendToWindow(win, IPC.CHAT_CHUNK\6sendToWindow(win, IPC.CHAT_DONE\7sendToWindow(win, IPC.CHAT_ERROR""",
    content,
    flags=re.DOTALL
)

content = re.sub(
    r"observeMessages\(currentCompanionId, payload\.history\);",
    r"observeMessages(companionId, payload.history);",
    content
)


# Chunk 8: TASK_EXECUTE uses sendToWindow
content = re.sub(
    r"execPermissionSystem\.onApprovalRequested = \(request: ApprovalRequest\) => \{\n      sendToRenderer\(\"quip:approval-request\", request\);\n    \};(.*?)sendToRenderer\(IPC\.TASK_PROGRESS(.*?)companionEvolution\.recordTask\(currentCompanionId\);",
    r"""const win = BrowserWindow.fromWebContents(_e.sender);
    const companionId = win ? windowCompanionMap.get(win.id) ?? defaultCompanionId : defaultCompanionId;

    // Set up approval callback — forwards to renderer
    execPermissionSystem.onApprovalRequested = (request: ApprovalRequest) => {
      sendToWindow(win, "quip:approval-request", request);
    };\1sendToWindow(win, IPC.TASK_PROGRESS\2companionEvolution.recordTask(companionId);""",
    content,
    flags=re.DOTALL
)

# Chunk 9: set-companion uses defaultCompanionId
content = re.sub(
    r"currentCompanionId = id;",
    r"defaultCompanionId = id;\n    const win = BrowserWindow.fromWebContents(_e.sender);\n    if (win) windowCompanionMap.set(win.id, id);",
    content
)


# Replace global sendToRenderer with broadcastToRenderers in bootstrap bindings
content = content.replace("sendToRenderer(IPC.ON_COSMETIC_UNLOCK", "broadcastToRenderers(IPC.ON_COSMETIC_UNLOCK")
content = content.replace("sendToRenderer(IPC.BOOTSTRAP_PROGRESS", "broadcastToRenderers(IPC.BOOTSTRAP_PROGRESS")
content = content.replace("sendToRenderer(IPC.SPATIAL_CHANGE", "broadcastToRenderers(IPC.SPATIAL_CHANGE")
content = content.replace("sendToRenderer(IPC.ENVIRONMENT_CHANGE", "broadcastToRenderers(IPC.ENVIRONMENT_CHANGE")

# Add swarm mode IPC handlers
swarm_handlers = """
// ---------------------------------------------------------------------------
// IPC — Swarm Mode
// ---------------------------------------------------------------------------
ipcMain.handle(IPC.SPAWN_COMPANION, (_e, { companionId }: { companionId: "pix" | "kai" | "zee" }) => {
  // spawn slightly offset
  const offsetCount = windows.size;
  createWindow(companionId, offsetCount * 40, offsetCount * 40);
});

ipcMain.on(IPC.INTER_COMPANION_MSG, (_e, { to, message }: { to: "pix" | "kai" | "zee", message: string }) => {
  const fromWin = BrowserWindow.fromWebContents(_e.sender);
  const fromId = fromWin ? windowCompanionMap.get(fromWin.id) : "unknown";
  
  // Find target window
  for (const [id, compId] of windowCompanionMap.entries()) {
    if (compId === to) {
      const win = windows.get(id);
      if (win) {
        win.webContents.send(IPC.INTER_COMPANION_MSG, { from: fromId, message });
        return;
      }
    }
  }
});
"""
content = content.replace("// ---------------------------------------------------------------------------\n// IPC — device brain", swarm_handlers + "\n// ---------------------------------------------------------------------------\n// IPC — device brain")

with open("electron/main.ts", "w", encoding="utf-8") as f:
    f.write(content)
