"use strict";
// Quip V2 — Electron main process (orchestration hub).
// Wires all 10 brain layers + bootstrap + IPC. API keys stay in env only.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
// .env loader (tiny, dependency-free).
function loadEnvFile(file) {
    const full = node_path_1.default.resolve(file);
    if (!node_fs_1.default.existsSync(full))
        return;
    const txt = node_fs_1.default.readFileSync(full, "utf8");
    for (const rawLine of txt.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#"))
            continue;
        const eq = line.indexOf("=");
        if (eq === -1)
            continue;
        const key = line.slice(0, eq).trim();
        let val = line.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        if (!process.env[key])
            process.env[key] = val;
    }
}
loadEnvFile(node_path_1.default.join(process.cwd(), ".env"));
loadEnvFile(node_path_1.default.join(electron_1.app.getAppPath(), ".env"));
loadEnvFile(node_path_1.default.join(electron_1.app.getPath("userData"), ".env"));
const shared_1 = require("./shared");
const bootstrap_1 = require("./system/bootstrap");
const model_router_1 = require("./system/model-router");
const permission_system_1 = require("./system/permission-system");
const device_brain_1 = require("./brains/device-brain");
const world_model_1 = require("./brains/world-model");
const memory_brain_instance_1 = require("./brains/memory-brain-instance");
const environment_brain_1 = require("./brains/environment-brain");
const memory_brain_instance_2 = require("./brains/memory-brain-instance");
const spatial_brain_1 = require("./brains/spatial-brain");
const knowledge_graph_1 = require("./brains/knowledge-graph");
const workspace_context_1 = require("./brains/workspace-context");
const relationship_engine_1 = require("./brains/relationship-engine");
const companion_mood_1 = require("./brains/companion-mood");
const companion_evolution_1 = require("./brains/companion-evolution");
const memory_importance_1 = require("./brains/memory-importance");
const memory_extractor_1 = require("./brains/memory-extractor");
const timeline_brain_1 = require("./brains/timeline-brain");
// Execution Engine V2
const orchestrator_1 = require("./engine/orchestrator");
const permission_modes_1 = require("./engine/permission-modes");
// ─── State ───────────────────────────────────────────────────────────────────
const isDev = process.env.NODE_ENV === "development";
const windows = new Map();
const windowCompanionMap = new Map();
let tray = null;
let deviceProfile = null;
let worldModel = null;
let spatialConfig = null;
// The default companion (set by renderer via IPC). Defaults to "pix".
let defaultCompanionId = "pix";
const pendingConfirmations = new Map();
// ---------------------------------------------------------------------------
// Local persistence — window position only.
// ---------------------------------------------------------------------------
const POS_FILE = "pix-window-position.json";
function readPosition() {
    try {
        const p = node_path_1.default.join(electron_1.app.getPath("userData"), POS_FILE);
        if (!node_fs_1.default.existsSync(p))
            return null;
        const data = JSON.parse(node_fs_1.default.readFileSync(p, "utf8"));
        if (typeof data.x === "number" && typeof data.y === "number")
            return data;
        return null;
    }
    catch {
        return null;
    }
}
function writePosition(x, y) {
    try {
        const p = node_path_1.default.join(electron_1.app.getPath("userData"), POS_FILE);
        node_fs_1.default.writeFileSync(p, JSON.stringify({ x, y }));
    }
    catch {
        /* ignore — best effort */
    }
}
function clampPosition(x, y, w, h) {
    const area = electron_1.screen.getPrimaryDisplay().workArea;
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
function buildSystemPrompt(userMessage, companionId = "pix") {
    const env = environment_brain_1.environmentBrain.get();
    const sections = [];
    // ─── 1. Core identity + companion (always) ──────────────────────────
    const companionPersonalities = {
        pix: "Pix — playful, energetic, creative. Light humor. Social + creative tasks.",
        kai: "Kai — calm, analytical, wise. Clear explanations. Planning + research.",
        zee: "Zee — curious, empathetic, reflective. Personal + emotional support.",
    };
    sections.push("You are QUIP, a calm, concise AI companion on the user's desktop. " +
        "Warm, human, never robotic. Short answers unless asked for detail. " +
        `You are ${companionPersonalities[companionId] ?? companionPersonalities.pix}`);
    // ─── 2. Device context (compressed) ─────────────────────────────────
    if (deviceProfile) {
        const deviceParts = [
            `Device: ${deviceProfile.platformLabel} ${deviceProfile.osVersion}`,
        ];
        if (deviceProfile.defaultBrowser) {
            deviceParts.push(`Browser: ${deviceProfile.defaultBrowser}`);
        }
        // Only list app names, max 8 (was 12)
        if (deviceProfile.apps.length > 0) {
            deviceParts.push(`Apps: ${deviceProfile.apps.slice(0, 8).map((a) => a.name).join(", ")}`);
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
        sections.push(`NOTE: Battery low (${Math.round(env.battery.level * 100)}%). Be brief.`);
    }
    // ─── 5. Workspace context (only if online — skip if offline) ────────
    if (env.network.online) {
        const wsSummary = workspace_context_1.workspaceContext.getPromptSummary();
        if (wsSummary)
            sections.push(wsSummary);
    }
    // ─── 6. Relevant memories (RAG — filtered by user message) ──────────
    const mem = memory_brain_instance_2.memoryBrain.get();
    if (mem.memories.length > 0) {
        let relevantMemories = mem.memories;
        if (userMessage) {
            // RAG: filter memories by keyword overlap with user message
            const msgWords = new Set(userMessage
                .toLowerCase()
                .split(/[^a-z0-9]+/)
                .filter((w) => w.length > 2));
            relevantMemories = mem.memories
                .map((m) => {
                const memText = `${m.key} ${m.value}`.toLowerCase();
                let score = 0;
                msgWords.forEach((w) => {
                    if (memText.includes(w))
                        score++;
                });
                // High-importance memories always included
                if (m.importance === "high")
                    score += 2;
                return { m, score };
            })
                .filter((x) => x.score > 0 || x.m.importance === "high")
                .sort((a, b) => b.score - a.score)
                .slice(0, 8)
                .map((x) => x.m);
        }
        else {
            // No user message (e.g., first load) — top by weight
            relevantMemories = mem.memories
                .sort((a, b) => b.weight - a.weight)
                .slice(0, 8);
        }
        if (relevantMemories.length > 0) {
            const memLines = relevantMemories.map((m) => {
                const tag = m.kind === "contact" ? `${m.key}=${m.value}`
                    : m.kind === "preference" ? `prefers ${m.value}`
                        : `${m.key}: ${m.value}`;
                return `- ${tag}`;
            });
            sections.push(`Known about user:\n${memLines.join("\n")}`);
        }
    }
    // ─── 7. Relevant knowledge graph entities (filtered) ────────────────
    if (userMessage) {
        const entities = knowledge_graph_1.knowledgeGraph.findEntities(userMessage);
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
    // ─── 8. Communication style (always — short) ────────────────────────
    const styleGuide = relationship_engine_1.relationshipEngine.getStyleGuide();
    if (styleGuide)
        sections.push(styleGuide);
    // ─── 8.5. Timeline Context ──────────────────────────────────────────
    const timelineSummary = timeline_brain_1.timelineBrain.getTodaySummary();
    if (timelineSummary && timelineSummary !== "No significant activity recorded today.") {
        sections.push(`Recent Activity: ${timelineSummary}`);
    }
    // ─── 9. Companion mood (always — one line) ──────────────────────────
    const moodHint = companion_mood_1.companionMood.getPromptHint(companionId);
    if (moodHint)
        sections.push(moodHint);
    // ─── 10. Rules (always — short) ─────────────────────────────────────
    sections.push("Rules: Never assume apps exist (check above). If impossible, explain + suggest. " +
        "Always explain WHY (trust layer). Match user's style. Be concise.");
    return sections.join("\n\n");
}
// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function createWindow(companionId = "pix", offsetX = 0, offsetY = 0) {
    const panel = spatialConfig?.chatPanel ?? {
        x: 0,
        y: 0,
        width: 440,
        height: 680,
    };
    const area = electron_1.screen.getPrimaryDisplay().workArea;
    const saved = readPosition();
    const w = panel.width;
    const h = panel.height;
    let x, y;
    if (saved) {
        const clamped = clampPosition(saved.x, saved.y, w, h);
        x = clamped.x + offsetX;
        y = clamped.y + offsetY;
    }
    else if (panel.x > 0 || panel.y > 0) {
        const clamped = clampPosition(panel.x, panel.y, w, h);
        x = clamped.x + offsetX;
        y = clamped.y + offsetY;
    }
    else {
        x = area.x + area.width - w - 20 + offsetX;
        y = area.y + area.height - h - 20 + offsetY;
    }
    const win = new electron_1.BrowserWindow({
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
            preload: node_path_1.default.join(__dirname, "preload.js"),
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
    }
    else if (isDev) {
        win.loadURL(`http://localhost:5173?companion=${companionId}`);
    }
    else {
        win.loadFile(node_path_1.default.join(__dirname, "../dist/index.html"), { search: `companion=${companionId}` });
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
function broadcastToRenderers(channel, data) {
    windows.forEach((win) => {
        if (!win.isDestroyed()) {
            win.webContents.send(channel, data);
        }
    });
}
function sendToWindow(win, channel, data) {
    if (win && !win.isDestroyed()) {
        win.webContents.send(channel, data);
    }
}
// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------
function createTray() {
    const icon = electron_1.nativeImage.createFromBuffer(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAO0lEQVR4nO3OQQ0AIAwEMP7Z36EBcZJmBEwQ1kYSYUdA1uT+rz0AAAAAAAAAAAAAAAAAAAAAAAAAAL51NekDHNd7rTAAAAAASUVORK5CYII=", "base64"));
    tray = new electron_1.Tray(icon.isEmpty() ? electron_1.nativeImage.createEmpty() : icon);
    tray.setToolTip("Quip — AI Companion");
    tray.on("click", () => {
        if (windows.size === 0)
            createWindow(defaultCompanionId);
        else
            windows.forEach(w => w.show());
    });
    tray.setContextMenu(electron_1.Menu.buildFromTemplate([
        { label: "Show Quip", click: () => {
                if (windows.size === 0)
                    createWindow(defaultCompanionId);
                else
                    windows.forEach(w => w.show());
            } },
        { type: "separator" },
        { label: "Quit Quip", click: () => electron_1.app.quit() },
    ]));
}
// ---------------------------------------------------------------------------
// IPC — window movement
// ---------------------------------------------------------------------------
electron_1.ipcMain.on(shared_1.IPC.MOVE_WINDOW, (_e, { dx, dy }) => {
    const win = electron_1.BrowserWindow.fromWebContents(_e.sender);
    if (!win)
        return;
    const [x, y] = win.getPosition();
    win.setPosition(x + dx, y + dy, false);
});
electron_1.ipcMain.handle(shared_1.IPC.GET_WINDOW_POSITION, (_e) => {
    const win = electron_1.BrowserWindow.fromWebContents(_e.sender);
    if (!win)
        return null;
    const [x, y] = win.getPosition();
    return { x, y };
});
// ---------------------------------------------------------------------------
// IPC — chat streaming (via model router)
// ---------------------------------------------------------------------------
electron_1.ipcMain.handle(shared_1.IPC.CHAT_SEND, async (_e, payload) => {
    const win = electron_1.BrowserWindow.fromWebContents(_e.sender);
    if (!win || win.isDestroyed())
        return { ok: false };
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
            relationship_engine_1.relationshipEngine.observeUserMessage(lastUserMsg.content);
            relationship_engine_1.relationshipEngine.observeCodePreference(lastUserMsg.content);
            companion_mood_1.companionMood.observeUserMessage(lastUserMsg.content);
            // Record a message + conversation for companion evolution
            companion_evolution_1.companionEvolution.recordMessage(companionId);
            // Check if this is the start of a new conversation (heuristic: first user msg)
            const userMsgCount = payload.history.filter((m) => m.role === "user").length;
            if (userMsgCount === 1) {
                companion_evolution_1.companionEvolution.recordConversation(companionId);
                timeline_brain_1.timelineBrain.logEvent({
                    title: `Started conversation with ${companionId}`,
                    type: "present_activity",
                    timestamp: Date.now()
                });
            }
        }
        catch {
            /* non-fatal */
        }
    }
    // ─── Refresh workspace context (async, non-blocking) ───────────────
    workspace_context_1.workspaceContext.refresh().catch(() => { });
    try {
        const { full } = await model_router_1.modelRouter.stream(systemPrompt, payload.history, {
            onChunk: (delta) => {
                sendToWindow(win, shared_1.IPC.CHAT_CHUNK, {
                    requestId: payload.requestId,
                    delta,
                });
            },
        });
        // ─── Observe the assistant response for relationship engine ──────
        try {
            relationship_engine_1.relationshipEngine.observeAssistantResponse(full);
        }
        catch {
            /* non-fatal */
        }
        // ─── Feed the conversation to the memory extractor (background) ──
        // This triggers LLM-based fact + entity extraction every N messages.
        try {
            (0, memory_extractor_1.observeMessages)(companionId, payload.history);
        }
        catch {
            /* non-fatal */
        }
        sendToWindow(win, shared_1.IPC.CHAT_DONE, {
            requestId: payload.requestId,
            full,
        });
        return { ok: true };
    }
    catch (err) {
        const msg = err?.message ?? String(err);
        // Classify the error for graceful display.
        const kind = msg.includes("no-groq-key")
            || msg.includes("no-openrouter-key")
            ? "no-key"
            : msg.includes("401")
                ? "http"
                : "network";
        const userMessage = kind === "no-key"
            ? "No AI key configured. Add GROQ_API_KEY to your .env file."
            : kind === "http"
                ? "AI provider rejected the key. Check your .env."
                : "Network error. Check your connection.";
        sendToWindow(win, shared_1.IPC.CHAT_ERROR, {
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
electron_1.ipcMain.on("quip:set-companion", (_e, id) => {
    if (id === "pix" || id === "kai" || id === "ren") {
        defaultCompanionId = id;
        const win = electron_1.BrowserWindow.fromWebContents(_e.sender);
        if (win)
            windowCompanionMap.set(win.id, id);
    }
});
// ---------------------------------------------------------------------------
// IPC — task execution (via Execution Engine V2 orchestrator)
// ---------------------------------------------------------------------------
electron_1.ipcMain.handle(shared_1.IPC.TASK_EXECUTE, async (_e, payload) => {
    const profile = deviceProfile ?? (await (0, device_brain_1.ensureProfile)(electron_1.app.getPath("userData")));
    const platform = profile.platform;
    // Set up approval callback — forwards to renderer
    const win = electron_1.BrowserWindow.fromWebContents(_e.sender);
    const companionId = win ? windowCompanionMap.get(win.id) ?? defaultCompanionId : defaultCompanionId;
    // Set up approval callback — forwards to renderer
    permission_modes_1.permissionSystem.onApprovalRequested = (request) => {
        sendToWindow(win, "quip:approval-request", request);
    };
    const result = await orchestrator_1.orchestrator.execute(payload.command, {
        platform,
        onProgress: (update) => {
            sendToWindow(win, shared_1.IPC.TASK_PROGRESS, {
                requestId: payload.requestId,
                step: update.step,
                total: update.total,
                description: update.description,
            });
        },
    });
    // Record task completion for companion evolution and timeline
    if (result.success && result.stepsTotal > 0) {
        try {
            companion_evolution_1.companionEvolution.recordTask(companionId);
            timeline_brain_1.timelineBrain.logEvent({
                title: `Executed task: ${payload.command}`,
                type: "present_activity",
                timestamp: Date.now()
            });
        }
        catch {
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
        },
    };
});
// ---------------------------------------------------------------------------
// IPC — approval resolution (user taps Approve/Reject)
// ---------------------------------------------------------------------------
electron_1.ipcMain.on("quip:approval-resolve", (_e, { id, approved }) => {
    permission_modes_1.permissionSystem.resolveApproval(id, approved);
});
// ---------------------------------------------------------------------------
// IPC — permission mode control
// ---------------------------------------------------------------------------
electron_1.ipcMain.handle("quip:get-permission-mode", () => {
    return { mode: permission_modes_1.permissionSystem.getMode(), label: permission_modes_1.permissionSystem.getModeLabel() };
});
electron_1.ipcMain.handle("quip:set-permission-mode", (_e, mode) => {
    if (mode === "ask_every_time" || mode === "approve_task" || mode === "full_access") {
        permission_modes_1.permissionSystem.setMode(mode);
    }
    return { mode: permission_modes_1.permissionSystem.getMode(), label: permission_modes_1.permissionSystem.getModeLabel() };
});
electron_1.ipcMain.handle("quip:cycle-permission-mode", () => {
    permission_modes_1.permissionSystem.cycleMode();
    return { mode: permission_modes_1.permissionSystem.getMode(), label: permission_modes_1.permissionSystem.getModeLabel() };
});
electron_1.ipcMain.on(shared_1.IPC.CONFIRMATION_RESOLVE, (_e, payload) => {
    const pending = pendingConfirmations.get(payload.id);
    if (pending) {
        pending.resolve(payload.approved);
        pendingConfirmations.delete(payload.id);
    }
});
// ---------------------------------------------------------------------------
// IPC — Swarm Mode
// ---------------------------------------------------------------------------
electron_1.ipcMain.handle(shared_1.IPC.SPAWN_COMPANION, (_e, { companionId }) => {
    // spawn slightly offset
    const offsetCount = windows.size;
    createWindow(companionId, offsetCount * 40, offsetCount * 40);
});
electron_1.ipcMain.on(shared_1.IPC.INTER_COMPANION_MSG, (_e, { to, message }) => {
    const fromWin = electron_1.BrowserWindow.fromWebContents(_e.sender);
    const fromId = fromWin ? windowCompanionMap.get(fromWin.id) : "unknown";
    // Find target window
    for (const [id, compId] of windowCompanionMap.entries()) {
        if (compId === to) {
            const win = windows.get(id);
            if (win) {
                win.webContents.send(shared_1.IPC.INTER_COMPANION_MSG, { from: fromId, message });
                return;
            }
        }
    }
});
// ---------------------------------------------------------------------------
// IPC — device brain
// ---------------------------------------------------------------------------
electron_1.ipcMain.handle(shared_1.IPC.GET_DEVICE_PROFILE, async () => {
    if (deviceProfile)
        return deviceProfile;
    try {
        deviceProfile = await (0, device_brain_1.ensureProfile)(electron_1.app.getPath("userData"));
        return deviceProfile;
    }
    catch {
        return null;
    }
});
electron_1.ipcMain.handle(shared_1.IPC.RESCAN_DEVICE, async () => {
    try {
        deviceProfile = await (0, device_brain_1.ensureProfile)(electron_1.app.getPath("userData"), 0); // force rescan
        if (deviceProfile) {
            worldModel = await (0, world_model_1.ensureWorldModel)(electron_1.app.getPath("userData"), deviceProfile, memory_brain_instance_1.fsStorage);
            spatialConfig = (0, spatial_brain_1.computeSpatial)(deviceProfile);
        }
        return deviceProfile;
    }
    catch {
        return null;
    }
});
// ---------------------------------------------------------------------------
// IPC — spatial brain
// ---------------------------------------------------------------------------
electron_1.ipcMain.handle(shared_1.IPC.GET_SPATIAL_CONFIG, () => {
    return spatialConfig ?? null;
});
// ---------------------------------------------------------------------------
// IPC — memory brain (extended: pin + prune)
// ---------------------------------------------------------------------------
electron_1.ipcMain.handle(shared_1.IPC.GET_MEMORIES, () => {
    return memory_brain_instance_2.memoryBrain.get();
});
electron_1.ipcMain.handle(shared_1.IPC.FORGET_MEMORY, (_e, id) => {
    memory_brain_instance_2.memoryBrain.forget(id);
});
electron_1.ipcMain.handle(shared_1.IPC.PIN_MEMORY, (_e, id) => {
    memory_brain_instance_2.memoryBrain.pin(id);
});
electron_1.ipcMain.handle(shared_1.IPC.PRUNE_MEMORIES, () => {
    const mem = memory_brain_instance_2.memoryBrain.get();
    const { retained, report } = (0, memory_importance_1.runPrune)(mem.memories);
    // Bulk-replace with the retained set
    memory_brain_instance_2.memoryBrain.replaceAll(retained);
    return {
        total: report.totalMemories,
        pruned: report.pruned,
        retained: report.retained,
    };
});
// ---------------------------------------------------------------------------
// IPC — knowledge graph
// ---------------------------------------------------------------------------
electron_1.ipcMain.handle(shared_1.IPC.GET_KNOWLEDGE_GRAPH, () => {
    return knowledge_graph_1.knowledgeGraph.get();
});
electron_1.ipcMain.handle(shared_1.IPC.REMOVE_ENTITY, (_e, id) => {
    knowledge_graph_1.knowledgeGraph.removeEntity(id);
});
// ---------------------------------------------------------------------------
// IPC — workspace context
// ---------------------------------------------------------------------------
electron_1.ipcMain.handle(shared_1.IPC.GET_WORKSPACE_CONTEXT, async () => {
    return await workspace_context_1.workspaceContext.refresh();
});
// ---------------------------------------------------------------------------
// IPC — relationship engine (communication DNA)
// ---------------------------------------------------------------------------
electron_1.ipcMain.handle(shared_1.IPC.GET_USER_PROFILE, () => {
    return relationship_engine_1.relationshipEngine.get();
});
electron_1.ipcMain.handle(shared_1.IPC.RESET_USER_PROFILE, () => {
    relationship_engine_1.relationshipEngine.reset();
});
// ---------------------------------------------------------------------------
// IPC — companion mood
// ---------------------------------------------------------------------------
electron_1.ipcMain.handle(shared_1.IPC.GET_COMPANION_MOOD, (_e, id) => {
    if (id !== "pix" && id !== "kai" && id !== "ren")
        return null;
    return companion_mood_1.companionMood.getMood(id);
});
// ---------------------------------------------------------------------------
// IPC — companion evolution
// ---------------------------------------------------------------------------
electron_1.ipcMain.handle(shared_1.IPC.GET_COMPANION_PROGRESSION, () => {
    return companion_evolution_1.companionEvolution.getAll();
});
// Wire the cosmetic unlock callback to push to renderer
companion_evolution_1.companionEvolution.onUnlock((unlock) => {
    broadcastToRenderers(shared_1.IPC.ON_COSMETIC_UNLOCK, unlock);
});
// ---------------------------------------------------------------------------
// IPC — model router
// ---------------------------------------------------------------------------
electron_1.ipcMain.handle(shared_1.IPC.GET_MODEL_STATUS, () => {
    return model_router_1.modelRouter.status();
});
// ---------------------------------------------------------------------------
// IPC — permission system
// ---------------------------------------------------------------------------
electron_1.ipcMain.handle(shared_1.IPC.GET_PERMISSIONS, () => {
    return permission_system_1.permissionSystem.listRules();
});
electron_1.ipcMain.handle(shared_1.IPC.UPDATE_PERMISSION, (_e, { capability, granted }) => {
    permission_system_1.permissionSystem.recordDecision(capability, granted, granted);
});
// ---------------------------------------------------------------------------
// IPC — bootstrap progress (sent to renderer during startup)
// ---------------------------------------------------------------------------
// The bootstrap function will call this internally.
function sendBootstrapProgress(p) {
    broadcastToRenderers(shared_1.IPC.BOOTSTRAP_PROGRESS, p);
}
// ---------------------------------------------------------------------------
// App lifecycle — bootstrap on ready
// ---------------------------------------------------------------------------
if (!electron_1.app.requestSingleInstanceLock()) {
    electron_1.app.quit();
}
else {
    electron_1.app.whenReady().then(async () => {
        // Run the full bootstrap pipeline.
        let bootResult;
        try {
            bootResult = await (0, bootstrap_1.bootstrap)(sendBootstrapProgress);
        }
        catch {
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
            spatialConfig = (0, spatial_brain_1.computeSpatial)(deviceProfile);
            // Watch for display changes.
            (0, spatial_brain_1.watchSpatial)(deviceProfile, (cfg) => {
                spatialConfig = cfg;
                broadcastToRenderers(shared_1.IPC.SPATIAL_CHANGE, cfg);
            });
        }
        // Initialize Timeline Brain
        timeline_brain_1.timelineBrain.init(electron_1.app.getPath("userData"));
        // Subscribe to environment changes and push to renderer.
        // Also feed the companion mood + workspace context brains.
        environment_brain_1.environmentBrain.subscribe((env) => {
            broadcastToRenderers(shared_1.IPC.ENVIRONMENT_CHANGE, env);
            // Feed companion mood (throttled internally)
            try {
                companion_mood_1.companionMood.observeEnvironment(env);
            }
            catch {
                /* non-fatal */
            }
            // Refresh workspace context periodically (it reads the foreground window)
            workspace_context_1.workspaceContext.refresh().catch(() => { });
        });
        // Create the window + tray.
        createWindow();
        createTray();
        electron_1.app.on("activate", () => {
            if (electron_1.BrowserWindow.getAllWindows().length === 0)
                createWindow();
        });
    }).catch((err) => {
        console.error("FATAL STARTUP ERROR:", err);
    });
    electron_1.app.on("window-all-closed", () => {
        if (process.platform !== "darwin")
            electron_1.app.quit();
    });
    // Flush debounced saves on quit
    electron_1.app.on("before-quit", () => {
        try {
            memory_brain_instance_2.memoryBrain.flush();
        }
        catch {
            /* non-fatal */
        }
    });
}
//# sourceMappingURL=main.js.map