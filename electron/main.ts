// Quip V2 — Electron main process (orchestration hub).
// Wires all 10 brain layers + bootstrap + IPC. API keys stay in env only.

import { app, BrowserWindow, ipcMain, screen, Tray, nativeImage, Menu } from "electron";
import path from "node:path";
import fs from "node:fs";

// .env loader (tiny, dependency-free).
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

import { IPC } from "./shared";
import type {
  ChatSendPayload,
  ChatErrorPayload,
  TaskExecutePayload,
  TaskProgressPayload,
  ConfirmationResolvePayload,
} from "./shared";

import { bootstrap, BootstrapResult } from "./system/bootstrap";
import { modelRouter } from "./system/model-router";
import { permissionSystem } from "./system/permission-system";

import { ensureProfile, loadProfile } from "./brains/device-brain";
import { ensureWorldModel } from "./brains/world-model";
import { environmentBrain } from "./brains/environment-brain";
import { memoryBrain } from "./brains/memory-brain";
import { computeSpatial, watchSpatial } from "./brains/spatial-brain";
import { runTask } from "./brains/task-brain";
import { knowledgeGraph } from "./brains/knowledge-graph";
import { workspaceContext } from "./brains/workspace-context";
import { relationshipEngine } from "./brains/relationship-engine";
import { companionMood } from "./brains/companion-mood";
import { companionEvolution } from "./brains/companion-evolution";
import { runPrune } from "./brains/memory-importance";
import { observeMessages, resetExtractionCount } from "./brains/memory-extractor";

import type {
  DeviceProfile,
  WorldModel,
  SpatialConfig,
  EnvironmentState,
  TaskResultPayload,
  ConfirmationRequest,
  BootstrapProgress,
  CapabilityId,
} from "../src/types";

// ─── State ───────────────────────────────────────────────────────────────────
const isDev = process.env.NODE_ENV === "development";
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

let deviceProfile: DeviceProfile | null = null;
let worldModel: WorldModel | null = null;
let spatialConfig: SpatialConfig | null = null;

// The currently active companion (set by renderer via IPC). Defaults to "pix".
// Used by the system prompt to apply personality + mood.
let currentCompanionId: "pix" | "kai" | "zee" = "pix";

const pendingConfirmations = new Map<
  string,
  { resolve: (approved: boolean) => void }
>();

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

function clampPosition(x: number, y: number, w: number, h: number) {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.max(area.x, Math.min(x, area.x + area.width - w)),
    y: Math.max(area.y, Math.min(y, area.y + area.height - h)),
  };
}

