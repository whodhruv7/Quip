// Quip V2 — Electron main process (orchestration hub).
// Wires all 10 brain layers + bootstrap + IPC. API keys stay in env only.

import { app, BrowserWindow, ipcMain, screen, Tray, nativeImage, Menu } from "electron";
import path from "node:path";
import fs from "node:fs";

// .env loading (V3.1 precedence fix — see system/env-load.ts).
// OLD BUG: first-file-wins let a stale repo/.env key permanently mask the
// key the user pasted in Settings (userData/.env) — "test passes, chat dies,
// forever". NEW POLICY: repo files only FILL missing keys; the Settings-
// managed userData/.env always WINS; placeholders never occupy a slot.
import { applyEnvText } from "./system/env-load";

const ENV_FILES = [
  path.join(process.cwd(), ".env"),
  path.join(app.getAppPath(), ".env"),
  path.join(app.getPath("userData"), ".env"), // Settings' file — source of truth
];

for (let i = 0; i < ENV_FILES.length; i++) {
  try {
    const full = path.resolve(ENV_FILES[i]);
    if (!fs.existsSync(full)) continue;
    const txt = fs.readFileSync(full, "utf8");
    const isSettingsFile = i === ENV_FILES.length - 1;
    const r = applyEnvText(process.env as Record<string, string | undefined>, txt, isSettingsFile);
    if (isSettingsFile && r.overridden.length > 0) {
      // The Settings key replaced a repo-file value — log the KEY NAME only.
      console.log(`[env] userData/.env override won for: ${r.overridden.join(", ")}`);
    }
  } catch {
    /* a broken env file must never stop boot */
  }
}

// §29 — restore the user's persisted permission mode (survives restarts).
{
  const savedMode = (process.env.QUIP_PERMISSION_MODE || "").trim().toLowerCase();
  if (savedMode === "ask_every_time" || savedMode === "approve_task" || savedMode === "full_access") {
    execPermissionSystem.setMode(savedMode);
  }
}

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
  FALLBACK_MODELS,
  validateApiKey,
  upsertEnvFile,
  maskKey,
  isProviderEnabled,
  type ProviderId,
} from "./system/env-store";
import { probeProvider } from "./system/provider-probe";
import { discoverModels } from "./system/model-discovery";
import { speakText, stopSpeaking, getSpeakConfig, speakConfigEnvEntries, groqVoiceProbe, edgeEngineAvailable, localEngineAvailable, type SpeakConfig } from "./system/speech";
import { connectionJournal } from "./system/connection-journal";
import { probeNetworkPath, buildVerdict, SUGGESTION_COPY } from "./system/brain-health";
import { autoMigrateModel, looksLikeModelRejection } from "./system/model-health";
import { trimHistory, assembleSections, type PromptSection } from "./system/prompt-budget";
import { findEnvConflicts } from "./system/env-load";
import { fetchUpdates } from "./system/app-updates";
import { ensureQuipShortcut } from "./system/desktop-shortcut";
import { clampRect } from "./window-geometry";

import { ensureProfile } from "./brains/device-brain";
import { ensureWorldModel } from "./brains/world-model";
import { fsStorage } from "./brains/memory-brain-instance";
import { environmentBrain } from "./brains/environment-brain";
import { memoryBrain } from "./brains/memory-brain-instance";
import { computeSpatial, watchSpatial } from "./brains/spatial-brain";
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

// Head Brain — the permanent understanding layer (spec Phase 1/2).
// Every command becomes a structured Understanding BEFORE anything runs.
import { processCommand as brainProcessCommand, type HubExecOptions } from "./brain/hub";
import { deviceLookup, initDeviceIndex } from "./brain/device-index";
// Action Engine — the ONLY executor of direct plans (spec Phase 2).
import { createActionEngine } from "./actions/engine";
import { executionLog } from "./actions/execution-log";

// The orchestrator uses the model ONLY for ambiguous intent (compact schema,
// one small call) — deterministic tools handle the obvious actions.
orchestrator.setModelRouter(modelRouter);
// The agent loop + screen vision run on the SAME router — the user's Groq
// key powers both the brain (tool calling) and the eyes (llama-4 vision).
bindAgentBrain(modelRouter);
bindVisionBrain(modelRouter);

// The Head Brain is provider-independent: it never calls the model itself.
// The orchestrator (the hands) remains the ONLY component that talks to LLMs.
const brainHub = {
  processCommand: (raw: string, opts: HubExecOptions) =>
    brainProcessCommand(
      raw,
      {
        deviceIndex: deviceLookup(),
        execContext: () => contextStore.get(),
        execute: (cmd, exOpts) =>
          orchestrator.execute(cmd, {
            platform: process.platform,
            signal: exOpts.signal,
            onProgress: exOpts.onProgress,
          }),
        // Direct plans run through the Action Engine: permission gate →
        // contract validation → timeout-wrapped executors → bounded recovery
        // → structured log per attempt (spec Phase 2 + §14/15/19/20).
        executePlan: (plan, planOpts) =>
          createActionEngine({ platform: process.platform }, (l) => console.log(l)).executePlan(
            plan,
            planOpts
          ),
        log: (line) => console.log(line),
      },
      opts
    ),
};

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
    if (!isFullLayout(windowModes.get(win.id) ?? "companion")) writePosition(c.x, c.y);
  }
}

