"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.modelPath = modelPath;
exports.loadWorldModel = loadWorldModel;
exports.saveWorldModel = saveWorldModel;
exports.ensureWorldModel = ensureWorldModel;
const node_path_1 = __importDefault(require("node:path"));
const world_model_generator_1 = require("./world-model-generator");
const FILENAME = "world-model.json";
function modelPath(userDataDir) {
    return node_path_1.default.join(userDataDir, FILENAME);
}
async function loadWorldModel(userDataDir, storage) {
    try {
        const p = modelPath(userDataDir);
        if (!storage.exists(p))
            return null;
        const dataStr = await storage.read(p);
        const data = JSON.parse(dataStr);
        if (!data)
            return null;
        if (data.schemaVersion !== world_model_generator_1.SCHEMA_VERSION) {
            console.warn("[WorldModel] Schema version mismatch. Forcing regeneration.");
            return null;
        }
        return data;
    }
    catch (err) {
        console.error("[WorldModel] Failed to load world model from disk:", err);
        return null;
    }
}
async function saveWorldModel(userDataDir, model, storage) {
    try {
        await storage.writeAsync(modelPath(userDataDir), JSON.stringify(model, null, 2));
    }
    catch (err) {
        console.error("[WorldModel] Failed to save world model to disk:", err);
    }
}
async function ensureWorldModel(userDataDir, profile, storage) {
    const existing = await loadWorldModel(userDataDir, storage);
    if (existing && existing.generatedAt >= profile.scannedAt) {
        return existing;
    }
    const fresh = (0, world_model_generator_1.generateWorldModel)(profile);
    await saveWorldModel(userDataDir, fresh, storage);
    return fresh;
}
//# sourceMappingURL=world-model.js.map