// Quip V2 — TASK BRAIN
// -----------------------------------------------------------------------------
// The brain that replaced act.ts. Old flow:
//
//   Command  ->  hardcoded if/else  ->  single action
//
// New flow:
//
//   Command
//     -> Parse intent (WHAT does the user want?)
//     -> Consult device + environment brains (what CAN we do?)
//     -> Build a multi-step plan (subtasks)
//     -> For each subtask: check permission -> execute -> collect note
//     -> Return a user-facing summary + trust-layer notes
//
// Speed: intent parsing + planning is pure local string/regex work — no
// network round trip. The user sees the first action fire within ~50-150ms.
// Multi-step execution is sequential by necessity (open browser THEN search),
// but each step is fast.
//
// The plan is fully transparent: every subtask has a human description and
// the executor returns a trust-layer note, so the UI can show WHY Quip did
// what it did.
// -----------------------------------------------------------------------------

import { resolveCapability } from "./capability-registry";
import { executeImplementation } from "./tool-executor";
import { permissionSystem } from "../system/permission-system";
import type {
  CapabilityId,
  DeviceProfile,
  EnvironmentState,
  ParsedIntent,
  Subtask,
  TaskPlan,
  TaskResultPayload,
  IntentType,
} from "../../src/types";

const uid = () =>
  Math.random().toString(36).slice(2) + Date.now().toString(36);

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "a", "an", "the", "please", "kindly", "can", "you", "could", "would",
  "and", "then", "also", "for", "to", "of", "on", "in", "my", "me",
  // hindi/hinglish verbs we support
  "chala", "chalao", "baja", "bajao", "khol", "khola", "kholo",
  "ek", "koi", "kuch", "thoda",
]);