// ── Brand icon (the Quip logo, processed with clean rounded cuts) ──────────
// Dev serves it from public/; a packaged build has it in dist/ (vite copies
// public/* into the build). Missing file → empty image, callers fall back.
function quipWindowIcon(): Electron.NativeImage {
  for (const base of [app.getAppPath(), path.join(app.getAppPath(), "dist"), __dirname]) {
    try {
      const p = path.join(base, "quip-icon.png");
      if (fs.existsSync(p)) {
        const img = nativeImage.createFromPath(p);
        if (!img.isEmpty()) return img;
      }
    } catch {
      /* try the next base */
    }
  }
  return nativeImage.createEmpty();
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
      win.setAlwaysOnTop(mode !== "full" && mode !== "fullscreen", "screen-saver");
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
// Window modes — companion sprite / small panel / full app / TRUE full screen.
//
// companion  : a tiny transparent window holding just the companion sprite.
// panel      : the window grows — small chat panel with the companion beside it.
// full       : the full Quip application, centered.
// fullscreen : MODE 3 — the ENTIRE display, edge to edge, opaque themed.
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

/** True when the mode is an app-sized layout (as opposed to the sprite). */
export function isFullLayout(mode: WindowMode): boolean {
  return mode === "full" || mode === "fullscreen";
}

/** Runtime narrowing for IPC payloads. */
export function isWindowMode(v: unknown): v is WindowMode {
  return v === "companion" || v === "panel" || v === "full" || v === "fullscreen";
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
  } else if (mode === "fullscreen") {
    // MODE 3 — TRUE full screen: the entire display, edge to edge. We use the
    // display's full bounds (frameless window) instead of OS fullscreen so the
    // transparent window stays glitch-free on Windows.
    const display = screen.getPrimaryDisplay();
    next = {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
    };
  } else {
    const c = anchorBottomRight(cur, COMPANION_MODE_SIZE.width, COMPANION_MODE_SIZE.height);
    next = { x: c.x, y: c.y, width: COMPANION_MODE_SIZE.width, height: COMPANION_MODE_SIZE.height };
  }

  win.setResizable(true);
  win.setBounds(next);
  win.setResizable(isFullLayout(mode));
  win.setAlwaysOnTop(!isFullLayout(mode), "screen-saver");
  if (isFullLayout(mode)) {
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
  // Token diet: free-tier providers cap TOKENS PER MINUTE (Groq free ≈ 6-8k).
  // Every section carries a priority; the prompt is assembled under a hard
  // budget — identity/rules always survive, nice-to-have context drops
  // first instead of causing 429s.
  const sections: PromptSection[] = [];
  const push = (id: string, priority: number, text: string) => sections.push({ id, priority, text });

  // ─── 1. Core identity + companion (always) — HEAVY DELIBERATE PROMPT ─
  // The user asked for a heavy, deliberate, detail-rich prompt: Quip must
  // KNOW what it is, what it can really do, HOW to take on a task
  // (break it down, resolve specifics, verify) and HOW to report failure.
  const companionPersonalities: Record<string, string> = {
    pix: "Pix — playful, energetic, creative. Light humor. Social + creative tasks.",
    kai: "Kai — calm, analytical, wise. Clear explanations. Planning + research.",
    ren: "Ren — curious, empathetic, reflective. Personal + emotional support.",
    bubbles: "Bubbles — bubbly, joyful, playful. Cheerful energy, celebratory, light on her feet.",
    capy: "Capy — unbothered, warm, steady. Cozy calm. Nothing is a crisis.",
    skales: "Skales — the original gecko: lime, curious, always mid-task. Chases goals one small step at a time.",
  };
  push(
    "identity",
    1,
    "You are QUIP, a real AI companion living on the user's desktop — part friend, " +
      "part capable operator. You are NOT a chatbot pretending to control a computer: " +
      "you genuinely act on this laptop through a real execution layer, you observe the " +
      "result, and you verify it before you claim anything worked.\n" +
      `Your personality: ${companionPersonalities[companionId] ?? companionPersonalities.pix}\n` +
      "HOW YOU HANDLE ANY REQUEST:\n" +
      "1. UNDERSTAND it fully — including pronouns (it/that/the other one) from earlier " +
      "in the conversation, and SPECIFICS. If the user names an account or target " +
      "(e.g. 'open my Google Calendar of dhruvsharma4944@gmail.com'), carry that exact " +
      "address into the task — never drop a named detail.\n" +
      "2. BREAK IT DOWN — for multi-step goals ('open ChatGPT, copy the answer, make " +
      "a file with it'), do every step in order and finish the whole chain, not just " +
      "the first move.\n" +
      "3. ACT with the right tool — deterministic quick actions need no reasoning " +
      "theater; ambiguous or screen-level goals get planned step by step. When a " +
      "screen target matters, look (screenshot / read the page) BEFORE clicking.\n" +
      "4. VERIFY — 'I clicked' is not 'it worked'. Confirm the result (window open, " +
      "song playing, file exists) before saying done.\n" +
      "5. REPORT honestly — if something failed, say exactly what failed and the " +
      "basic reason in plain words ('VS Code isn't installed on this laptop'), then " +
      "offer the nearest alternative. NEVER fake success, never say 'Done' unless it " +
      "is verifiably done.\n" +
      "Tone: warm, human, concise. Short answers unless detail is asked for. Match " +
      "the user's language — Hinglish in, Hinglish out."
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
    push("device", 3, deviceParts.join(" | "));
  }

  // ┌─ 3. World model (capped — prevents hallucination) ───────────────
  if (worldModel) {
    push("world", 2, worldModel.summary.slice(0, 600));
  }

  // ─── 4. Environment (only if actionable) ────────────────────────────
  if (env.network.online === false) {
    push("offline", 2, "NOTE: User is OFFLINE. Web actions may fail.");
  }
  if (env.battery.supported && !env.battery.charging && env.battery.level < 0.2) {
    push(
      "battery",
      4,
      `NOTE: Battery low (${Math.round(env.battery.level * 100)}%). Be brief.`
    );
  }

  // ─── 5. Workspace context (only if online — skip if offline) ────────
  if (env.network.online) {
    const wsSummary = workspaceContext.getPromptSummary();
    if (wsSummary) push("workspace", 4, wsSummary.slice(0, 400));
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
        .slice(0, 5)
        .map((x) => x.m);
    } else {
      // No user message (e.g., first load) — top by weight
      relevantMemories = mem.memories
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 5);
    }
    if (relevantMemories.length > 0) {
      const memLines = relevantMemories.map((m) => {
        const tag =
          m.kind === "contact" ? `${m.key}=${m.value}`
          : m.kind === "preference" ? `prefers ${m.value}`
          : `${m.key}: ${m.value}`;
        return `- ${tag}`;
      });
      push("memories", 2, `Known about user:\n${memLines.join("\n")}`);
    }
  }

  // ─── 7. Relevant knowledge graph entities (filtered) ────────────────
  if (userMessage) {
    const entities = knowledgeGraph.findEntities(userMessage);
    if (entities.length > 0) {
      const entityLines = entities.slice(0, 3).map((e) => {
        const attrs = Object.entries(e.attributes)
          .filter(([k]) => k !== "isSelf")
          .map(([k, v]) => `${k}=${v}`)
          .join(", ");
        return `- ${e.name} [${e.type}]${attrs ? ` {${attrs}}` : ""}`;
      });
      push("entities", 4, `Relevant entities:\n${entityLines.join("\n")}`);
    }
  }

  // ─── 8. Communication style (relationship engine) ───────────────────
  const styleGuide = relationshipEngine.getStyleGuide();
  if (styleGuide) push("style", 3, styleGuide);

  // ─── 8.5. Short-term execution context (1 compact line) ────────────────
  // Lets chat-mode follow-ups ("play it", "now open the latest email")
  // resolve without re-sending the whole history.
  const execContextSummary = contextStore.summary();
  if (execContextSummary) push("exec", 3, execContextSummary);

  // ─── 8.7. Timeline Context ─────────────────────────────────────────
  const timelineSummary = timelineBrain.getTodaySummary();
  if (timelineSummary && timelineSummary !== "No significant activity recorded today.") {
    push("timeline", 5, `Recent Activity: ${timelineSummary}`);
  }

  // ─── 9. Companion mood ─────────────────────────────────────────────
  const moodHint = companionMood.getPromptHint(companionId);
  if (moodHint) push("mood", 5, moodHint);

  // ─── Phase 2: Communication DNA (injected after style guide) ───────
  const memState = memoryBrain.get();
  const userProfile = relationshipEngine.get();
  const dna = communicationDNA.compute(userProfile, memState);
  if (dna.promptFragment) {
    push("dna", 5, `Communication Style:\n${dna.promptFragment}`);
  }

  // ─── 10. Rules (always — short) ─────────────────────────────────────
  push(
    "rules",
    1,
    "Rules: Never assume apps exist (check above). If impossible, explain + suggest. " +
      "Always explain WHY (trust layer). Match user's style. Be concise. " +
      "Addressing: when the user names an account (an email) or a specific target, " +
      "that exact detail drives the action — e.g. 'calendar of dhruvsharma4944@gmail.com' " +
      "means THAT account's calendar, not a generic page. Specifics beat defaults, always."
  );
  push(
    "can-control",
    1,
    "You CAN actually control this laptop — this is a REAL, verified capability list:\n" +
      "APPS & WINDOWS: open/close/focus/switch any installed app; minimize/maximize/" +
      "restore/move/resize windows; list open windows and installed apps.\n" +
      "FILES: find files/folders, open files/folders/projects, create files, read and " +
      "write them, copy/move/rename/delete (delete needs permission), open Downloads/" +
      "Desktop/Documents.\n" +
      "INPUT: type real keystrokes, press any shortcut (ctrl+c, alt+tab…), click / " +
      "double-click / right-click anywhere on screen (with x,y or at cursor), scroll, " +
      "drag, read and write the clipboard.\n" +
      "SCREEN: take real screenshots and USE them — look at the screen, find a target, " +
      "act on it, then verify the result. You can see the user's screen when asked.\n" +
      "BROWSER: open the user's real default browser, any URL, new/close/switch tabs, " +
      "back/forward/reload, search Google or YouTube, read the visible page.\n" +
      "MEDIA: control volume (up/down/mute/set 0-100), media keys (play/pause/next/" +
      "previous), play songs on YouTube with playback verification.\n" +
      "SYSTEM: list and force-close processes (never system ones), shell commands " +
      "(with approval), CPU/RAM/disk/battery/network/Wi-Fi status.\n" +
      "Never say you cannot access the device — you can. Never claim an action " +
      "succeeded unless the execution layer reports it did."
  );

  // ─── 11. Capability introspection (know what you can and cannot do) ──
  push(
    "can-more",
    2,
    "MORE things you CAN do: real weather for any city, summarize long text (or the " +
      "last page you read), extract text from PDFs, read .docx files, create real Word " +
      "(.docx), Excel (.xlsx) and PowerPoint (.pptx) files, speak replies OUT LOUD in a " +
      "real voice, read web pages / RSS / Reddit / GitHub repos / V2EX / Bilibili / " +
      "single tweets, and READ YOUTUBE — a video's title, channel and metadata " +
      "(youtube_read), or what a YouTube search returns — without even opening the " +
      "browser. Run shell commands (with approval) and open any named website — Gmail, " +
      "Google Calendar, Drive, ChatGPT, Gemini, YouTube, Instagram and more — for a " +
      "specific account if the user names one (e.g. 'open my google calendar of gmail " +
      "dhruv@gmail.com'). The user's own log-in state comes from their browser profile."
  );
  push(
    "cannot",
    2,
    "What you CANNOT do (say so honestly, never fake it): send Telegram/WhatsApp/Discord " +
      "messages as bots, send emails directly (you CAN open a Gmail/WhatsApp compose window " +
      "in the browser), edit Google Calendar EVENTS through an API (you CAN open the " +
      "Calendar/Gmail/Drive website itself, for any Google account the user names), " +
      "generate images or videos, scan files with VirusTotal, see or control phones, or " +
      "search all of X/Twitter (only single tweets by link). When the user asks for these, " +
      "say exactly what's missing and offer the nearest thing you can do."
  );

  // Token budget ≈ 5.5k chars (≈1.4k tokens): the heavy deliberate identity,
  // rules and capability sections are priority 1-2 and always survive;
  // nice-to-have context drops first instead of causing 429s.
  return assembleSections(sections, 5500).prompt;
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
    icon: windowIcon(),
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
    // PRODUCTION PATH FIX — the app's quiet white-screen bug. __dirname here
    // is <repo>/dist-electron/electron (main.js lives there), and Vite emits
    // the renderer to <repo>/dist. The old "../dist/index.html" resolved to
    // <repo>/dist-electron/dist/index.html, which does not exist — the
    // production window silently rendered NOTHING (ERR_FILE_NOT_FOUND).
    // "../../dist" is correct from dist-electron/electron/.
    win.loadFile(path.join(__dirname, "../../dist/index.html"), { search: `companion=${companionId}` });
  }

  win.on("move", () => {
    // Persist the anchor position — but not while in full mode (the full
    // window is centered; the companion anchor should stay where it was).
    if (windows.size === 1 && !isFullLayout(windowModes.get(win.id) ?? "companion")) {
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

  // ── Close interception — the cross button NEVER removes Quip ──
  // The user's rule: the X removes the app SCREEN, not the mascot. Quip only
  // leaves the screen via Settings → Quit Quip (isQuitting).
  //   panel/full mode → shrink back to the companion sprite (mascot stays)
  //   companion mode  → do nothing — the mascot IS the window, it stays
  //   hidden (visibility off in Settings) → stay hidden, app still alive
  win.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      try {
        const mode = windowModes.get(win.id) ?? "companion";
        if (mode !== "companion" && !win.isDestroyed() && win.isVisible()) {
          // X on the app page/panel → back to the desktop sprite.
          setWindowMode(win, "companion");
        }
        // Companion mode: Quip stays on screen, per the user's rule.
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
/** The full logo files ship with the app; fall back to the tiny embedded
 *  square so the tray NEVER breaks (empty tray icon = invisible entry). */
function appIconPath(name: string): string | null {
  try {
    const p = path.join(app.getAppPath(), "build", name);
    if (fs.existsSync(p)) return p;
    // Belt & braces: the mascot mark is also bundled with the renderer assets.
    const alt = path.join(app.getAppPath(), "src", "assets", "quip-mark.png");
    if (name.startsWith("tray") && fs.existsSync(alt)) return alt;
    return null;
  } catch {
    return null;
  }
}

function windowIcon(): Electron.NativeImage {
  const mine = appIconPath("icon.png");
  if (mine) {
    const img = nativeImage.createFromPath(mine);
    if (!img.isEmpty()) return img;
  }
  return quipWindowIcon();
}

/** Bring Quip onto the desktop the way the user asked for it:
 *  the companion appears (with the Quip logo look), and the FULL APP page
 *  opens — never a terminal, never a bare sprite the user must find. */
function showQuipDesktop(): void {
  if (!companionVisible) applyCompanionVisible(true);
  if (windows.size === 0) {
    const win = createWindow(defaultCompanionId);
    setWindowMode(win, "full");
    win.focus();
    return;
  }
  let first = true;
  for (const win of windows.values()) {
    if (win.isDestroyed()) continue;
    win.showInactive();
    win.moveTop();
    clampWindowIntoView(win);
    // "Always should open the page that of like my app" — the primary window
    // opens the full app experience, not the compact sprite.
    if (first && !isFullLayout(windowModes.get(win.id) ?? "companion")) {
      setWindowMode(win, "full");
      win.focus();
    }
    first = false;
  }
}

function showFromTray() {
  // Tray = the user explicitly wants to see Quip → re-enable visibility.
  // Same experience as the Settings "Quip Appearance" button: the app page.
  showQuipDesktop();
}

function createTray() {
  // Tray hierarchy: the circular-cut mascot head (crisp at 16px) → the full
  // brand logo → the embedded calm dot. The tray entry can NEVER vanish.
  let icon = nativeImage.createEmpty();
  const trayPath = appIconPath("tray@2x.png") ?? appIconPath("tray.png");
  if (trayPath) {
    icon = nativeImage.createFromPath(trayPath);
  }
  if (icon.isEmpty()) {
    icon = quipWindowIcon();
  }
  if (icon.isEmpty()) {
    icon = nativeImage.createFromBuffer(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAO0lEQVR4nO3OQQ0AIAwEMP7Z36EBcZJmBEwQ1kYSYUdA1uT+rz0AAAAAAAAAAAAAAAAAAAAAAAAAAL51NekDHNd7rTAAAAAASUVORK5CYII=",
        "base64"
      )
    );
  }
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
// IPC — window modes (companion / panel / full / fullscreen)
// ---------------------------------------------------------------------------
ipcMain.handle(IPC.WINDOW_MODE_SET, (_e, mode: WindowMode) => {
  const win = BrowserWindow.fromWebContents(_e.sender);
  if (!win || !isWindowMode(mode)) return false;
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

  // Build system prompt with relevance filtering based on the user message.
  // GUARDED: a throw in any brain read (memory/KG/DNA/mood/timeline) must
  // reach the renderer as a CHAT_ERROR — never as an unhandled rejection
  // with no styled error bubble. Degrade to a minimal honest prompt.
  let systemPrompt: string;
  try {
    systemPrompt = buildSystemPrompt(lastUserMsg?.content, companionId);
  } catch (e: any) {
    console.error("[chat] system prompt build failed:", e?.message ?? e);
    try {
      sendToWindow(win, IPC.CHAT_ERROR, {
        requestId: payload.requestId,
        kind: "internal",
        message:
          "Quip could not assemble its context for this reply (its memory services hiccuped). Nothing was sent. Try again — if it repeats, restart Quip.",
      });
    } catch {
      /* best effort */
    }
    return { ok: false, error: "prompt-build-failed" };
  }
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
    // Token diet: free-tier TPM limits die on huge histories — keep the most
    // recent window (the current message is always preserved).
    const history = trimHistory(payload.history);
    const { full, provider, switched } = await modelRouter.stream(systemPrompt, history, {
      onChunk: (delta: string) => {
        sendToWindow(win, IPC.CHAT_CHUNK, {
          requestId: payload.requestId,
          delta,
        });
      },
      onProvider: (providerId, confirmed) => {
        // Live provider chip — "trying X…" → "X" once headers arrive.
        sendToWindow(win, IPC.CHAT_PROVIDER, {
          requestId: payload.requestId,
          provider: providerId,
          confirmed,
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
ipcMain.on(IPC.SET_COMPANION, (_e, id: "pix" | "kai" | "ren" | "bubbles" | "capy" | "skales") => {
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
    const win = BrowserWindow.fromWebContents(_e.sender);
    try {
      return await runTaskExecute(_e, payload, win);
    } catch (err: any) {
      // HARD GUARANTEE: the task engine must NEVER kill chat. Any unexpected
      // throw (profile scan, orchestrator, executor bug) used to reject this
      // invoke and the renderer showed "Task execution failed" WITHOUT ever
      // trying the AI. Now we return an honest empty-chat result so the
      // renderer falls through to chatSend and the companion still answers.
      const reason = String(err?.message ?? err).slice(0, 300);
      console.error("task-execute failed — falling back to chat:", reason);
      return {
        requestId: payload.requestId,
        success: false,
        summary: "",
        notes: [],
        failures: [`The task engine hit an unexpected problem: ${reason}`],
        plan: {
          id: payload.requestId,
          requestId: payload.requestId,
          intent: { type: "chat", target: null, query: null, confidence: 0.3, verbs: [], raw: payload.command },
          subtasks: [],
          summary: "",
          isChat: true,
          createdAt: Date.now(),
        } as any,
      };
    }
  }
);

async function runTaskExecute(
  _e: Electron.IpcMainInvokeEvent,
  payload: TaskExecutePayload,
  win: Electron.BrowserWindow | null
): Promise<TaskResultPayload> {
  const profile = deviceProfile ?? (await ensureProfile(app.getPath("userData")));
  const platform = profile.platform;
  const workspacePath = app.getAppPath();

  // Set up approval callback — forwards to renderer
  const companionId = win ? windowCompanionMap.get(win.id) ?? defaultCompanionId : defaultCompanionId;

  execPermissionSystem.onApprovalRequested = (request: ApprovalRequest) => {
    sendToWindow(win, "quip:approval-request", request);
  };

  // ── Cancellation token (Stop button / stop command) ────────────────
  const cancelSignal = { aborted: false };
  taskCancelSignals.add(cancelSignal);

  try {
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

    // ── Head Brain: understanding → plan → route (spec Phase 1/2) ──────
    // The orchestrator still executes, but now on the REFERENCE-RESOLVED
    // command, behind a clarification gate (never act on a guess), with the
    // lifecycle trace + structured telemetry the spec requires.
    const hubOutcome = await brainHub.processCommand(payload.command, {
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
    const brainU = hubOutcome.understanding;
    const intentInfo = brainU?.parsed ?? parseIntentV2(payload.command);

    // Clarification: the brain needs ONE detail before acting — answer
    // honestly instead of guessing (spec: zero random execution).
    if (hubOutcome.route === "clarify") {
      return {
        requestId: payload.requestId,
        success: true,
        summary: hubOutcome.clarifyQuestion ?? "Which one do you mean?",
        notes: ["I need one detail before acting — I don't guess."],
        answered: true,
        stepsCompleted: 0,
        stepsTotal: 0,
        failures: [],
        plan: planMetaFromBrain(payload.requestId, brainU, "", true),
      } as unknown as TaskResultPayload;
    }

    // Pure conversation → fall through to the companion chat (existing
    // contract: stepsTotal === 0 && !answered makes the UI call chatSend).
    if (hubOutcome.route === "chat" || !hubOutcome.result) {
      return {
        requestId: payload.requestId,
        success: true,
        summary: "",
        notes: [],
        stepsCompleted: 0,
        stepsTotal: 0,
        failures: [],
        plan: planMetaFromBrain(payload.requestId, brainU, "", true),
      } as unknown as TaskResultPayload;
    }

    const result = hubOutcome.result;

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
      ...(result.answered ? { answered: true } : {}),
      plan: planMetaFromBrain(payload.requestId, brainU, result.summary, result.stepsTotal === 0 && !result.answered),
    };
  } finally {
    taskCancelSignals.delete(cancelSignal);
  }
}

/**
 * Plan metadata from the Head Brain's understanding (richer than the raw
 * parse: primary intent kind, resolved target, verbs, per-step subtasks).
 */
function planMetaFromBrain(
  requestId: string,
  u: ReturnType<typeof import("./brain/understanding").buildUnderstanding> | undefined | null,
  summary: string,
  isChat: boolean
) {
  if (!u) {
    const fallback = parseIntentV2("");
    return {
      id: requestId,
      requestId,
      intent: { type: fallback.action, target: null, query: null, confidence: 0.3, verbs: [], raw: "" },
      subtasks: [],
      summary,
      isChat: true,
      createdAt: Date.now(),
    } as any;
  }
  return {
    id: requestId,
    requestId,
    intent: {
      type: u.intents.primary.kind,
      target: u.objects[0]?.name ?? u.parsed.target ?? null,
      query: u.parsed.query ?? null,
      confidence: u.parsed.confidence,
      verbs: [u.intents.primary.kind, ...u.intents.secondary.map((s) => s.kind)],
      raw: u.literal,
    },
    subtasks: u.parsed.steps.map((s) => ({ description: s.description })),
    summary,
    isChat,
    createdAt: Date.now(),
  } as any;
}

// ---------------------------------------------------------------------------
// IPC — approval resolution (user taps Approve/Reject)
// ---------------------------------------------------------------------------
ipcMain.on(IPC.APPROVAL_RESOLVE, (_e, { id, approved }: { id: string; approved: boolean }) => {
  execPermissionSystem.resolveApproval(id, approved);
});

// ---------------------------------------------------------------------------
// IPC — permission mode control
// ---------------------------------------------------------------------------
ipcMain.handle(IPC.GET_PERMISSION_MODE, () => {
  return { mode: execPermissionSystem.getMode(), label: execPermissionSystem.getModeLabel() };
});

ipcMain.handle(IPC.SET_PERMISSION_MODE, (_e, mode: string) => {
  if (mode === "ask_every_time" || mode === "approve_task" || mode === "full_access") {
    execPermissionSystem.setMode(mode);
    // §29 — a setting the user chose must survive restarts (env upsert,
    // the same store the Settings panel writes keys into).
    upsertEnvFile(path.join(app.getPath("userData"), ".env"), { QUIP_PERMISSION_MODE: mode });
    process.env.QUIP_PERMISSION_MODE = mode;
  }
  return { mode: execPermissionSystem.getMode(), label: execPermissionSystem.getModeLabel() };
});

ipcMain.handle(IPC.CYCLE_PERMISSION_MODE, () => {
  execPermissionSystem.cycleMode();
  upsertEnvFile(path.join(app.getPath("userData"), ".env"), {
    QUIP_PERMISSION_MODE: execPermissionSystem.getMode(),
  });
  process.env.QUIP_PERMISSION_MODE = execPermissionSystem.getMode();
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
    enabled[p] = isProviderEnabled(p);
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
      // Ollama has NO key — the Settings "key" box carries the local URL
      // (optional; empty = the default 127.0.0.1:11434).
      if (provider === "ollama") {
        entries.QUIP_OLLAMA_URL = apiKey;
      } else {
        const check = validateApiKey(provider, apiKey);
        if (!check.ok) {
          return { ok: false, masked: "", message: check.message };
        }
        entries[PROVIDER_KEY_VAR[provider]] = apiKey;
      }
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
    if (apiKey) {
      process.env[provider === "ollama" ? "QUIP_OLLAMA_URL" : PROVIDER_KEY_VAR[provider]] = apiKey;
    }
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
// Quip Appearance — the Settings button that brings Quip onto the desktop
// with its logo look. No terminal, no hunting for the sprite: the companion
// shows up AND the full app page opens (spec: "click kru toh open my
// companion… always should open the page that of like my app").
// ---------------------------------------------------------------------------
ipcMain.handle(IPC.SHOW_QUIP_DESKTOP, () => {
  showQuipDesktop();
  return { ok: true, visible: companionVisible };
});

// Desktop shortcut — the REAL app icon on the Windows home screen. One tap
// launches Quip with zero terminal. Auto-ensured at boot; this handler lets
// the user (re)create it on demand with an honest verdict either way.
// ---------------------------------------------------------------------------
ipcMain.handle(IPC.ADD_DESKTOP_SHORTCUT, () => {
  return ensureQuipShortcut(app.getAppPath(), { force: true });
});

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
    const modelVar = PROVIDER_MODEL_VAR[provider];
    const model = process.env[modelVar] || DEFAULT_MODELS[provider];
    // Ollama needs NO key — reachability IS the test.
    if (provider === "ollama") {
      const r = await probeProvider("ollama", "", model);
      out.push({
        provider,
        configured: true,
        ok: r.ok,
        latencyMs: r.latencyMs,
        message: r.message,
        kind: String(r.kind),
        model,
      });
      continue;
    }
    const keyVar = PROVIDER_KEY_VAR[provider];
    const apiKey = process.env[keyVar] || "";
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
// IPC — brain health, Doctor, connection journal, transport (V3.1 round)
// One honest answer to "why can't Quip reach my providers right now?"
// ---------------------------------------------------------------------------

type ProviderHealthRow = {
  provider: string; label: string; configured: boolean; enabled: boolean;
  parkedForMs: number; ok: boolean; latencyMs: number; kind: string;
  message: string; model: string;
};

let brainHealthCache: { at: number; healthy: boolean; activeProvider: string | null; providers: ProviderHealthRow[] } | null = null;
const BRAIN_HEALTH_TTL_MS = 5 * 60_000;

async function runProviderHealthCheck(): Promise<ProviderHealthRow[]> {
  // PARALLEL: this used to await each provider serially — 6 providers x up
  // to ~10s probe timeout each meant the boot health check could churn for
  // a full minute. All probes now run concurrently; Promise.all keeps the
  // row order stable so the Doctor renders identically, just ~6x sooner.
  const rows: ProviderHealthRow[] = await Promise.all(
    PROVIDER_ORDER.map(async (provider) => {
      const label = PROVIDER_LABEL[provider];
      const enabled = isProviderEnabled(provider);
      const modelVar = PROVIDER_MODEL_VAR[provider];
      const model = process.env[modelVar] || DEFAULT_MODELS[provider];
      const parkedForMs = modelRouter.breaker.parkedForMs(provider);
      if (provider === "ollama") {
        const r = await probeProvider("ollama", "", model);
        return {
          provider, label, configured: true, enabled,
          parkedForMs, ok: r.ok, latencyMs: r.latencyMs, kind: String(r.kind),
          message: r.message, model,
        } as ProviderHealthRow;
      }
      const apiKey = process.env[PROVIDER_KEY_VAR[provider]] || "";
      if (!apiKey) {
        return {
          provider, label, configured: false, enabled, parkedForMs,
          ok: false, latencyMs: 0, kind: "no-key",
          message: "No key saved yet — paste one in Settings → AI Brain.",
          model,
        } as ProviderHealthRow;
      }
      const r = await probeProvider(provider, apiKey, model);
      return {
        provider, label, configured: true, enabled, parkedForMs,
        ok: r.ok, latencyMs: r.latencyMs, kind: String(r.kind),
        message: r.message, model,
      } as ProviderHealthRow;
    })
  );
  return rows;
}

async function refreshBrainHealth(force = false) {
  if (!force && brainHealthCache && Date.now() - brainHealthCache.at < BRAIN_HEALTH_TTL_MS) {
    return brainHealthCache;
  }
  const providers = await runProviderHealthCheck();
  const working = providers.filter((p) => p.ok && p.enabled);
  brainHealthCache = {
    at: Date.now(),
    healthy: working.length > 0,
    activeProvider: working[0]?.provider ?? null,
    providers,
  };
  broadcastToRenderers(IPC.BRAIN_HEALTH_CHANGED, brainHealthCache);
  return brainHealthCache;
}

ipcMain.handle(IPC.GET_BRAIN_HEALTH, () => {
  return brainHealthCache ?? { at: 0, healthy: false, activeProvider: null, providers: [] };
});

ipcMain.handle(IPC.RUN_DOCTOR, async () => {
  const [network, providers] = await Promise.all([
    probeNetworkPath(),
    runProviderHealthCheck(),
  ]);
  // Voice engines — every one reports its honest state.
  const tts: Record<string, string> = { groq: "", edge: "", local: "" };
  tts.groq = process.env.GROQ_API_KEY
    ? await groqVoiceProbe(fetch)
    : "No Groq key — the Groq voice needs one (the other voices still work).";
  tts.edge = (await edgeEngineAvailable())
    ? "Free neural voice ready (en-IN-NeerjaNeural reads Hinglish well)."
    : "Free neural voice module not available — the laptop voice still works.";
  tts.local = localEngineAvailable()
    ? "Laptop built-in voice ready (works fully offline)."
    : "Built-in voice only exists on Windows.";

  // .env conflict detection — the classic "test passes, chat fails" trap.
  const envFiles: Array<{ name: string; txt: string }> = [];
  try {
    const repoEnv = path.join(process.cwd(), ".env");
    const userEnv = path.join(app.getPath("userData"), ".env");
    if (fs.existsSync(repoEnv)) envFiles.push({ name: "project .env", txt: fs.readFileSync(repoEnv, "utf8") });
    if (fs.existsSync(userEnv)) envFiles.push({ name: "Settings (.env)", txt: fs.readFileSync(userEnv, "utf8") });
  } catch { /* best effort */ }
  const envConflicts = findEnvConflicts(envFiles);

  const suggestions: string[] = [];
  if (!network.ok) suggestions.push("Fix the network first — with the internet blocked, NO provider can answer (VPN/proxy/firewall/antivirus).");
  for (const p of providers) {
    if (p.ok || !p.enabled) continue;
    if (p.kind === "no-key") suggestions.push(`${p.label}: ${SUGGESTION_COPY.noKey}`);
    else if (p.kind === "auth") suggestions.push(`${p.label}: ${SUGGESTION_COPY.auth}`);
    else if (p.kind === "rate-limit") suggestions.push(`${p.label}: ${SUGGESTION_COPY["rate-limit"]}`);
    else if (p.kind === "network") suggestions.push(`${p.label}: ${SUGGESTION_COPY.network}`);
    else if (p.parkedForMs > 0) suggestions.push(`${p.label}: ${SUGGESTION_COPY.parked}`);
  }
  if (envConflicts.length > 0) suggestions.push(SUGGESTION_COPY.envConflict);

  const verdict = buildVerdict(network, providers, suggestions);
  const report = {
    at: Date.now(),
    network,
    providers,
    tts,
    journal: connectionJournal.tail(12).map((e) => ({
      ts: e.ts, provider: e.provider, ok: e.ok, latencyMs: e.latencyMs, note: e.note,
    })),
    envConflicts,
    verdict,
    suggestions,
  };
  // Doctor results double as the live health snapshot.
  brainHealthCache = {
    at: Date.now(),
    healthy: providers.some((p) => p.ok && p.enabled),
    activeProvider: providers.find((p) => p.ok && p.enabled)?.provider ?? null,
    providers,
  };
  broadcastToRenderers(IPC.BRAIN_HEALTH_CHANGED, brainHealthCache);
  return report;
});

ipcMain.handle(IPC.GET_CONNECTION_JOURNAL, () => connectionJournal.all());

// Structured execution log — the per-action evidence trail (spec Phase 2).
ipcMain.handle(IPC.GET_ACTION_LOG, () => executionLog.recent(60));

// Settings → Appearance → "Fetch Updates": fetch + fast-forward the running
// repo, with an honest plain-language result (offline / dirty tree / not-a-repo
// are reported, never faked as "updated").
ipcMain.handle(IPC.APP_FETCH_UPDATES, async () => {
  return fetchUpdates(app.getAppPath());
});

ipcMain.handle(IPC.GET_TRANSPORT_SETTING, () => ({
  mode: ((): "auto" | "net" | "node" => {
    const t = (process.env.QUIP_TRANSPORT || "auto").toLowerCase();
    return t === "net" || t === "node" ? t : "auto";
  })(),
}));

ipcMain.handle(IPC.SET_TRANSPORT_SETTING, (_e, payload: { mode?: string }) => {
  const mode = payload?.mode === "net" || payload?.mode === "node" ? payload.mode : "auto";
  const res = upsertEnvFile(path.join(app.getPath("userData"), ".env"), { QUIP_TRANSPORT: mode });
  if (!res.ok) return { ok: false, message: `I couldn't save that: ${res.error}` };
  process.env.QUIP_TRANSPORT = mode;
  return {
    ok: true,
    message: mode === "auto"
      ? "Transport: automatic (tries both network stacks)."
      : `Transport pinned to ${mode === "net" ? "Electron net (system proxy)" : "Node fetch (direct)"} — switch back to Auto if providers start failing.`,
  };
});

/** Model auto-health: when a provider rejects its configured MODEL id,
 *  migrate to the first live spare and save it — no user action needed. */
async function runModelAutoHealth(): Promise<void> {
  for (const provider of PROVIDER_ORDER) {
    if (provider === "ollama") continue; // local server — no decommission drama
    const enabled = isProviderEnabled(provider);
    if (!enabled) continue;
    const apiKey = process.env[PROVIDER_KEY_VAR[provider]] || "";
    if (!apiKey) continue;
    const modelVar = PROVIDER_MODEL_VAR[provider];
    const configured = process.env[modelVar] || DEFAULT_MODELS[provider];
    const decision = await autoMigrateModel({
      configured,
      spares: FALLBACK_MODELS[provider] ?? [],
      probe: async (model) => {
        const r = await probeProvider(provider, apiKey, model);
        return { ok: r.ok, message: r.message };
      },
    });
    if (decision.migrated && decision.model) {
      process.env[modelVar] = decision.model;
      upsertEnvFile(path.join(app.getPath("userData"), ".env"), { [modelVar]: decision.model });
      modelRouter.reload();
      connectionJournal.record({
        provider, model: decision.model, ok: true, kind: "migrate", latencyMs: 0,
        note: decision.reason,
      });
      brainHealthCache = null; // force a fresh health read
      console.log(`[model-health] ${provider}: ${decision.reason}`);
    }
  }
}

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
    // Desktop shortcut — silently ensure Quip.lnk exists on the real Windows
    // desktop so the user NEVER needs the terminal to launch Quip again.
    // Best-effort: never blocks boot, never nags (honest result only when
    // the user asks via Settings → Desktop shortcut).
    ensureQuipShortcut(app.getAppPath()).catch(() => {});

    // Device Knowledge Layer — load the cached index instantly, then rescan
    // in the background and merge only the diff. Never blocks the boot.
    initDeviceIndex(app.getPath("userData")).catch(() => {});

    // Structured execution log persists (debounced) for post-mortems.
    executionLog.setPersistPath(path.join(app.getPath("userData"), "quip-actions.json"));

    // ── WINDOW FIRST, bootstrap second ───────────────────────────────────
    // The single worst startup bug: the window used to be created only AFTER
    // `await bootstrap(...)`, so a first-run device scan meant tens of seconds
    // of nothing on screen — indistinguishable from "the app won't open".
    // Now the companion sprite appears immediately, and the scan progress
    // events actually reach it (the old broadcast fired into an empty window
    // map, so the scan overlay could never be seen on the very first launch).
    swarmManager.setWindowFactory((id, ox, oy) => createWindow(id, ox, oy));
    companionVisible = readCompanionVisible();
    createWindow(defaultCompanionId);
    createTray();

    // Run the full bootstrap pipeline (window already visible; the renderer's
    // ScanOverlay now receives these events for real).
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
    // (Window + tray are now created BEFORE bootstrap — see "WINDOW FIRST"
    // above — so presence is instant and scan progress reaches the renderer.)

    // ── V3.1 connectivity round ─────────────────────────────────────────
    // Connection journal persists (debounced) so the Doctor can show
    // EVIDENCE of what happened, even across restarts.
    const journalFile = path.join(app.getPath("userData"), "quip-connections.json");
    try {
      if (fs.existsSync(journalFile)) {
        connectionJournal.load(JSON.parse(fs.readFileSync(journalFile, "utf8")));
      }
    } catch { /* best effort */ }
    connectionJournal.configurePersist((entries) => {
      try {
        fs.writeFileSync(journalFile, JSON.stringify(entries.slice(-80)));
      } catch { /* best effort */ }
    });

    // Boot health probe (TTL-cached): the top-bar pill knows the truth
    // BEFORE the user's first message, and any provider that retired its
    // model id auto-migrates to a live spare. Weekly re-check afterwards.
    setTimeout(() => {
      refreshBrainHealth(true).catch(() => {});
      runModelAutoHealth().catch(() => {});
    }, 2500);
    setInterval(() => {
      runModelAutoHealth().catch(() => {});
    }, 7 * 24 * 60 * 60 * 1000);

    // ── Self-heal: the companion must never silently vanish ──────────
    // If the window exists but is hidden while the user still wants the
    // companion on screen, bring it back (crash leftovers, OS quirks).
    // Full-mode windows can be minimized intentionally — leave those alone.
    setInterval(() => {
      for (const win of windows.values()) {
        if (win.isDestroyed() || win.isMinimized()) continue;
        const mode = windowModes.get(win.id) ?? "companion";
        if (companionVisible && !isFullLayout(mode) && !win.isVisible()) {
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
