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
  WindowMode,
} from "./shared";

import { bootstrap, BootstrapResult } from "./system/bootstrap";
import { modelRouter, describeError, ModelTransportError } from "./system/model-router";
import { permissionSystem } from "./system/permission-system";
import {
  PROVIDER_KEY_VAR,
  PROVIDER_MODEL_VAR,
  PROVIDER_ENABLED_VAR,
  PROVIDER_ORDER,
  PROVIDER_LABEL,
  DEFAULT_MODELS,
  validateApiKey,
  upsertEnvFile,
  maskKey,
  type ProviderId,
} from "./system/env-store";
import { probeProvider } from "./system/provider-probe";
import { discoverModels } from "./system/model-discovery";
import { speakText, stopSpeaking, getSpeakConfig, speakConfigEnvEntries, type SpeakConfig } from "./system/speech";
import { clampRect } from "./window-geometry";

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
import { bindAgentBrain } from "./engine/agent-loop";
import { bindVisionBrain } from "./engine/screen-vision";
import { permissionSystem as execPermissionSystem, type ApprovalRequest } from "./engine/permission-modes";
import { invalidateAppIndex } from "./engine/tool-registry";
import { parseIntentV2 } from "./engine/intent-parser-v2";
import { contextStore } from "./engine/context-store";

// The orchestrator uses the model ONLY for ambiguous intent (compact schema,
// one small call) — deterministic tools handle the obvious actions.
orchestrator.setModelRouter(modelRouter);
// The agent loop + screen vision run on the SAME router — the user's Groq
// key powers both the brain (tool calling) and the eyes (llama-4 vision).
bindAgentBrain(modelRouter);
bindVisionBrain(modelRouter);

import type {
  DeviceProfile,
  WorldModel,
  SpatialConfig,
  EnvironmentState,
  TaskResultPayload,
  BootstrapProgress,
  CapabilityId,
} from "../src/types";

// ─── State ───────────────────────────────────────────────────────────────────
const isDev = process.env.NODE_ENV === "development";
const windows = new Map<number, BrowserWindow>();
const windowCompanionMap = new Map<number, "pix" | "kai" | "ren" | "bubbles" | "capy" | "skales">();
let tray: Tray | null = null;

// True only while app.quit() is running — window close events are intercepted
// until then so Alt+F4 hides the companion instead of killing Quip.
let isQuitting = false;

// The desktop companion stays on screen until the user turns it off in
// Settings. Persisted so restarts honor the choice (spec: the setting must
// actually persist and work).
let companionVisible = true;
const COMPANION_VISIBLE_FILE = "quip-companion-visible.json";

let deviceProfile: DeviceProfile | null = null;
let worldModel: WorldModel | null = null;
let spatialConfig: SpatialConfig | null = null;

// The default companion (set by renderer via IPC). Defaults to "pix".
let defaultCompanionId: "pix" | "kai" | "ren" | "bubbles" | "capy" | "skales" = "pix";

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
  return clampRect({ x, y, width: w, height: h }, area);
}

/** Force a window back into the visible work area (self-heal after display changes). */
function clampWindowIntoView(win: BrowserWindow) {
  if (win.isDestroyed() || win.isMinimized()) return;
  const [x, y] = win.getPosition();
  const [w, h] = win.getSize();
  const area = screen.getPrimaryDisplay().workArea;
  const c = clampRect({ x, y, width: w, height: h }, area);
  if (c.x !== x || c.y !== y) {
    win.setPosition(c.x, c.y, false);
    if (windowModes.get(win.id) !== "full") writePosition(c.x, c.y);
  }
}

// ---------------------------------------------------------------------------
// Companion visibility — the companion stays on screen until the user turns
// it off in Settings. Off = NO floating anything; Quip lives in the tray.
// ---------------------------------------------------------------------------
function readCompanionVisible(): boolean {
  try {
    const p = path.join(app.getPath("userData"), COMPANION_VISIBLE_FILE);
    if (!fs.existsSync(p)) return true;
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    return data.visible !== false; // default ON
  } catch {
    return true;
  }
}

function writeCompanionVisible(visible: boolean) {
  try {
    const p = path.join(app.getPath("userData"), COMPANION_VISIBLE_FILE);
    fs.writeFileSync(p, JSON.stringify({ visible }));
  } catch {
    /* best effort */
  }
}