function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[“”"]/g, "")
    .replace(/[^\w\s:/.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTopic(raw: string, extraStops: string[] = []): string {
  const stop = new Set([...STOP_WORDS, ...extraStops]);
  return normalize(raw)
    .split(" ")
    .filter((w) => w && !stop.has(w))
    .join(" ")
    .trim();
}

function contains(text: string, phrases: string[]): boolean {
  return phrases.some((p) => text.includes(p));
}

// ---------------------------------------------------------------------------
// Intent parsing — synchronous, no network. This is the fast pre-planner.
// ---------------------------------------------------------------------------

const URL_RE = /^https?:\/\/\S+$/i;

// Known website targets -> canonical url + label.
const SITES: Record<string, { url: string; label: string }> = {
  youtube: { url: "https://www.youtube.com", label: "YouTube" },
  "youtube music": { url: "https://music.youtube.com", label: "YouTube Music" },
  "yt music": { url: "https://music.youtube.com", label: "YouTube Music" },
  gmail: { url: "https://mail.google.com", label: "Gmail" },
  google: { url: "https://www.google.com", label: "Google" },
  github: { url: "https://github.com", label: "GitHub" },
  chatgpt: { url: "https://chat.openai.com", label: "ChatGPT" },
  spotify: { url: "https://open.spotify.com", label: "Spotify" },
  maps: { url: "https://www.google.com/maps", label: "Maps" },
  reddit: { url: "https://www.reddit.com", label: "Reddit" },
  instagram: { url: "https://www.instagram.com", label: "Instagram" },
  twitter: { url: "https://x.com", label: "X" },
  x: { url: "https://x.com", label: "X" },
  whatsapp: { url: "https://web.whatsapp.com", label: "WhatsApp" },
  linkedin: { url: "https://www.linkedin.com", label: "LinkedIn" },
  notion: { url: "https://www.notion.so", label: "Notion" },
  figma: { url: "https://www.figma.com", label: "Figma" },
  discord: { url: "https://discord.com/app", label: "Discord" },
  slack: { url: "https://slack.com/signin", label: "Slack" },
  bing: { url: "https://www.bing.com", label: "Bing" },
  netflix: { url: "https://www.netflix.com", label: "Netflix" },
  "google drive": { url: "https://drive.google.com", label: "Google Drive" },
  "google docs": { url: "https://docs.google.com", label: "Google Docs" },
  calendar: { url: "https://calendar.google.com", label: "Calendar" },
};

// Map a raw target word to a site key.
function matchSite(text: string): string | null {
  for (const key of Object.keys(SITES)) {
    if (text.includes(key)) return key;
  }
  return null;
}

export function parseIntent(raw: string): ParsedIntent {
  const text = normalize(raw);
  const verbs: string[] = [];
  const v = (arr: string[]) => {
    if (contains(text, arr)) verbs.push(arr[0]);
  };
  v(["open", "launch", "start", "khol", "khola", "kholo", "chala", "chalao"]);
  v(["play", "baja", "bajao"]);
  v(["search", "find", "look", "google"]);
  v(["write", "compose", "draft", "send", "mail", "email"]);
  v(["go", "visit", "navigate"]);

  // --- Pure URL ---
  if (URL_RE.test(text)) {
    return {
      type: "open_website",
      target: text,
      query: null,
      confidence: 1,
      verbs,
      raw: text,
    };
  }

  // --- Play media ---
  if (
    contains(text, ["play", "baja", "bajao", "listen", "song", "gaana", "music"]) ||
    (contains(text, ["youtube", "yt"]) && contains(text, ["play", "baja", "bajao", "song", "music"]))
  ) {
    const query = extractTopic(raw, [
      "play", "baja", "bajao", "song", "gaana", "music", "listen",
      "youtube", "yt", "spotify", "on", "some", "of",
    ]);
    return {
      type: "play_media",
      target: contains(text, ["spotify"]) ? "spotify" : "youtube",
      query: query || null,
      confidence: 0.95,
      verbs,
      raw: text,
    };
  }

  // --- Compose mail ---
  if (contains(text, ["gmail", "mail", "email"]) &&
      contains(text, ["write", "compose", "draft", "send", "email", "message"])) {
    return {
      type: "compose_mail",
      target: "gmail",
      query: extractTopic(raw, [
        "write", "compose", "draft", "send", "email", "gmail", "mail",
        "message", "to", "about", "subject", "body", "regarding", "with",
      ]),
      confidence: 0.9,
      verbs,
      raw: text,
    };
  }

  // --- Search ---
  if (contains(text, ["search", "find", "look up", "google", "browse"])) {
    const q = extractTopic(raw, [
      "search", "find", "look", "up", "google", "browse", "for", "on", "the",
    ]);
    return {
      type: "search",
      target: "google",
      query: q || null,
      confidence: 0.9,
      verbs,
      raw: text,
    };
  }

  // --- Open known website ---
  const site = matchSite(text);
  if (site && contains(text, ["open", "launch", "start", "go", "visit", "khol", "chala", "youtube", "gmail", "spotify", site])) {
    return {
      type: "open_website",
      target: site,
      query: null,
      confidence: 0.9,
      verbs,
      raw: text,
    };
  }

  // --- Open editor ---
  if (contains(text, ["vscode", "vs code", "visual studio code", "cursor", "editor", "code editor"])) {
    const isCursor = contains(text, ["cursor"]);
    return {
      type: "open_app",
      target: isCursor ? "cursor" : "vscode",
      query: null,
      confidence: 0.85,
      verbs,
      raw: text,
    };
  }

  // --- Open settings ---
  if (contains(text, ["settings", "system settings", "preferences", "control panel"])) {
    return {
      type: "system_action",
      target: "settings",
      query: null,
      confidence: 0.9,
      verbs,
      raw: text,
    };
  }

  // --- Open files / folders ---
  if (contains(text, ["file explorer", "explorer", "finder", "files", "downloads", "desktop folder", "open downloads", "open desktop"])) {
    const loc = contains(text, ["downloads"]) ? "downloads"
      : contains(text, ["desktop"]) ? "desktop" : null;
    return {
      type: "navigate",
      target: "files",
      query: loc,
      confidence: 0.85,
      verbs,
      raw: text,
    };
  }

  // --- Open terminal ---
  if (contains(text, ["terminal", "cmd", "command prompt", "powershell"])) {
    return {
      type: "open_app",
      target: "terminal",
      query: null,
      confidence: 0.85,
      verbs,
      raw: text,
    };
  }

  // --- Open calculator / notepad ---
  if (contains(text, ["calculator", "calc"])) {
    return { type: "open_app", target: "calc", query: null, confidence: 0.8, verbs, raw: text };
  }
  if (contains(text, ["notepad", "notes", "text editor"])) {
    return { type: "open_app", target: "notepad", query: null, confidence: 0.8, verbs, raw: text };
  }

  // --- Default: chat (let the LLM handle it) ---
  return {
    type: "chat",
    target: null,
    query: null,
    confidence: 0.3,
    verbs,
    raw: text,
  };
}

// ---------------------------------------------------------------------------
// Planning — turn an intent into ordered subtasks.
// ---------------------------------------------------------------------------

function buildPlan(
  intent: ParsedIntent,
  requestId: string,
  profile: DeviceProfile,
  env: EnvironmentState
): TaskPlan {
  const ctx = { profile, environment: env };
  const subtasks: Subtask[] = [];
  let step = 1;
  const add = (
    capability: CapabilityId,
    description: string,
    params: Record<string, unknown>,
    requiresConfirmation: boolean
  ) => {
    subtasks.push({
      id: uid(),
      step: step++,
      description,
      capability,
      params,
      status: "pending",
      requiresConfirmation,
    });
  };

  let summary = "";
  let isChat = false;

  switch (intent.type) {
    case "open_website": {
      const target = intent.target ?? "";
      const site = SITES[target];
      if (site) {
        const url = site.url;
        add(
          "openUrl",
          `Open ${site.label}`,
          { url, reason: `Opening ${site.label}` },
          false
        );
        summary = `Opened ${site.label}`;
      } else if (URL_RE.test(target)) {
        add("openUrl", `Open ${target}`, { url: target }, false);
        summary = `Opened ${target}`;
      } else {
        isChat = true;
      }
      break;
    }

    case "play_media": {
      const query = intent.query ?? "";
      const useSpotify = intent.target === "spotify";
      const cap = resolveCapability("playMedia", ctx, { query });
      if (!cap.available) {
        isChat = true;
        summary = "";
        break;
      }
      // If user asked Spotify but we resolved YouTube, note the fallback.
      const label = cap.implementation?.label ?? "media";
      add(
        "playMedia",
        `Play "${query}" on ${label}`,
        cap.implementation!.params,
        false
      );
      summary = query ? `Playing ${query} ✨` : `Opened ${label}`;
      if (useSpotify && label !== "Spotify") {
        // trust note handled at execution time
      }
      break;
    }

    case "search": {
      const q = intent.query ?? intent.raw;
      add(
        "webSearch",
        `Search the web for "${q}"`,
        { query: q },
        false
      );
      summary = `Searched for ${q}`;
      break;
    }

    case "compose_mail": {
      // Parse to / subject / body heuristically.
      const toMatch = intent.raw.match(/\bto\s+([^,.;]+?)(?:\s+(?:about|subject|with|regarding)\b|$)/i);
      const subjectMatch = intent.raw.match(/\b(?:subject|about|regarding)\s+([^,.;]+?)(?:\s+(?:body|message|content)\b|$)/i);
      const bodyMatch = intent.raw.match(/\b(?:body|message|content)\s+(.+)$/i);
      const to = toMatch?.[1]?.trim() ?? "";
      const subject = subjectMatch?.[1]?.trim() ?? intent.query ?? "";
      const body = bodyMatch?.[1]?.trim() ?? "";
      add(
        "composeMail",
        `Draft an email${to ? ` to ${to}` : ""}`,
        { to, subject, body },
        true // medium risk — needs confirmation before sending
      );
      summary = `Drafted an email${to ? ` to ${to}` : ""}`;
      break;
    }

    case "open_app": {
      const target = intent.target ?? "";
      const idMap: Record<string, { cap: CapabilityId; cat: string; pref: string | null }> = {
        vscode: { cap: "openEditor", cat: "editor", pref: "vscode" },
        cursor: { cap: "openEditor", cat: "editor", pref: "cursor" },
        terminal: { cap: "openTerminal", cat: "terminal", pref: null },
        calc: { cap: "noop", cat: "system", pref: null },
        notepad: { cap: "noop", cat: "notes", pref: null },
      };
      if (target === "calc") {
        add("systemControl", "Open Calculator", { appId: "calc" }, false);
        summary = "Opened Calculator";
      } else if (target === "notepad") {
        add("openFiles", "Open Notepad", { appId: "notepad" }, false);
        summary = "Opened Notepad";
      } else if (idMap[target]) {
        const m = idMap[target];
        add(m.cap, `Open ${target}`, { appId: target, appName: target }, false);
        summary = `Opened ${target}`;
      } else {
        isChat = true;
      }
      break;
    }

    case "system_action": {
      if (intent.target === "settings") {
        add("openSettings", "Open system settings", {}, true);
        summary = "Opened settings";
      } else {
        isChat = true;
      }
      break;
    }

    case "navigate": {
      add("openFiles", `Open ${intent.query ?? "files"}`, { location: intent.query }, false);
      summary = `Opened ${intent.query ?? "files"}`;
      break;
    }

    case "chat":
    case "unknown":
    default:
      isChat = true;
      break;
  }

  return {
    id: uid(),
    requestId,
    intent,
    subtasks,
    summary,
    isChat,
    createdAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface ExecuteOptions {
  /** Called for each subtask as it runs. */
  onProgress?: (step: number, total: number, description: string) => void;
  /** Called when a subtask needs user confirmation. Returns true if approved. */
  requestConfirmation?: (description: string, capability: CapabilityId) => Promise<boolean>;
}

export async function executePlan(
  plan: TaskPlan,
  profile: DeviceProfile,
  env: EnvironmentState,
  opts: ExecuteOptions = {}
): Promise<TaskResultPayload> {
  // If it's pure chat, there's nothing to execute — the LLM handles it.
  if (plan.isChat || plan.subtasks.length === 0) {
    return {
      requestId: plan.requestId,
      success: true,
      summary: "",
      notes: [],
      plan,
    };
  }

  const ctx = { profile, environment: env };
  const notes: string[] = [];
  let allOk = true;

  for (const sub of plan.subtasks) {
    sub.status = "running";
    opts.onProgress?.(sub.step, plan.subtasks.length, sub.description);

    // Permission gate.
    if (sub.requiresConfirmation && permissionSystem.requiresConfirmation(sub.capability)) {
      const approved = opts.requestConfirmation
        ? await opts.requestConfirmation(sub.description, sub.capability)
        : true;
      if (!approved) {
        sub.status = "skipped";
        sub.output = "User declined";
        notes.push(`${sub.description} — skipped (you said no)`);
        allOk = false;
        continue;
      }
    }

    // Resolve the concrete implementation for this device.
    const resolution = resolveCapability(sub.capability, ctx, sub.params as any);
    let impl = resolution.implementation;

    // Try fallback if primary failed to resolve.
    if (!impl && resolution.fallback?.implementation) {
      impl = resolution.fallback.implementation;
      notes.push(`(Used fallback: ${impl.label})`);
    }

    if (!impl) {
      sub.status = "failed";
      sub.output = "Not available on this device";
      notes.push(`${sub.description} — not available on this device`);
      allOk = false;
      continue;
    }

    const result = await executeImplementation(impl, profile);
    sub.status = result.success ? "done" : "failed";
    sub.output = result.output;
    notes.push(result.note);
    if (!result.success) allOk = false;
  }

  return {
    requestId: plan.requestId,
    success: allOk,
    summary: plan.summary,
    notes,
    plan,
  };
}

// ---------------------------------------------------------------------------
// Public entry — used by the IPC handler.
// ---------------------------------------------------------------------------

export async function runTask(
  command: string,
  requestId: string,
  profile: DeviceProfile,
  env: EnvironmentState,
  opts: ExecuteOptions = {}
): Promise<TaskResultPayload> {
  const intent = parseIntent(command);
  const plan = buildPlan(intent, requestId, profile, env);
  return executePlan(plan, profile, env, opts);
}
