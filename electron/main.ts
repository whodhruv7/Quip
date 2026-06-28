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
loadEnvFile(path.join(process.cwd(), ".env"));
loadEnvFile(path.join(app.getAppPath(), ".env"));
loadEnvFile(path.join(app.getPath("userData"), ".env"));

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
import { fsStorage } from "./brains/memory-brain-instance";
import { environmentBrain } from "./brains/environment-brain";
import { memoryBrain } from "./brains/memory-brain-instance";
import { computeSpatial, watchSpatial } from "./brains/spatial-brain";
import { runTask } from "./brains/task-brain";
import { knowledgeGraph } from "./brains/knowledge-graph";
import { workspaceContext } from "./brains/workspace-context";
import { relationshipEngine } from "./brains/relationship-engine";
import { companionMood } from "./brains/companion-mood";
import { companionEvolution } from "./brains/companion-evolution";
import { runPrune } from "./brains/memory-importance";
import { MemoryExtractorBrain } from "./brains/memory-extractor";
import { timelineBrain } from "./brains/timeline-brain";
// Phase 2
import { communicationDNA } from "./brains/communication-dna";
import { proactiveEngine } from "./brains/proactive-engine";
import { weeklyReflection } from "./brains/weekly-reflection";
// Phase 3
import { swarmManager } from "./brains/swarm-manager";
// Phase 4
import { dreamEngine } from "./brains/dream-engine";

const memoryExtractor = new MemoryExtractorBrain({
  modelRouter,
  memoryBrain,
  knowledgeGraph,
  companionEvolution
});

// Execution Engine V2
import { orchestrator } from "./engine/orchestrator";
import { permissionSystem as execPermissionSystem, type ApprovalRequest } from "./engine/permission-modes";

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
const windows = new Map<number, BrowserWindow>();
const windowCompanionMap = new Map<number, "pix" | "kai" | "ren">();
let tray: Tray | null = null;

let deviceProfile: DeviceProfile | null = null;
let worldModel: WorldModel | null = null;
let spatialConfig: SpatialConfig | null = null;

// The default companion (set by renderer via IPC). Defaults to "pix".
let defaultCompanionId: "pix" | "kai" | "ren" = "pix";

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

/**
 * Build a token-efficient system prompt. Sections are prioritized and
 * capped at ~500 tokens. Knowledge graph + memories are filtered by
 * relevance to the current user message (RAG-style).
 *
 * @param userMessage - the current user message (for relevance filtering)
 */