function applyCompanionVisible(visible: boolean, opts: { persist?: boolean; announce?: boolean } = {}) {
  companionVisible = visible;
  if (opts.persist !== false) writeCompanionVisible(visible);

  for (const win of windows.values()) {
    if (win.isDestroyed()) continue;
    if (visible) {
      const mode = windowModes.get(win.id) ?? "companion";
      win.showInactive();
      win.moveTop();
      win.setAlwaysOnTop(mode !== "full", "screen-saver");
      clampWindowIntoView(win);
    } else {
      win.hide();
    }
  }
  if (tray) tray.setToolTip(visible ? "Quip — AI Companion" : "Quip — running in the tray");
  if (opts.announce !== false) {
    broadcastToRenderers(IPC.COMPANION_VISIBLE_CHANGED, companionVisible);
  }
}

// ---------------------------------------------------------------------------
// Window modes — companion sprite / small panel / full app.
//
// companion : a tiny transparent window holding just the companion sprite.
// panel     : the window grows — small chat panel with the companion beside it.
// full      : the full Quip application, centered.
// ---------------------------------------------------------------------------
const COMPANION_MODE_SIZE = { width: 132, height: 176 };
const PANEL_MODE_SIZE = { width: 548, height: 560 };
const windowModes = new Map<number, WindowMode>();

function fullAppBounds(): { width: number; height: number } {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    width: Math.min(1060, area.width - 48),
    height: Math.min(680, area.height - 48),
  };
}

/** Keep the bottom-right corner fixed so the companion stays visually in place. */
function anchorBottomRight(
  cur: { x: number; y: number; width: number; height: number },
  nextW: number,
  nextH: number
) {
  return clampPosition(cur.x + cur.width - nextW, cur.y + cur.height - nextH, nextW, nextH);
}

