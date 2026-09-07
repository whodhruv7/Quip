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

import path from "node:path";
import { app } from "electron";
import { ensureProfile } from "../brains/device-brain";
import { ensureWorldModel } from "../brains/world-model";
import { fsStorage } from "../brains/memory-brain-instance";
import { environmentBrain } from "../brains/environment-brain";
import { permissionSystem } from "./permission-system";
import { memoryBrain } from "../brains/memory-brain-instance";
import { knowledgeGraph } from "../brains/knowledge-graph";
import { workspaceContext } from "../brains/workspace-context";
import { relationshipEngine } from "../brains/relationship-engine";
import { companionMood } from "../brains/companion-mood";
import { companionEvolution } from "../brains/companion-evolution";
import { modelRouter } from "./model-router";
import type {
  BootstrapProgress,
  BootstrapStage,
  DeviceProfile,
  WorldModel,
} from "../../src/types";

export interface BootstrapResult {
  profile: DeviceProfile | null;
  worldModel: WorldModel | null;
  ok: boolean;
}

type ProgressCb = (p: BootstrapProgress) => void;

const STAGE_ORDER: BootstrapStage[] = [
  "health-check",
  "device-scan",
  "environment",
  "world-model",
  "model-router",
  "window",
  "ready",
];

function emit(
  stage: BootstrapStage,
  message: string,
  progress: number,
  onProgress: ProgressCb,
  error: string | null = null
) {
  onProgress({
    stage,
    message,
    progress,
    done: stage === "ready",
    error,
  });
}

export async function bootstrap(onProgress: ProgressCb): Promise<BootstrapResult> {
  const userData = app.getPath("userData");

  // --- 1. health-check ---
  emit("health-check", "Warming up…", 0.05, onProgress);
  try {
    permissionSystem.init(userData);
    memoryBrain.init(userData);
    knowledgeGraph.init(userData);
    relationshipEngine.init(userData);
    companionEvolution.init(userData);
    // companionMood is stateless — no init needed
    // workspaceContext is stateless — no init needed
  } catch (e) {
    console.error("Health check init failed:", e);
  }
  emit("health-check", "Ready.", 0.12, onProgress);

  // --- 2. device-scan ---
  let profile: DeviceProfile | null = null;
  emit("device-scan", "Scanning your device…", 0.18, onProgress);
  try {
    profile = await ensureProfile(userData);
    emit(
      "device-scan",
      `Found ${profile.platformLabel} · ${profile.browsers.length} browser(s)`,
      0.42,
      onProgress
    );
  } catch (e: any) {
    emit("device-scan", "Scan skipped.", 0.42, onProgress, e?.message ?? null);
  }

  // --- 3. environment ---
  emit("environment", "Reading environment…", 0.5, onProgress);
  try {
    environmentBrain.start();
  } catch (e) {
    console.error("Environment brain start failed:", e);
  }
  emit("environment", "Environment ready.", 0.58, onProgress);

  // --- 4. world-model ---
  let worldModel: WorldModel | null = null;
  emit("world-model", "Building world model…", 0.62, onProgress);
  try {
    if (profile) worldModel = await ensureWorldModel(userData, profile, fsStorage);
  } catch (e) {
    console.error("World model init failed:", e);
  }
  emit("world-model", "World model ready.", 0.72, onProgress);

  // --- 5. model-router ---
  emit("model-router", "Connecting to model…", 0.76, onProgress);
  try {
    const status = modelRouter.status();
    if (!status.healthy) {
      emit(
        "model-router",
        "No AI key found — chat will need a key.",
        0.82,
        onProgress
      );
    } else {
      emit("model-router", `Using ${status.active.label}`, 0.82, onProgress);
    }
  } catch (e) {
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