function buildSystemPrompt(): string {
  const env = environmentBrain.get();

  // ─── Companion identity ──────────────────────────────────────────────
  const companionPersonalities: Record<string, string> = {
    pix: "Pix — playful, energetic, creative. You bring enthusiasm and light humor. You help with social and creative tasks.",
    kai: "Kai — calm, analytical, wise. You explain clearly and help with planning, research, and learning. You speak with depth and confidence.",
    zee: "Zee — curious, empathetic, reflective. You remember personal details and offer thoughtful, supportive insights. You help with emotional and personal questions.",
  };

  let prompt =
    "You are QUIP, a calm, friendly, concise AI companion living on the user's desktop. " +
    "Be warm and human, never robotic. Keep answers short and helpful unless asked for detail. " +
    "Use markdown when it improves clarity. You are playful yet thoughtful.\n\n";

  prompt += `Right now you are ${companionPersonalities[currentCompanionId] ?? companionPersonalities.pix}\n`;

  // ─── Device context ──────────────────────────────────────────────────
  if (deviceProfile) {
    prompt +=
      `Device: ${deviceProfile.platformLabel} ${deviceProfile.osVersion}, ` +
      `${deviceProfile.cpuCores} cores, ${deviceProfile.totalMemoryGB}GB RAM, ` +
      `${deviceProfile.primaryResolution.width}x${deviceProfile.primaryResolution.height}.\n`;
    if (deviceProfile.defaultBrowser) {
      prompt += `Default browser: ${deviceProfile.defaultBrowser}.\n`;
    }
    if (deviceProfile.apps.length > 0) {
      const appList = deviceProfile.apps
        .slice(0, 12)
        .map((a) => a.name)
        .join(", ");
      prompt += `Installed apps: ${appList}.\n`;
    }
  }

  // ─── World model (what Quip can / cannot do) ─────────────────────────
  if (worldModel) {
    prompt += `\n${worldModel.summary}\n`;
  }

  // ─── Current environment ─────────────────────────────────────────────
  if (env.network.online === false) {
    prompt += "\nNOTE: The user is currently OFFLINE. Web actions may fail.\n";
  }
  if (env.battery.supported && !env.battery.charging && env.battery.level < 0.2) {
    prompt += `NOTE: Battery is low (${Math.round(env.battery.level * 100)}%). Keep responses brief.\n`;
  }

  // ─── Workspace context (what the user is doing right now) ────────────
  const wsSummary = workspaceContext.getPromptSummary();
  if (wsSummary) {
    prompt += `\n${wsSummary}\n`;
  }

  // ─── Memory (what Quip knows about the user) ─────────────────────────
  const mem = memoryBrain.get();
  if (mem.styleDigest) {
    prompt += `\n${mem.styleDigest}\n`;
  }

  // ─── Knowledge graph (entities in the user's world) ──────────────────
  const kgSummary = knowledgeGraph.getPromptSummary();
  if (kgSummary) {
    prompt += `\n${kgSummary}\n`;
  }

  // ─── Communication style guide (relationship engine) ─────────────────
  const styleGuide = relationshipEngine.getStyleGuide();
  if (styleGuide) {
    prompt += `\n${styleGuide}\n`;
  }

  // ─── Companion mood hint ─────────────────────────────────────────────
  const moodHint = companionMood.getPromptHint(currentCompanionId);
  if (moodHint) {
    prompt += `\n${moodHint}\n`;
  }

  // ─── Behavioral rules ────────────────────────────────────────────────
  prompt +=
    "\nRules:\n" +
    "- Never assume an app is installed — check the device context above.\n" +
    "- If a task is impossible, explain why and suggest alternatives.\n" +
    "- Always explain WHY you did something (trust layer).\n" +
    "- Match the user's communication style.\n" +
    "- Be concise. Long answers only when explicitly asked.\n";

  return prompt;
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function createWindow() {
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
    x = clamped.x;
    y = clamped.y;
  } else if (panel.x > 0 || panel.y > 0) {
    const clamped = clampPosition(panel.x, panel.y, w, h);
    x = clamped.x;
    y = clamped.y;
  } else {
    x = area.x + area.width - w - 20;
    y = area.y + area.height - h - 20;
  }

  mainWindow = new BrowserWindow({
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

  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
  });
  mainWindow.showInactive();
  mainWindow.moveTop();

  mainWindow.once("ready-to-show", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.moveTop();
    }
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.on("move", () => {
    if (!mainWindow) return;
    const [px, py] = mainWindow.getPosition();
    writePosition(px, py);
  });

  if (isDev) {
    mainWindow.webContents.on("did-finish-load", () => {
      mainWindow?.webContents.openDevTools({ mode: "detach" });
    });
  }
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.moveTop();
}

function sendToRenderer(channel: string, data: unknown) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------
function createTray() {
  const icon = nativeImage.createFromBuffer(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAO0lEQVR4nO3OQQ0AIAwEMP7Z36EBcZJmBEwQ1kYSYUdA1uT+rz0AAAAAAAAAAAAAAAAAAAAAAAAAAL51NekDHNd7rTAAAAAASUVORK5CYII=",
      "base64"
    )
  );
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("Quip — AI Companion");
  tray.on("click", () => mainWindow?.show());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show Quip", click: () => mainWindow?.show() },
      { type: "separator" },
      { label: "Quit Quip", click: () => app.quit() },
    ])
  );
}

// ---------------------------------------------------------------------------
// IPC — window movement
// ---------------------------------------------------------------------------
ipcMain.on(
  IPC.MOVE_WINDOW,
  (_e, { dx, dy }: { dx: number; dy: number }) => {
    if (!mainWindow) return;
    const [x, y] = mainWindow.getPosition();
    mainWindow.setPosition(x + dx, y + dy, false);
  }
);

ipcMain.handle(IPC.GET_WINDOW_POSITION, () => {
  if (!mainWindow) return null;
  const [x, y] = mainWindow.getPosition();
  return { x, y };
});

