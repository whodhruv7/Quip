"use strict";
// Quip V2 — BOOTSTRAP SYSTEM
// -----------------------------------------------------------------------------
// The single orchestrated startup sequence. Replaces the old "run 2-3
// terminal commands" workflow. On launch, this runs the full pipeline:
//
//   health-check  ->  device-scan  ->  environment
//                ->  world-model   ->  model-router  ->  window  ->  ready
//
// Each stage emits progress so the renderer can show a calm scan animation
// on first launch. If any stage fails, we do NOT crash — we degrade
// gracefully (e.g. skip device scan, use empty profile) and still bring up
// the companion. Self-healing startup.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.bootstrap = bootstrap;
const electron_1 = require("electron");
const device_brain_1 = require("../brains/device-brain");
const world_model_1 = require("../brains/world-model");
const memory_brain_instance_1 = require("../brains/memory-brain-instance");
const environment_brain_1 = require("../brains/environment-brain");
const permission_system_1 = require("./permission-system");
const memory_brain_instance_2 = require("../brains/memory-brain-instance");
const knowledge_graph_1 = require("../brains/knowledge-graph");
const relationship_engine_1 = require("../brains/relationship-engine");
const companion_evolution_1 = require("../brains/companion-evolution");
const model_router_1 = require("./model-router");
const STAGE_ORDER = [
    "health-check",
    "device-scan",
    "environment",
    "world-model",
    "model-router",
    "window",
    "ready",
];
function emit(stage, message, progress, onProgress, error = null) {
    onProgress({
        stage,
        message,
        progress,
        done: stage === "ready",
        error,
    });
}
async function bootstrap(onProgress) {
    const userData = electron_1.app.getPath("userData");
    // --- 1. health-check ---
    emit("health-check", "Warming up…", 0.05, onProgress);
    try {
        permission_system_1.permissionSystem.init(userData);
        memory_brain_instance_2.memoryBrain.init(userData);
        knowledge_graph_1.knowledgeGraph.init(userData);
        relationship_engine_1.relationshipEngine.init(userData);
        companion_evolution_1.companionEvolution.init(userData);
        // companionMood is stateless — no init needed
        // workspaceContext is stateless — no init needed
    }
    catch (e) {
        console.error("Health check init failed:", e);
    }
    emit("health-check", "Ready.", 0.12, onProgress);
    // --- 2. device-scan ---
    let profile = null;
    emit("device-scan", "Scanning your device…", 0.18, onProgress);
    try {
        profile = await (0, device_brain_1.ensureProfile)(userData);
        emit("device-scan", `Found ${profile.platformLabel} · ${profile.browsers.length} browser(s)`, 0.42, onProgress);
    }
    catch (e) {
        emit("device-scan", "Scan skipped.", 0.42, onProgress, e?.message ?? null);
    }
    // --- 3. environment ---
    emit("environment", "Reading environment…", 0.5, onProgress);
    try {
        environment_brain_1.environmentBrain.start();
    }
    catch (e) {
        console.error("Environment brain start failed:", e);
    }
    emit("environment", "Environment ready.", 0.58, onProgress);
    // --- 4. world-model ---
    let worldModel = null;
    emit("world-model", "Building world model…", 0.62, onProgress);
    try {
        if (profile)
            worldModel = await (0, world_model_1.ensureWorldModel)(userData, profile, memory_brain_instance_1.fsStorage);
    }
    catch (e) {
        console.error("World model init failed:", e);
    }
    emit("world-model", "World model ready.", 0.72, onProgress);
    // --- 5. model-router ---
    emit("model-router", "Connecting to model…", 0.76, onProgress);
    try {
        const status = model_router_1.modelRouter.status();
        if (!status.healthy) {
            emit("model-router", "No AI key found — chat will need a key.", 0.82, onProgress);
        }
        else {
            emit("model-router", `Using ${status.active.label}`, 0.82, onProgress);
        }
    }
    catch (e) {
        console.error("Model router status check failed:", e);
    }
    // --- 6. window ---
    emit("window", "Opening Quip…", 0.9, onProgress);
    // The window is created by main.ts after bootstrap resolves; this stage
    // just signals the renderer that the window is about to appear.
    emit("window", "Almost there…", 0.96, onProgress);
    // --- 7. ready ---
    emit("ready", "Quip is ready 💙", 1, onProgress);
    return { profile, worldModel, ok: true };
}
//# sourceMappingURL=bootstrap.js.map