function setWindowMode(win: BrowserWindow, mode: WindowMode) {
  if (win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  const [w, h] = win.getSize();
  const cur = { x, y, width: w, height: h };
  const area = screen.getPrimaryDisplay().workArea;

  let next: { x: number; y: number; width: number; height: number };
  if (mode === "panel") {
    const c = anchorBottomRight(cur, PANEL_MODE_SIZE.width, PANEL_MODE_SIZE.height);
    next = { x: c.x, y: c.y, width: PANEL_MODE_SIZE.width, height: PANEL_MODE_SIZE.height };
  } else if (mode === "full") {
    const size = fullAppBounds();
    next = {
      x: area.x + Math.round((area.width - size.width) / 2),
      y: area.y + Math.round((area.height - size.height) / 2),
      width: size.width,
      height: size.height,
    };
  } else {
    const c = anchorBottomRight(cur, COMPANION_MODE_SIZE.width, COMPANION_MODE_SIZE.height);
    next = { x: c.x, y: c.y, width: COMPANION_MODE_SIZE.width, height: COMPANION_MODE_SIZE.height };
  }

  win.setResizable(true);
  win.setBounds(next);
  win.setResizable(mode === "full");
  win.setAlwaysOnTop(mode !== "full", "screen-saver");
  if (mode === "full") {
    win.setMinimumSize(760, 520);
  } else {
    win.setMinimumSize(0, 0);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  windowModes.set(win.id, mode);
  if (!win.isVisible()) win.showInactive();
  win.webContents.send(IPC.WINDOW_MODE_CHANGED, mode);
}

/**
 * Build a token-efficient system prompt. Sections are prioritized and
 * capped at ~500 tokens. Knowledge graph + memories are filtered by
 * relevance to the current user message (RAG-style).
 *
 * @param userMessage - the current user message (for relevance filtering)
 */
function buildSystemPrompt(userMessage?: string, companionId: "pix" | "kai" | "ren" | "bubbles" | "capy" | "skales" = "pix"): string {
  const env = environmentBrain.get();
  const sections: string[] = [];

  // ─── 1. Core identity + companion (always) ──────────────────────────
  const companionPersonalities: Record<string, string> = {
    pix: "Pix — playful, energetic, creative. Light humor. Social + creative tasks.",
    kai: "Kai — calm, analytical, wise. Clear explanations. Planning + research.",
    ren: "Ren — curious, empathetic, reflective. Personal + emotional support.",
    bubbles: "Bubbles — bubbly, joyful, playful. Cheerful energy, celebratory, light on her feet.",
    capy: "Capy — unbothered, warm, steady. Cozy calm. Nothing is a crisis.",
    skales: "Skales — the original gecko: lime, curious, always mid-task. Chases goals one small step at a time.",
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

  // ─── 8.5. Short-term execution context (1 compact line) ────────────────
  // Lets chat-mode follow-ups ("play it", "now open the latest email")
  // resolve without re-sending the whole history.
  const execContextSummary = contextStore.summary();
  if (execContextSummary) sections.push(execContextSummary);

  // ─── 8.7. Timeline Context ─────────────────────────────────────────
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
  sections.push(
    "You CAN actually control this laptop: open/close/focus/switch apps and windows, " +
      "minimize/maximize/move/resize windows, open files/folders/URLs, find/create/read/" +
      "copy/move/delete files, type, press shortcuts, click/double-click/right-click, " +
      "scroll, drag, clipboard, screenshots, search/read YouTube, Reddit, X and GitHub, " +
      "list and force-close processes (never system ones), control volume (up/down/mute/" +
      "set 0-100), send media keys (play/pause/next/previous), and control browser tabs " +
      "(new/close/switch/back/forward/reload — browser must be focused). " +
      "Never say you cannot access the device — you can. Never claim an action succeeded " +
      "unless the execution layer reports it did."
  );

  // ─── 11. Capability introspection (know what you can and cannot do) ──
  sections.push(
    "MORE things you CAN do: real weather for any city, summarize long text (or the " +
      "last page you read), extract text from PDFs, read .docx files, create real Word " +
      "(.docx), Excel (.xlsx) and PowerPoint (.pptx) files, live system status (CPU/RAM/" +
      "disk/battery), network + Wi-Fi status, speak replies OUT LOUD (you have a real " +
      "voice), read GitHub repos, V2EX, Bilibili search, and single tweets by link, " +
      "read Reddit/YouTube/RSS/web pages directly, and run shell commands (with approval)."
  );
  sections.push(
    "What you CANNOT do (say so honestly, never fake it): send Telegram/WhatsApp/Discord " +
      "messages as bots, send emails directly (you CAN open a compose window), Google " +
      "Calendar/image/video generation (no keys wired), scan files with VirusTotal, see " +
      "or control phones, or search all of X/Twitter (only single tweets by link). " +
      "When the user asks for these, say exactly what's missing and offer the nearest " +
      "thing you can do."
  );

  return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function createWindow(companionId: "pix" | "kai" | "ren" | "bubbles" | "capy" | "skales" = "pix", offsetX = 0, offsetY = 0) {
  // Quip always boots as the desktop companion — a small sprite on screen.
  // The user taps it to open the panel, and expands from there.
  const area = screen.getPrimaryDisplay().workArea;
  const saved = readPosition();
  const w = COMPANION_MODE_SIZE.width;
  const h = COMPANION_MODE_SIZE.height;

  let x: number, y: number;
  if (saved) {
    const clamped = clampPosition(saved.x, saved.y, w, h);
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
  windowModes.set(win.id, "companion");

  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
  });
  win.showInactive();
  win.moveTop();

  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) {
      // Calm boot: appear without stealing focus from the user's work.
      win.showInactive();
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
    // Persist the anchor position — but not while in full mode (the full
    // window is centered; the companion anchor should stay where it was).
    if (windows.size === 1 && windowModes.get(win.id) !== "full") {
      const [px, py] = win.getPosition();
      writePosition(px, py);
    }
  });

  // ── Renderer crash recovery ──────────────────────────────────────────
  // The window is transparent, so a dead renderer looks like the companion
  // "disappeared". Never leave the user with an invisible zombie window:
  // reload (bounded), and make sure the window is still visible afterwards.
  let reloadAttempts = 0;
  win.webContents.on("render-process-gone", (_e, details) => {
    if (details.reason === "clean-exit") return;
    if (reloadAttempts < 3) {
      reloadAttempts += 1;
      try {
        win.webContents.reload();
        if (!win.isVisible()) win.showInactive();
      } catch {
        /* window already gone */
      }
    } else {
      // Recreate the window once — a fresh renderer beats a dead sprite.
      try {
        const companion = windowCompanionMap.get(win.id) ?? defaultCompanionId;
        const mode = windowModes.get(win.id) ?? "companion";
        win.destroy();
        const fresh = createWindow(companion);
        if (mode !== "companion") setWindowMode(fresh, mode);
      } catch {
        /* best effort */
      }
    }
  });
  win.webContents.on("unresponsive", () => {
    try {
      win.webContents.forcefullyCrashRenderer(); // recovery flows through render-process-gone
    } catch {
      /* best effort */
    }
  });

  // ── Close interception — only Settings → Quit actually exits Quip ───
  // Alt+F4 / window close hides the companion (app stays in the tray).
  // When visibility is disabled in Settings the window is already hidden;
  // closing it must still not kill the app silently.
  win.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      try {
        win.hide();
      } catch {
        /* best effort */
      }
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

  // Honor the persisted visibility choice (Settings toggle).
  if (!companionVisible) win.hide();
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
function showFromTray() {
  // Tray = the user explicitly wants to see Quip → re-enable visibility.
  if (!companionVisible) applyCompanionVisible(true);
  if (windows.size === 0) {
    const win = createWindow(defaultCompanionId);
    setWindowMode(win, "panel");
    return;
  }
  for (const win of windows.values()) {
    if (win.isDestroyed()) continue;
    win.showInactive();
    win.moveTop();
    clampWindowIntoView(win);
  }
}

function createTray() {
  const icon = nativeImage.createFromBuffer(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAO0lEQVR4nO3OQQ0AIAwEMP7Z36EBcZJmBEwQ1kYSYUdA1uT+rz0AAAAAAAAAAAAAAAAAAAAAAAAAAL51NekDHNd7rTAAAAAASUVORK5CYII=",
      "base64"
    )
  );
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("Quip — AI Companion");
  tray.on("click", () => showFromTray());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show Quip", click: () => showFromTray() },
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
// IPC — window modes (companion / panel / full)
// ---------------------------------------------------------------------------
ipcMain.handle(IPC.WINDOW_MODE_SET, (_e, mode: WindowMode) => {
  const win = BrowserWindow.fromWebContents(_e.sender);
  if (!win || (mode !== "companion" && mode !== "panel" && mode !== "full")) return false;
  setWindowMode(win, mode);
  return true;
});

ipcMain.handle(IPC.WINDOW_MODE_GET, (_e) => {
  const win = BrowserWindow.fromWebContents(_e.sender);
  return (win && windowModes.get(win.id)) || "companion";
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
    const { full, provider, switched } = await modelRouter.stream(systemPrompt, payload.history, {
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
      provider,
      switched,
    });

    // ─── Auto-speak: the companion SAYS the reply out loud ───────────
    // Engine chain: Groq neural voice → laptop's built-in voice. The Groq
    // engine ships a wav through TTS_ON_AUDIO; the local engine speaks in
    // the main process (renderer gets nothing to play — it already played).
    try {
      const speakOutcome = await speakText(full);
      if (speakOutcome.ok && speakOutcome.engine === "groq" && speakOutcome.audioBase64) {
        sendToWindow(win, IPC.TTS_ON_AUDIO, {
          requestId: payload.requestId,
          engine: "groq",
          audioBase64: speakOutcome.audioBase64,
          mime: speakOutcome.mime ?? "audio/wav",
        });
      }
    } catch {
      /* speech is best-effort — the text reply already went out */
    }

    return { ok: true };
  } catch (err: any) {
    // ModelTransportError carries a stable kind + the honest failure TRAIL:
    // one line per provider explaining exactly why it couldn't answer.
    const described = describeError(err);
    const kind: ChatErrorPayload["kind"] =
      described.kind === "no-key" || described.kind === "auth"
        ? "no-key"
        : described.kind === "rate-limit" || described.kind === "http"
          ? "http"
          : described.kind === "timeout"
            ? "network"
            : "network";

    let message = described.message;
    const trail =
      err instanceof ModelTransportError && err.attempts.length > 0
        ? err.attempts.slice(0, 6).map((a) => `• ${a}`).join("\n")
        : "";
    if (trail) {
      message = `${message}\nWhat I tried:\n${trail}`;
    }

    if (kind === "network" || kind === "http") {
      console.error("model request failed:", modelRouter.diagnostics());
    }

    sendToWindow(win, IPC.CHAT_ERROR, {
      requestId: payload.requestId,
      message,
      kind,
    });

    return { ok: false };
  }
});

// ---------------------------------------------------------------------------
// IPC — set current companion (so system prompt can adapt)
// ---------------------------------------------------------------------------
ipcMain.on("quip:set-companion", (_e, id: "pix" | "kai" | "ren" | "bubbles" | "capy" | "skales") => {
  if (id === "pix" || id === "kai" || id === "ren" || id === "bubbles" || id === "capy" || id === "skales") {
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
    const workspacePath = app.getAppPath();

    // Set up approval callback — forwards to renderer
    const win = BrowserWindow.fromWebContents(_e.sender);
    const companionId = win ? windowCompanionMap.get(win.id) ?? defaultCompanionId : defaultCompanionId;

    execPermissionSystem.onApprovalRequested = (request: ApprovalRequest) => {
      sendToWindow(win, "quip:approval-request", request);
    };

    // ── Cancellation token (Stop button / stop command) ────────────────
    const cancelSignal = { aborted: false };
    taskCancelSignals.add(cancelSignal);

    // PLANNING is a real phase: from this moment until the first step starts,
    // the companion honestly shows "planning" (never a fake WORKING state).
    sendToWindow(win, IPC.TASK_PROGRESS, {
      requestId: payload.requestId,
      step: 0,
      total: 0,
      description: "Understanding what you need…",
      phase: "planning",
      status: "running",
    } as TaskProgressPayload);

    // Parse intent once for plan metadata (orchestrator re-parses internally;
    // this is a pure regex parse — no model call, negligible cost).
    const intentInfo = parseIntentV2(payload.command);

    const result = await orchestrator.execute(payload.command, {
      platform,
      workspacePath,
      signal: cancelSignal,
      onProgress: (update) => {
        sendToWindow(win, IPC.TASK_PROGRESS, {
          requestId: payload.requestId,
          step: update.step,
          total: update.total,
          description: update.description,
          phase: update.phase,
          status: update.status,
        } as TaskProgressPayload);
      },
    });

    taskCancelSignals.delete(cancelSignal);

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
      ...(result.failures?.length ? { failures: result.failures } : {}),
      plan: {
        id: payload.requestId,
        requestId: payload.requestId,
        intent: { type: intentInfo.action, target: intentInfo.target || null, query: intentInfo.query || null, confidence: intentInfo.confidence, verbs: [], raw: payload.command },
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

// ---------------------------------------------------------------------------
// IPC — Phase 3: Swarm Mode (managed by SwarmManager)
// ---------------------------------------------------------------------------
ipcMain.handle(IPC.SPAWN_COMPANION, (_e, payload: { companionId: "pix" | "kai" | "ren" | "bubbles" | "capy" | "skales"; headless?: boolean; autoTask?: string }) => {
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

ipcMain.on(IPC.INTER_COMPANION_MSG, (_e, payload: { to: "pix" | "kai" | "ren" | "bubbles" | "capy" | "skales"; message: string }) => {
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
    invalidateAppIndex();
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
  if (id !== "pix" && id !== "kai" && id !== "ren" && id !== "bubbles" && id !== "capy" && id !== "skales") return null;
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
// IPC — provider priority + enable switches (Settings → AI Brain)
// Which key is THE active brain, which stay off, live without a restart.
// Four providers: groq · cerebras · nvidia · openrouter.
// ---------------------------------------------------------------------------
ipcMain.handle(IPC.GET_PROVIDER_CONFIG, () => {
  const enabled: Record<string, boolean> = {};
  for (const p of PROVIDER_ORDER) {
    enabled[p] = process.env[PROVIDER_ENABLED_VAR[p]] !== "0";
  }
  return {
    primary: (process.env.QUIP_PRIMARY_PROVIDER as ProviderId) || "groq",
    enabled,
    visionModel: modelRouter.activeVisionModel(),
    chain: modelRouter
      .chain()
      .map((p) => p.config.provider),
  };
});

ipcMain.handle(
  IPC.SET_PROVIDER_CONFIG,
  (_e, payload: { primary?: string; enabled?: Record<string, boolean> }) => {
    const requested = (payload?.primary ?? "groq").toLowerCase() as ProviderId;
    const primary: ProviderId = PROVIDER_ORDER.includes(requested) ? requested : "groq";

    const enabled: Record<string, boolean> = {};
    for (const p of PROVIDER_ORDER) {
      enabled[p] = payload?.enabled?.[p] !== false;
    }
    if (!PROVIDER_ORDER.some((p) => enabled[p])) {
      return { ok: false, message: "At least one AI key must stay enabled — turn the other one off instead." };
    }

    const entries: Record<string, string> = { QUIP_PRIMARY_PROVIDER: primary };
    for (const p of PROVIDER_ORDER) {
      entries[PROVIDER_ENABLED_VAR[p]] = enabled[p] ? "1" : "0";
    }
    const res = upsertEnvFile(path.join(app.getPath("userData"), ".env"), entries);
    if (!res.ok) {
      return { ok: false, message: `I couldn't save the settings: ${res.error}` };
    }

    // Live-apply + rebuild the chain — no restart needed.
    process.env.QUIP_PRIMARY_PROVIDER = primary;
    for (const p of PROVIDER_ORDER) {
      process.env[PROVIDER_ENABLED_VAR[p]] = enabled[p] ? "1" : "0";
    }
    modelRouter.reload();

    const status = modelRouter.status();
    const active = status.active?.provider;
    const note = status.healthy
      ? active === primary
        ? `Done — ${PROVIDER_LABEL[primary]} is now the primary brain and it's active.`
        : `Saved — ${PROVIDER_LABEL[primary]} is the primary, but it has no key yet, so ${PROVIDER_LABEL[active as ProviderId]} answered instead.`
      : `Saved — but none of the enabled keys work yet. Paste a key below and use Test connection.`;
    return {
      ok: true,
      message: note,
      active: status.active?.provider,
    };
  }
);

// ---------------------------------------------------------------------------
// IPC — in-app API key setup (Settings → AI Brain)
// ---------------------------------------------------------------------------
ipcMain.handle(
  IPC.SAVE_MODEL_KEYS,
  (_e, payload: { provider?: string; apiKey?: string; model?: string }) => {
    const provider = (payload?.provider ?? "") as ProviderId;
    if (!PROVIDER_ORDER.includes(provider)) {
      return { ok: false, masked: "", message: "Unknown provider." };
    }
    const apiKey = (payload?.apiKey ?? "").trim();
    const entries: Record<string, string> = {};
    if (apiKey) {
      const check = validateApiKey(provider, apiKey);
      if (!check.ok) {
        return { ok: false, masked: "", message: check.message };
      }
      entries[PROVIDER_KEY_VAR[provider]] = apiKey;
    }
    const model = (payload?.model ?? "").trim();
    if (model) entries[PROVIDER_MODEL_VAR[provider]] = model;
    if (Object.keys(entries).length === 0) {
      return { ok: false, masked: "", message: "Nothing to save — paste a key or pick a model first." };
    }

    // Persist to userData/.env — the file main.ts already loads at boot.
    const res = upsertEnvFile(path.join(app.getPath("userData"), ".env"), entries);
    if (!res.ok) {
      return { ok: false, masked: "", message: `I couldn't save the key: ${res.error}` };
    }

    // Live-apply so no restart is needed.
    if (apiKey) process.env[PROVIDER_KEY_VAR[provider]] = apiKey;
    if (model) process.env[PROVIDER_MODEL_VAR[provider]] = model;
    modelRouter.reload();

    return {
      ok: true,
      masked: apiKey ? maskKey(apiKey) : "",
      message: model && !apiKey
        ? `Model switched — ${PROVIDER_LABEL[provider]} now runs ${model}.`
        : `Key saved and active (${provider}). ${maskKey(apiKey)}`,
    };
  }
);

ipcMain.handle(
  IPC.TEST_MODEL_CONNECTION,
  async (_e, payload: { provider?: string; apiKey?: string; model?: string }) => {
    const provider = (payload?.provider ?? "") as ProviderId;
    if (!PROVIDER_ORDER.includes(provider)) {
      return { ok: false, latencyMs: 0, message: "Unknown provider.", kind: "no-key" as const };
    }
    const keyVar = PROVIDER_KEY_VAR[provider];
    const modelVar = PROVIDER_MODEL_VAR[provider];
    const apiKey = (payload?.apiKey ?? "").trim() || process.env[keyVar] || "";
    const model = (payload?.model ?? "").trim() || process.env[modelVar] || DEFAULT_MODELS[provider];
    const result = await probeProvider(provider, apiKey, model);
    return result;
  }
);

// ---------------------------------------------------------------------------
// IPC — model discovery: every model the user's key can reach, per provider.
// Powers the Settings model browser (scroll through them all, pick one).
// ---------------------------------------------------------------------------
ipcMain.handle(IPC.LIST_PROVIDER_MODELS, async (_e, payload: { provider?: string; apiKey?: string }) => {
  const provider = (payload?.provider ?? "") as ProviderId;
  if (!PROVIDER_ORDER.includes(provider)) {
    return { ok: false, models: [], message: "Unknown provider." };
  }
  const apiKey = (payload?.apiKey ?? "").trim() || process.env[PROVIDER_KEY_VAR[provider]] || "";
  const result = await discoverModels(provider, apiKey);
  return result;
});

// ---------------------------------------------------------------------------
// IPC — companion visibility + real quit (Settings → Desktop)
// ---------------------------------------------------------------------------
ipcMain.handle(IPC.GET_COMPANION_VISIBLE, () => companionVisible);

ipcMain.handle(IPC.SET_COMPANION_VISIBLE, (_e, visible: boolean) => {
  applyCompanionVisible(visible === true);
  return companionVisible;
});

ipcMain.on(IPC.QUIT_APP, () => {
  app.quit();
});

// ---------------------------------------------------------------------------
// Task cancellation — the Stop button. One task runs at a time per window;
// a single broadcast flag flips every live token.
// ---------------------------------------------------------------------------
const taskCancelSignals = new Set<{ aborted: boolean }>();

ipcMain.on(IPC.TASK_CANCEL, () => {
  for (const signal of taskCancelSignals) signal.aborted = true;
});

// ---------------------------------------------------------------------------
// Proactive check-ins toggle (Settings → Desktop) — the MAIN process owns
// the reminder schedule; the renderer only displays what arrives.
// ---------------------------------------------------------------------------
ipcMain.handle(IPC.GET_CHECKINS_ENABLED, () => proactiveEngine.isEnabled());

ipcMain.handle(IPC.SET_CHECKINS_ENABLED, (_e, enabled: boolean) => {
  proactiveEngine.setEnabled(enabled === true);
  return proactiveEngine.isEnabled();
});

// ---------------------------------------------------------------------------
// Provider auto-resolve — REAL probes of every configured provider with
// honest CONNECTED / NOT CONNECTED statuses (spec: never fake a connection).
// ---------------------------------------------------------------------------
ipcMain.handle(IPC.RESOLVE_PROVIDER, async () => {
  const out: Array<{
    provider: ProviderId;
    configured: boolean;
    ok: boolean;
    latencyMs: number;
    message: string;
    kind: string;
    model: string;
  }> = [];
  for (const provider of PROVIDER_ORDER) {
    const keyVar = PROVIDER_KEY_VAR[provider];
    const modelVar = PROVIDER_MODEL_VAR[provider];
    const apiKey = process.env[keyVar] || "";
    const model = process.env[modelVar] || DEFAULT_MODELS[provider];
    if (!apiKey) {
      out.push({
        provider,
        configured: false,
        ok: false,
        latencyMs: 0,
        message: "No key saved yet — paste one below.",
        kind: "no-key",
        model,
      });
      continue;
    }
    const r = await probeProvider(provider, apiKey, model);
    out.push({
      provider,
      configured: true,
      ok: r.ok,
      latencyMs: r.latencyMs,
      message: r.message,
      kind: String(r.kind),
      model,
    });
  }
  return out;
});

// ---------------------------------------------------------------------------
// IPC — speech (the companion's REAL voice)
// speakText runs the engine chain: Groq playai-tts → laptop's built-in voice.
// Auto-speak of chat replies flows through TTS_ON_AUDIO (wav) or, when the
// local engine spoke, an engine=local event with no audio needed.
// ---------------------------------------------------------------------------
ipcMain.handle(IPC.TTS_SPEAK, async (_e, payload: { requestId?: string; text?: string }) => {
  const text = String(payload?.text ?? "");
  if (!text.trim()) {
    return { ok: false, engine: "none", message: "Nothing to say." };
  }
  const outcome = await speakText(text);
  // Groq engine → ship the wav to the renderer to play.
  if (outcome.ok && outcome.engine === "groq" && outcome.audioBase64) {
    const win = BrowserWindow.fromWebContents(_e.sender);
    sendToWindow(win, IPC.TTS_ON_AUDIO, {
      requestId: payload?.requestId ?? "",
      engine: "groq",
      audioBase64: outcome.audioBase64,
      mime: outcome.mime ?? "audio/wav",
    });
    return { ok: true, engine: "groq", message: outcome.message };
  }
  return { ok: outcome.ok, engine: outcome.engine, message: outcome.message };
});

ipcMain.on(IPC.TTS_STOP, () => {
  stopSpeaking();
});

ipcMain.handle(IPC.GET_SPEAK_CONFIG, () => {
  return { ...getSpeakConfig(), platform: process.platform };
});

ipcMain.handle(IPC.SET_SPEAK_CONFIG, (_e, payload: Partial<SpeakConfig>) => {
  const entries = speakConfigEnvEntries(payload ?? {});
  const res = upsertEnvFile(path.join(app.getPath("userData"), ".env"), entries);
  if (!res.ok) {
    return { ok: false, message: `I couldn't save the voice settings: ${res.error}` };
  }
  // Live-apply.
  for (const [k, v] of Object.entries(entries)) process.env[k] = v;
  if (payload?.enabled === false) stopSpeaking();
  return { ok: true, message: "Voice settings saved.", config: getSpeakConfig() };
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

    // ── ONE window factory for every companion ──────────────────────────
    // The primary window is created directly below; any extra companion
    // spawned later goes through the SAME factory so close-interception,
    // crash recovery, self-heal, visibility control, position persistence
    // and broadcast delivery apply to all of them.
    swarmManager.setWindowFactory((id, ox, oy) => createWindow(id, ox, oy));

    // Initialize Phase 2 brains
    weeklyReflection.init(app.getPath("userData"));
    // The proactive engine persists its toggle + cooldowns so a restart
    // can neither spam check-ins nor silently lose the user's setting.
    const proactiveStateFile = path.join(app.getPath("userData"), "quip-proactive.json");
    proactiveEngine.configure({
      load: () => {
        try {
          if (!fs.existsSync(proactiveStateFile)) return null;
          const raw = JSON.parse(fs.readFileSync(proactiveStateFile, "utf8"));
          if (!raw || typeof raw !== "object") return null;
          return {
            enabled: raw.enabled !== false,
            lastFired: raw.lastFired && typeof raw.lastFired === "object" ? raw.lastFired : {},
          };
        } catch {
          return null;
        }
      },
      save: (state) => {
        try {
          fs.writeFileSync(proactiveStateFile, JSON.stringify(state, null, 2));
        } catch {
          /* best effort */
        }
      },
    });
    proactiveEngine.start();

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

    // Phase 3: the PRIMARY companion boots through the single factory.
    companionVisible = readCompanionVisible();
    createWindow(defaultCompanionId);
    createTray();

    // ── Self-heal: the companion must never silently vanish ──────────
    // If the window exists but is hidden while the user still wants the
    // companion on screen, bring it back (crash leftovers, OS quirks).
    // Full-mode windows can be minimized intentionally — leave those alone.
    setInterval(() => {
      for (const win of windows.values()) {
        if (win.isDestroyed() || win.isMinimized()) continue;
        const mode = windowModes.get(win.id) ?? "companion";
        if (companionVisible && mode !== "full" && !win.isVisible()) {
          win.showInactive();
          win.moveTop();
          clampWindowIntoView(win);
        }
      }
    }, 15_000);

    // Display changes (resolution, DPI, monitor unplugged) can leave the
    // companion stranded off-screen — pull every window back into view.
    screen.on("display-metrics-changed", () => {
      for (const win of windows.values()) clampWindowIntoView(win);
    });

    // Second launch = focus the running instance instead of a second sprite.
    app.on("second-instance", () => showFromTray());

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  }).catch((err) => {
    console.error("FATAL STARTUP ERROR:", err);
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  // Flush debounced saves on quit; allow window close handlers to pass.
  app.on("before-quit", () => {
    isQuitting = true;
    try {
      memoryBrain.flush();
    } catch {
      /* non-fatal */
    }
  });
}