function buildSystemPrompt(userMessage?: string, companionId: "pix" | "kai" | "ren" = "pix"): string {
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
      `You are ${companionPersonalities[companionId] ?? companionPersonalities.pix}`
  );

  // ─── 2. Device context (compressed) ─────────────────────────────────
  if (deviceProfile) {
    const deviceParts: string[] = [
      `Device: ${deviceProfile.platformLabel} ${deviceProfile.osVersion}`,
    ];
    if (deviceProfile.defaultBrowser) {
      deviceParts.push(`Browser: ${deviceProfile.defaultBrowser}`);
    }
    // Only list app names, max 8 (was 12)
    if (deviceProfile.apps.length > 0) {
      deviceParts.push(
        `Apps: ${deviceProfile.apps.slice(0, 8).map((a) => a.name).join(", ")}`
      );
    }
    sections.push(deviceParts.join(" | "));
  }

  // ─── 3. World model (always — prevents hallucination) ───────────────
  if (worldModel) {
    sections.push(worldModel.summary);
  }

  // ─── 4. Environment (only if actionable) ────────────────────────────
  if (env.network.online === false) {
    sections.push("NOTE: User is OFFLINE. Web actions may fail.");
  }
  if (env.battery.supported && !env.battery.charging && env.battery.level < 0.2) {
    sections.push(
      `NOTE: Battery low (${Math.round(env.battery.level * 100)}%). Be brief.`
    );
  }

  // ─── 5. Workspace context (only if online — skip if offline) ────────
  if (env.network.online) {
    const wsSummary = workspaceContext.getPromptSummary();
    if (wsSummary) sections.push(wsSummary);
  }

  // ─── 6. Relevant memories (RAG — filtered by user message) ──────────
  const mem = memoryBrain.get();
  if (mem.memories.length > 0) {
    let relevantMemories = mem.memories;
    if (userMessage) {
      // RAG: filter memories by keyword overlap with user message
      const msgWords = new Set(
        userMessage
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length > 2)
      );
      relevantMemories = mem.memories
        .map((m) => {
          const memText = `${m.key} ${m.value}`.toLowerCase();
          let score = 0;
          msgWords.forEach((w) => {
            if (memText.includes(w)) score++;
          });
          // High-importance memories always included
          if (m.importance === "high") score += 2;
          return { m, score };
        })
        .filter((x) => x.score > 0 || x.m.importance === "high")
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
        .map((x) => x.m);
    } else {
      // No user message (e.g., first load) — top by weight
      relevantMemories = mem.memories
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 8);
    }
    if (relevantMemories.length > 0) {
      const memLines = relevantMemories.map((m) => {
        const tag =
          m.kind === "contact" ? `${m.key}=${m.value}`
          : m.kind === "preference" ? `prefers ${m.value}`
          : `${m.key}: ${m.value}`;
        return `- ${tag}`;
      });
      sections.push(`Known about user:\n${memLines.join("\n")}`);
    }
  }

  // ─── 7. Relevant knowledge graph entities (filtered) ────────────────
  if (userMessage) {
    const entities = knowledgeGraph.findEntities(userMessage);
    if (entities.length > 0) {
      const entityLines = entities.slice(0, 5).map((e) => {
        const attrs = Object.entries(e.attributes)
          .filter(([k]) => k !== "isSelf")
          .map(([k, v]) => `${k}=${v}`)
          .join(", ");
        return `- ${e.name} [${e.type}]${attrs ? ` {${attrs}}` : ""}`;
      });
      sections.push(`Relevant entities:\n${entityLines.join("\n")}`);
    }
  }

  // ─── 8. Communication style (relationship engine) ───────────────────
  const styleGuide = relationshipEngine.getStyleGuide();
  if (styleGuide) sections.push(styleGuide);

  // ─── 8.5. Timeline Context ──────────────────────────────────────────
  const timelineSummary = timelineBrain.getTodaySummary();
  if (timelineSummary && timelineSummary !== "No significant activity recorded today.") {
    sections.push(`Recent Activity: ${timelineSummary}`);
  }

  // ─── 9. Companion mood ─────────────────────────────────────────────
  const moodHint = companionMood.getPromptHint(companionId);
  if (moodHint) sections.push(moodHint);

  // ─── Phase 2: Communication DNA (injected after style guide) ───────
  const memState = memoryBrain.get();
  const userProfile = relationshipEngine.get();
  const dna = communicationDNA.compute(userProfile, memState);
  if (dna.promptFragment) {
    sections.push(`Communication Style:\n${dna.promptFragment}`);
  }

  // ─── 10. Rules (always — short) ─────────────────────────────────────
  sections.push(
    "Rules: Never assume apps exist (check above). If impossible, explain + suggest. " +
      "Always explain WHY (trust layer). Match user's style. Be concise."
  );

  return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function createWindow(companionId: "pix" | "kai" | "ren" = "pix", offsetX = 0, offsetY = 0) {
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
  tray.on("click", () => {
    if (windows.size === 0) createWindow(defaultCompanionId);
    else windows.forEach(w => w.show());
  });
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show Quip", click: () => {
          if (windows.size === 0) createWindow(defaultCompanionId);
          else windows.forEach(w => w.show());
      } },
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
});