// ---------------------------------------------------------------------------
// IPC — chat streaming (via model router)
// ---------------------------------------------------------------------------
ipcMain.handle(IPC.CHAT_SEND, async (_e, payload: ChatSendPayload) => {
  const systemPrompt = buildSystemPrompt();
  const win = mainWindow;
  if (!win || win.isDestroyed()) return { ok: false };

  // ─── Feed the relationship engine + companion mood + workspace ──────
  // The last user message is the current input.
  const lastUserMsg = payload.history
    .slice()
    .reverse()
    .find((m) => m.role === "user");
  if (lastUserMsg) {
    try {
      relationshipEngine.observeUserMessage(lastUserMsg.content);
      relationshipEngine.observeCodePreference(lastUserMsg.content);
      companionMood.observeUserMessage(lastUserMsg.content);
      // Record a message + conversation for companion evolution
      companionEvolution.recordMessage(currentCompanionId);
      // Check if this is the start of a new conversation (heuristic: first user msg)
      const userMsgCount = payload.history.filter((m) => m.role === "user").length;
      if (userMsgCount === 1) {
        companionEvolution.recordConversation(currentCompanionId);
      }
    } catch {
      /* non-fatal */
    }
  }

  // ─── Refresh workspace context (async, non-blocking) ───────────────
  workspaceContext.refresh().catch(() => {});

  try {
    const { full } = await modelRouter.stream(systemPrompt, payload.history, {
      onChunk: (delta: string) => {
        sendToRenderer(IPC.CHAT_CHUNK, {
          requestId: payload.requestId,
          delta,
        });
      },
    });

    // ─── Observe the assistant response for relationship engine ──────
    try {
      relationshipEngine.observeAssistantResponse(full);
    } catch {
      /* non-fatal */
    }

    // ─── Feed the conversation to the memory extractor (background) ──
    // This triggers LLM-based fact + entity extraction every N messages.
    try {
      observeMessages(currentCompanionId, payload.history);
    } catch {
      /* non-fatal */
    }

    sendToRenderer(IPC.CHAT_DONE, {
      requestId: payload.requestId,
      full,
    });

    return { ok: true };
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    // Classify the error for graceful display.
    const kind: ChatErrorPayload["kind"] = msg.includes("no-groq-key")
      || msg.includes("no-openrouter-key")
      ? "no-key"
      : msg.includes("401")
        ? "http"
        : "network";

    const userMessage =
      kind === "no-key"
        ? "No AI key configured. Add GROQ_API_KEY to your .env file."
        : kind === "http"
          ? "AI provider rejected the key. Check your .env."
          : "Network error. Check your connection.";

    sendToRenderer(IPC.CHAT_ERROR, {
      requestId: payload.requestId,
      message: userMessage,
      kind,
    });

    return { ok: false };
  }
});

// ---------------------------------------------------------------------------
// IPC — set current companion (so system prompt can adapt)
// ---------------------------------------------------------------------------
ipcMain.on("quip:set-companion", (_e, id: "pix" | "kai" | "zee") => {
  if (id === "pix" || id === "kai" || id === "zee") {
    currentCompanionId = id;
  }
});

