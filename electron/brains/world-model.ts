// Quip V2 — WORLD MODEL
// -----------------------------------------------------------------------------
// Quip must know itself. Before it can answer "open my CRM" it must know
// whether it can open apps at all, whether it needs permission, or whether
// something is flat-out impossible. The world model is generated from the
// device profile + capability registry and injected into the system prompt.
//
// This is the anti-hallucination layer. If Quip cannot do something, the
// world model says so, and the task brain never even tries.
// -----------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import type { DeviceProfile, WorldModel } from "../../src/types";

const SCHEMA_VERSION = 1;
const FILENAME = "world-model.json";

export function generateWorldModel(profile: DeviceProfile): WorldModel {
  const canDo: string[] = [
    "have a conversation",
    "answer questions",
    "use markdown in replies",
  ];
  const needsPermission: string[] = [];
  const cannotDo: string[] = [
    "delete files without explicit confirmation",
    "make payments",
    "access passwords or private keys",
    "send messages on your behalf without approval",
  ];

  // Capabilities are conditional on what the device actually has.
  if (profile.browsers.length > 0) {
    canDo.push(
      "open websites",
      "search the web",
      `open URLs in ${profile.defaultBrowser ?? "your default browser"}`
    );
  } else {
    cannotDo.push("open websites (no browser detected)");
  }

  if (profile.editors.length > 0) {
    canDo.push(`open your editor (${profile.defaultEditor ?? "code editor"})`);
  }

  if (profile.musicApps.length > 0 || profile.browsers.length > 0) {
    const where =
      profile.musicApps.some((m) => m.id === "spotify") ? "Spotify" : "YouTube";
    canDo.push(`play music and media (via ${where})`);
  } else {
    cannotDo.push("play media (no music app or browser detected)");
  }

  if (profile.mailApps.length > 0 || profile.browsers.length > 0) {
    canDo.push("draft emails");
    needsPermission.push("send emails");
  }

  canDo.push(
    "open system settings",
    "open file explorer",
    "open the terminal",
    "open the calculator",
    "open the notes app"
  );

  needsPermission.push(
    "change system settings",
    "open sensitive apps",
    "compose and send emails"
  );

  // Hardware context — helps the model reason about the device.
  const hw = [
    `${profile.platformLabel} ${profile.osVersion}`,
    `${profile.cpuCores} cores, ${profile.totalMemoryGB}GB RAM`,
    `${profile.monitorCount} display(s) at ${profile.primaryResolution.width}x${profile.primaryResolution.height}`,
  ].join(", ");

  const summary =
    `You are running on: ${hw}. ` +
    `You CAN: ${canDo.slice(0, 8).join(", ")}. ` +
    `You NEED PERMISSION for: ${needsPermission.join(", ")}. ` +
    `You CANNOT: ${cannotDo.slice(0, 4).join(", ")}. ` +
    `Never claim a capability you don't have. If asked for something you cannot do, say so plainly and suggest an alternative.`;

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: Date.now(),
    canDo,
    needsPermission,
    cannotDo,
    summary,
  };
}

export function modelPath(userDataDir: string): string {
  return path.join(userDataDir, FILENAME);
}

export function loadWorldModel(userDataDir: string): WorldModel | null {
  try {
    const p = modelPath(userDataDir);
    if (!fs.existsSync(p)) return null;
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!data || data.schemaVersion !== SCHEMA_VERSION) return null;
    return data as WorldModel;
  } catch {
    return null;
  }
}

export function saveWorldModel(userDataDir: string, model: WorldModel): void {
  try {
    fs.writeFileSync(modelPath(userDataDir), JSON.stringify(model, null, 2));
  } catch {
    /* best effort */
  }
}

export function ensureWorldModel(
  userDataDir: string,
  profile: DeviceProfile
): WorldModel {
  const existing = loadWorldModel(userDataDir);
  // Regenerate if missing or the device was re-scanned recently.
  if (existing && existing.generatedAt >= profile.scannedAt) {
    return existing;
  }
  const fresh = generateWorldModel(profile);
  saveWorldModel(userDataDir, fresh);
  return fresh;
}
