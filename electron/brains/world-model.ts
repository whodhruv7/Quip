import path from "node:path";
import type { DeviceProfile, WorldModel } from "../../src/types";
import { generateWorldModel, SCHEMA_VERSION } from "./world-model-generator";
import { StorageAdapter } from "./memory-brain";

const FILENAME = "world-model.json";

export function modelPath(userDataDir: string): string {
  return path.join(userDataDir, FILENAME);
}

export async function loadWorldModel(
  userDataDir: string,
  storage: StorageAdapter
): Promise<WorldModel | null> {
  try {
    const p = modelPath(userDataDir);
    if (!storage.exists(p)) return null;
    const dataStr = await storage.read(p);
    const data = JSON.parse(dataStr);
    if (!data) return null;
    if (data.schemaVersion !== SCHEMA_VERSION) {
      console.warn("[WorldModel] Schema version mismatch. Forcing regeneration.");
      return null;
    }
    return data as WorldModel;
  } catch (err) {
    console.error("[WorldModel] Failed to load world model from disk:", err);
    return null;
  }
}

export async function saveWorldModel(
  userDataDir: string,
  model: WorldModel,
  storage: StorageAdapter
): Promise<void> {
  try {
    await storage.writeAsync(modelPath(userDataDir), JSON.stringify(model, null, 2));
  } catch (err) {
    console.error("[WorldModel] Failed to save world model to disk:", err);
  }
}

export async function ensureWorldModel(
  userDataDir: string,
  profile: DeviceProfile,
  storage: StorageAdapter
): Promise<WorldModel> {
  const existing = await loadWorldModel(userDataDir, storage);
  if (existing && existing.generatedAt >= profile.scannedAt) {
    return existing;
  }
  const fresh = generateWorldModel(profile);
  await saveWorldModel(userDataDir, fresh, storage);
  return fresh;
}