// ---------------------------------------------------------------------------
// IPC — task execution (via task brain)
// ---------------------------------------------------------------------------
ipcMain.handle(
  IPC.TASK_EXECUTE,
  async (_e, payload: TaskExecutePayload): Promise<TaskResultPayload> => {
    const profile = deviceProfile ?? (await ensureProfile(app.getPath("userData")));
    const env = environmentBrain.get();

    const result = await runTask(payload.command, payload.requestId, profile, env, {
      onProgress: (step, total, description) => {
        sendToRenderer(IPC.TASK_PROGRESS, {
          requestId: payload.requestId,
          step,
          total,
          description,
        } as TaskProgressPayload);
      },
      requestConfirmation: (description, capability) => {
        return new Promise<boolean>((resolve) => {
          const id = `confirm-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          pendingConfirmations.set(id, { resolve });

          const req: ConfirmationRequest = {
            id,
            requestId: payload.requestId,
            description,
            capability,
          };
          sendToRenderer(IPC.CONFIRMATION_REQUEST, req);
        });
      },
    });

    // ─── Record task completion for companion evolution ───────────────
    if (result.success && !result.plan?.isChat) {
      try {
        companionEvolution.recordTask(currentCompanionId);
      } catch {
        /* non-fatal */
      }
    }

    return result;
  }
);

ipcMain.on(
  IPC.CONFIRMATION_RESOLVE,
  (_e, payload: ConfirmationResolvePayload) => {
    const pending = pendingConfirmations.get(payload.id);
    if (pending) {
      pending.resolve(payload.approved);
      pendingConfirmations.delete(payload.id);
    }
  }
);

// ---------------------------------------------------------------------------
// IPC — device brain
// ---------------------------------------------------------------------------
ipcMain.handle(IPC.GET_DEVICE_PROFILE, async () => {
  if (deviceProfile) return deviceProfile;
  try {
    deviceProfile = await ensureProfile(app.getPath("userData"));
    return deviceProfile;
  } catch {
    return null;
  }
});

ipcMain.handle(IPC.RESCAN_DEVICE, async () => {
  try {
    deviceProfile = await ensureProfile(app.getPath("userData"), 0); // force rescan
    if (deviceProfile) {
      worldModel = ensureWorldModel(app.getPath("userData"), deviceProfile);
      spatialConfig = computeSpatial(deviceProfile);
    }
    return deviceProfile;
  } catch {
    return null;
  }
});

// ---------------------------------------------------------------------------
// IPC — spatial brain
// ---------------------------------------------------------------------------
ipcMain.handle(IPC.GET_SPATIAL_CONFIG, () => {
  return spatialConfig ?? null;
});

// ---------------------------------------------------------------------------
// IPC — memory brain (extended: pin + prune)
// ---------------------------------------------------------------------------
ipcMain.handle(IPC.GET_MEMORIES, () => {
  return memoryBrain.get();
});

ipcMain.handle(IPC.FORGET_MEMORY, (_e, id: string) => {
  memoryBrain.forget(id);
});

ipcMain.handle(IPC.PIN_MEMORY, (_e, id: string) => {
  memoryBrain.pin(id);
});

ipcMain.handle(IPC.PRUNE_MEMORIES, () => {
  const mem = memoryBrain.get();
  const { retained, report } = runPrune(mem.memories);
  // Bulk-replace with the retained set
  memoryBrain.replaceAll(retained);
  return {
    total: report.totalMemories,
    pruned: report.pruned,
    retained: report.retained,
  };
});

// ---------------------------------------------------------------------------
// IPC — knowledge graph
// ---------------------------------------------------------------------------
ipcMain.handle(IPC.GET_KNOWLEDGE_GRAPH, () => {
  return knowledgeGraph.get();
});

ipcMain.handle(IPC.REMOVE_ENTITY, (_e, id: string) => {
  knowledgeGraph.removeEntity(id);
});

// ---------------------------------------------------------------------------
// IPC — workspace context
// ---------------------------------------------------------------------------
ipcMain.handle(IPC.GET_WORKSPACE_CONTEXT, async () => {
  return await workspaceContext.refresh();
});

// ---------------------------------------------------------------------------
// IPC — relationship engine (communication DNA)
// ---------------------------------------------------------------------------
ipcMain.handle(IPC.GET_USER_PROFILE, () => {
  return relationshipEngine.get();
});

ipcMain.handle(IPC.RESET_USER_PROFILE, () => {
  relationshipEngine.reset();
});

// ---------------------------------------------------------------------------
// IPC — companion mood
// ---------------------------------------------------------------------------
ipcMain.handle(IPC.GET_COMPANION_MOOD, (_e, id: string) => {
  if (id !== "pix" && id !== "kai" && id !== "zee") return null;
  return companionMood.getMood(id);
});

// ---------------------------------------------------------------------------
// IPC — companion evolution
// ---------------------------------------------------------------------------
ipcMain.handle(IPC.GET_COMPANION_PROGRESSION, () => {
  return companionEvolution.getAll();
});

// Wire the cosmetic unlock callback to push to renderer
companionEvolution.onUnlock((unlock) => {
  sendToRenderer(IPC.ON_COSMETIC_UNLOCK, unlock);
});

// ---------------------------------------------------------------------------
// IPC — model router
// ---------------------------------------------------------------------------
ipcMain.handle(IPC.GET_MODEL_STATUS, () => {
  return modelRouter.status();
});

// ---------------------------------------------------------------------------
// IPC — permission system
// ---------------------------------------------------------------------------
ipcMain.handle(IPC.GET_PERMISSIONS, () => {
  return permissionSystem.listRules();
});

ipcMain.handle(
  IPC.UPDATE_PERMISSION,
  (_e, { capability, granted }: { capability: string; granted: boolean }) => {
    permissionSystem.recordDecision(capability as CapabilityId, granted, granted);
  }
);

// ---------------------------------------------------------------------------
// IPC — bootstrap progress (sent to renderer during startup)
// ---------------------------------------------------------------------------
// The bootstrap function will call this internally.
function sendBootstrapProgress(p: BootstrapProgress) {
  sendToRenderer(IPC.BOOTSTRAP_PROGRESS, p);
}

// ---------------------------------------------------------------------------
// App lifecycle — bootstrap on ready
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    // Run the full bootstrap pipeline.
    let bootResult: BootstrapResult;
    try {
      bootResult = await bootstrap(sendBootstrapProgress);
    } catch {
      bootResult = { profile: null, worldModel: null, ok: false };
    }

    // Store bootstrap results.
    if (bootResult.profile) {
      deviceProfile = bootResult.profile;
    }
    if (bootResult.worldModel) {
      worldModel = bootResult.worldModel;
    }

    // Compute spatial config from device profile.
    if (deviceProfile) {
      spatialConfig = computeSpatial(deviceProfile);

      // Watch for display changes.
      watchSpatial(deviceProfile, (cfg) => {
        spatialConfig = cfg;
        sendToRenderer(IPC.SPATIAL_CHANGE, cfg);
      });
    }

    // Subscribe to environment changes and push to renderer.
    // Also feed the companion mood + workspace context brains.
    environmentBrain.subscribe((env: EnvironmentState) => {
      sendToRenderer(IPC.ENVIRONMENT_CHANGE, env);
      // Feed companion mood (throttled internally)
      try {
        companionMood.observeEnvironment(env);
      } catch {
        /* non-fatal */
      }
      // Refresh workspace context periodically (it reads the foreground window)
      workspaceContext.refresh().catch(() => {});
    });

    // Create the window + tray.
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