// ---------------------------------------------------------------------------
// IPC — chat streaming (via model router)
// ---------------------------------------------------------------------------
ipcMain.handle(IPC.CHAT_SEND, async (_e, payload: ChatSendPayload) => {
  const win = BrowserWindow.fromWebContents(_e.sender);
  if (!win || win.isDestroyed()) return { ok: false };
  const companionId = windowCompanionMap.get(win.id) ?? defaultCompanionId;


  // ─── Feed the relationship engine + companion mood + workspace ──────
  // The last user message is the current input.
  const lastUserMsg = payload.history
    .slice()
    .reverse()
    .find((m) => m.role === "user");

  // Build system prompt with relevance filtering based on the user message
  const systemPrompt = buildSystemPrompt(lastUserMsg?.content, companionId);
  if (lastUserMsg) {
    try {
      relationshipEngine.observeUserMessage(lastUserMsg.content);
      relationshipEngine.observeCodePreference(lastUserMsg.content);
      companionMood.observeUserMessage(lastUserMsg.content);
      // Record a message + conversation for companion evolution
      companionEvolution.recordMessage(companionId);
      // Check if this is the start of a new conversation (heuristic: first user msg)
      const userMsgCount = payload.history.filter((m) => m.role === "user").length;
      if (userMsgCount === 1) {
        companionEvolution.recordConversation(companionId);
        timelineBrain.logEvent({
          title: `Started conversation with ${companionId}`,
          type: "present_activity",
          timestamp: Date.now()
        });
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
        sendToWindow(win, IPC.CHAT_CHUNK, {
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
      memoryExtractor.observeMessages(companionId, payload.history);
    } catch {
      /* non-fatal */
    }

    sendToWindow(win, IPC.CHAT_DONE, {
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

    sendToWindow(win, IPC.CHAT_ERROR, {
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
ipcMain.on("quip:set-companion", (_e, id: "pix" | "kai" | "ren") => {
  if (id === "pix" || id === "kai" || id === "ren") {
    defaultCompanionId = id;
    const win = BrowserWindow.fromWebContents(_e.sender);
    if (win) windowCompanionMap.set(win.id, id);
  }
});

// ---------------------------------------------------------------------------
// IPC — task execution (via Execution Engine V2 orchestrator)
// ---------------------------------------------------------------------------
ipcMain.handle(
  IPC.TASK_EXECUTE,
  async (_e, payload: TaskExecutePayload): Promise<TaskResultPayload> => {
    const profile = deviceProfile ?? (await ensureProfile(app.getPath("userData")));
    const platform = profile.platform;

    // Set up approval callback — forwards to renderer
    const win = BrowserWindow.fromWebContents(_e.sender);
    const companionId = win ? windowCompanionMap.get(win.id) ?? defaultCompanionId : defaultCompanionId;

    // Set up approval callback — forwards to renderer
    execPermissionSystem.onApprovalRequested = (request: ApprovalRequest) => {
      sendToWindow(win, "quip:approval-request", request);
    };

    const result = await orchestrator.execute(payload.command, {
      platform,
      onProgress: (update) => {
        sendToWindow(win, IPC.TASK_PROGRESS, {
          requestId: payload.requestId,
          step: update.step,
          total: update.total,
          description: update.description,
        } as TaskProgressPayload);
      },
    });

    // Record task completion for companion evolution and timeline
    if (result.success && result.stepsTotal > 0) {
      try {
        companionEvolution.recordTask(companionId);
        timelineBrain.logEvent({
          title: `Executed task: ${payload.command}`,
          type: "present_activity",
          timestamp: Date.now()
        });
      } catch {
        /* non-fatal */
      }
    }

    return {
      requestId: payload.requestId,
      success: result.success,
      summary: result.summary,
      notes: result.notes,
      plan: {
        id: payload.requestId,
        requestId: payload.requestId,
        intent: { type: "open_app", target: null, query: null, confidence: 0, verbs: [], raw: payload.command },
        subtasks: [],
        summary: result.summary,
        isChat: result.stepsTotal === 0,
        createdAt: Date.now(),
      } as any,
    };
  }
);

// ---------------------------------------------------------------------------
// IPC — approval resolution (user taps Approve/Reject)
// ---------------------------------------------------------------------------
ipcMain.on("quip:approval-resolve", (_e, { id, approved }: { id: string; approved: boolean }) => {
  execPermissionSystem.resolveApproval(id, approved);
});

// ---------------------------------------------------------------------------
// IPC — permission mode control
// ---------------------------------------------------------------------------
ipcMain.handle("quip:get-permission-mode", () => {
  return { mode: execPermissionSystem.getMode(), label: execPermissionSystem.getModeLabel() };
});

ipcMain.handle("quip:set-permission-mode", (_e, mode: string) => {
  if (mode === "ask_every_time" || mode === "approve_task" || mode === "full_access") {
    execPermissionSystem.setMode(mode);
  }
  return { mode: execPermissionSystem.getMode(), label: execPermissionSystem.getModeLabel() };
});

ipcMain.handle("quip:cycle-permission-mode", () => {
  execPermissionSystem.cycleMode();
  return { mode: execPermissionSystem.getMode(), label: execPermissionSystem.getModeLabel() };
});

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
// IPC — Phase 3: Swarm Mode (managed by SwarmManager)
// ---------------------------------------------------------------------------
ipcMain.handle(IPC.SPAWN_COMPANION, (_e, payload: { companionId: "pix" | "kai" | "ren"; headless?: boolean; autoTask?: string }) => {
  const winId = swarmManager.spawn(payload.companionId, {
    headless: payload.headless ?? false,
    autoTask: payload.autoTask,
  });
  return { winId };
});

ipcMain.handle(IPC.DISMISS_COMPANION, (_e, { winId }: { winId: number }) => {
  swarmManager.dismiss(winId);
});

ipcMain.handle(IPC.GET_SWARM_INSTANCES, () => {
  return swarmManager.getInstances();
});

ipcMain.on(IPC.INTER_COMPANION_MSG, (_e, payload: { to: "pix" | "kai" | "ren"; message: string }) => {
  const fromWin = BrowserWindow.fromWebContents(_e.sender);
  if (!fromWin) return;
  swarmManager.routeMessage(fromWin.id, payload.to, payload.message);
});

// ---------------------------------------------------------------------------
// IPC — Phase 2: Proactive Suggestions
// ---------------------------------------------------------------------------
ipcMain.on(IPC.DISMISS_PROACTIVE, () => {
  // No-op — just acknowledged by renderer. Could log if needed.
});

// ---------------------------------------------------------------------------
// IPC — Phase 2: Weekly Reflection
// ---------------------------------------------------------------------------
ipcMain.handle(IPC.GET_WEEKLY_DIGEST, () => {
  const events = timelineBrain.getAllEvents();
  const memories = memoryBrain.get();
  const profile = relationshipEngine.get();
  return weeklyReflection.buildDigest(events, memories, profile);
});

ipcMain.handle(IPC.RECORD_REFLECTION_FEEDBACK, (_e, payload: { feedback: string }) => {
  const events = timelineBrain.getAllEvents();
  const memories = memoryBrain.get();
  const profile = relationshipEngine.get();
  const digest = weeklyReflection.buildDigest(events, memories, profile);
  weeklyReflection.recordReflection(digest.naturalSummary, payload.feedback);
  return { ok: true };
});

ipcMain.handle(IPC.TRIGGER_WEEKLY_REFLECTION, () => {
  const events = timelineBrain.getAllEvents();
  const memories = memoryBrain.get();
  const profile = relationshipEngine.get();
  return weeklyReflection.buildDigest(events, memories, profile);
});

// ---------------------------------------------------------------------------
// IPC — Phase 2: Communication DNA
// ---------------------------------------------------------------------------
ipcMain.handle(IPC.GET_COMMUNICATION_DNA, () => {
  const profile = relationshipEngine.get();
  const memories = memoryBrain.get();
  const dna = communicationDNA.compute(profile, memories);
  return {
    toneLabel: dna.toneLabel,
    preferredLength: dna.preferredLength,
    usesEmoji: dna.usesEmoji,
    prefersCode: dna.prefersCode,
    styleFacts: dna.styleFacts,
  };
});


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
      worldModel = await ensureWorldModel(app.getPath("userData"), deviceProfile, fsStorage);
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
  if (id !== "pix" && id !== "kai" && id !== "ren") return null;
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
  broadcastToRenderers(IPC.ON_COSMETIC_UNLOCK, unlock);
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
  broadcastToRenderers(IPC.BOOTSTRAP_PROGRESS, p);
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
        broadcastToRenderers(IPC.SPATIAL_CHANGE, cfg);
      });
    }

    // Initialize Timeline Brain
    timelineBrain.init(app.getPath("userData"));

    // Initialize Phase 4 Dream Engine
    dreamEngine.init(app.getPath("userData"), modelRouter);

    // Initialize Phase 2 brains
    weeklyReflection.init(app.getPath("userData"));
    proactiveEngine.start();

    // Configure Phase 3 SwarmManager with correct asset paths
    swarmManager.configure(
      path.join(__dirname, "preload.js"),
      path.join(__dirname, "../dist")
    );

    // Check if weekly reflection is due (on startup)
    const lastReflectionMs = weeklyReflection.getLastReflectionMs();
    proactiveEngine.checkWeeklyReflection(lastReflectionMs);

    // Subscribe proactive engine to emit suggestions to all windows
    proactiveEngine.subscribe((suggestion) => {
      broadcastToRenderers(IPC.PROACTIVE_SUGGESTION, suggestion);
    });

    // Subscribe to environment changes and push to renderer.
    // Also feed the companion mood + workspace context brains.
    environmentBrain.subscribe((env: EnvironmentState) => {
      broadcastToRenderers(IPC.ENVIRONMENT_CHANGE, env);
      // Feed companion mood (throttled internally)
      try {
        companionMood.observeEnvironment(env);
      } catch {
        /* non-fatal */
      }
      // Phase 2: Check battery for proactive suggestions
      try {
        proactiveEngine.checkBatteryCritical(env.battery.level, env.battery.charging);
      } catch {
        /* non-fatal */
      }
      // Phase 4: Check if idle and trigger dream
      try {
        dreamEngine.checkIdleAndDream(
          env.idleSeconds,
          timelineBrain.getAllEvents(),
          relationshipEngine.get(),
          memoryBrain.get()
        );
      } catch {
        /* non-fatal */
      }
      // Refresh workspace context periodically (it reads the foreground window)
      workspaceContext.refresh().catch(() => {});
    });

    // Phase 3: Create the initial window via SwarmManager
    swarmManager.spawn(defaultCompanionId);
    createTray();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  }).catch((err) => {
    console.error("FATAL STARTUP ERROR:", err);
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  // Flush debounced saves on quit
  app.on("before-quit", () => {
    try {
      memoryBrain.flush();
    } catch {
      /* non-fatal */
    }
  });
}
