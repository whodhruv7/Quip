// Quip Head Brain — The Understanding Engine (Phase 1 of the spec)
// ─────────────────────────────────────────────────────────────────────────────
// Quip must never execute directly from raw text. EVERY request first becomes
// a structured Understanding object:
//
//   raw text → references resolved → deterministic parse (intent-parser-v2)
//            → intent detection (primary / secondary / hidden + confidence)
//            → object detection (every noun becomes a typed object)
//            → task classification (simple / medium / complex / question / chat)
//            → goal (what the user ACTUALLY wants)
//            → clarification decision (ask only when guessing is unsafe)
//            → explanation trail (why it understood what it understood)
//
// Design rules from the spec:
//   • Deterministic-first: regex/alias/index lookups only — sub-100 ms.
//     The LLM is NEVER required for understanding (only the orchestrator's
//     pre-existing model-assist handles genuinely ambiguous leftovers).
//   • Provider-independent: no model calls in this module. Changing
//     Claude/GPT/Gemini/Llama/Grok can never change how Quip understands.
//   • Reuses the proven parser (engine/intent-parser-v2.ts) and its alias
//     tables — no duplicated knowledge (single source of truth).
//   • Explainable: every decision lands in `explanation[]` for debugging.
// ─────────────────────────────────────────────────────────────────────────────

import { parseIntentV2, APP_HINTS, SITE_HINTS, type ParsedIntent } from "../engine/intent-parser-v2";
import { resolveReferences, type ReferenceInput, type ResolutionResult } from "./references";

// ─── Public types ────────────────────────────────────────────────────────────

/** The spec's STEP 2 intent taxonomy. */
export type IntentKind =
  | "OPEN" | "PLAY" | "SEARCH" | "CREATE" | "DELETE" | "MOVE" | "COPY"
  | "SEND" | "READ" | "WRITE" | "EXPLAIN" | "COMPARE" | "RESEARCH"
  | "CODE" | "DEBUG" | "ORGANIZE" | "AUTOMATE" | "CONTROL" | "REMEMBER"
  | "LEARN" | "CONTINUE" | "STOP" | "CONVERSE";

export interface UnderstoodIntent {
  kind: IntentKind;
  confidence: number;
  /** Why this intent was assigned (short, human-readable). */
  because: string;
}

export type ObjectKind =
  | "app" | "website" | "file" | "folder" | "song" | "person"
  | "text" | "url" | "unknown";

export interface UnderstoodObject {
  name: string;
  type: ObjectKind;
  confidence: number;
  /** Where the object was resolved from (alias table / device index / parser). */
  resolvedVia: string;
}

/** Spec STEP 7 — task classification. */
export type TaskClass =
  | "simple_action"      // "Open Chrome"
  | "medium_task"        // "Open Gmail, draft a mail, attach the PDF"
  | "complex_workflow"   // "Open ChatGPT, copy the prompt, paste in Codex"
  | "question"           // "What's my battery level?"
  | "chat";              // "bhai kya scene hai"

export interface Clarification {
  needed: boolean;
  question?: string;
  because?: string;
}

export interface Understanding {
  /** What the user literally said. */
  literal: string;
  /** Text AFTER reference resolution — what the brain actually works with. */
  resolved: string;
  /** One line: what the user actually wants (the goal). */
  meaning: string;
  intents: {
    primary: UnderstoodIntent;
    secondary: UnderstoodIntent[];
    hidden: UnderstoodIntent[];
  };
  objects: UnderstoodObject[];
  classification: TaskClass;
  isTask: boolean;
  /** Ask-before-acting decision — never guess when unsafe. */
  clarification: Clarification;
  /** The deterministic parse feeding the Action Engine (orchestrator). */
  parsed: ParsedIntent;
  /** Debuggable trail: why it understood what it understood. */
  explanation: string[];
  /** Reference resolution details. */
  referenceNotes: string[];
  /** Speed telemetry (spec STEP 10) — all in milliseconds. */
  timings: { referenceMs: number; parseMs: number; enrichMs: number; totalMs: number };
}

/** Fast device-index lookup injected by main.ts (optional, in-memory). */
export interface DeviceLookup {
  findApp(name: string): { name: string; via: string } | null;
}

export interface BuildOptions {
  /** Conversation memory snapshot (for reference resolution). */
  memory?: ReferenceInput;
  /** Execution-context carry-overs (context-store). */
  execContext?: {
    lastOpenedPath?: string;
    lastMediaQuery?: string;
    activeApp?: string;
    activeWebsite?: string;
  };
  /** Device Knowledge Layer lookup (when the index is ready). */
  deviceIndex?: DeviceLookup | null;
  workspacePath?: string;
}

// ─── Intent mapping tables ───────────────────────────────────────────────────

const ACTION_INTENT: Record<string, IntentKind> = {
  // Fine-grained step actions.
  open_app: "OPEN",
  open_website: "OPEN",
  open_url: "OPEN",
  open_folder: "OPEN",
  open_file: "OPEN",
  play_media: "PLAY",
  search_youtube: "PLAY",
  search_web: "SEARCH",
  site_search: "SEARCH",
  read_page: "READ",
  screen: "READ",
  windows_list: "READ",
  process_list: "READ",
  self_check: "READ",
  compose_email: "SEND",
  compose_message: "SEND",
  type_text: "CONTROL",
  press_key: "CONTROL",
  click: "CONTROL",
  scroll: "CONTROL",
  drag: "CONTROL",
  mouse_move: "CONTROL",
  clipboard: "CONTROL",
  window_control: "CONTROL",
  volume: "CONTROL",
  media_key: "CONTROL",
  browser_tab: "CONTROL",
  system_action: "CONTROL",
  process_kill: "STOP",
  // Autonomy wave — fine-grained.
  web_ghost_read: "READ",
  web_ghost_extract: "SEARCH",
  web_ghost_click: "CONTROL",
  web_ghost_fill: "CONTROL",
  mailwing_draft: "WRITE",
  mailwing_send: "SEND",
  mailwing_accounts: "READ",
  mailwing_outbox: "READ",
  contacts_search: "SEARCH",
  contacts_save: "WRITE",
  contacts_export: "WRITE",
  file_organize: "ORGANIZE",
  file_duplicates: "ORGANIZE",
  file_storage_report: "READ",
  file_watch: "AUTOMATE",
  screenshot_save: "READ",
  wallpaper_set: "CONTROL",
  brightness: "CONTROL",
  notify_me: "CONTROL",
  lock_pc: "CONTROL",
  clipboard_history: "READ",
  install_app: "CREATE",
  quest_run: "AUTOMATE",
  routine_save: "AUTOMATE",
  routine_run: "AUTOMATE",
  routine_list: "READ",
  // Coarse top-level actions the parser also emits (steps stay fine-grained).
  open: "OPEN",
  play: "PLAY",
  search: "SEARCH",
  close_app: "CONTROL",
  read: "READ",
  file_op: "CONTROL",
  chat: "CONVERSE",
  // Autonomy wave — coarse.
  quest: "AUTOMATE",
  extract_contacts: "SEARCH",
  send_email: "SEND",
  export_contacts: "WRITE",
  save_contact: "WRITE",
  find_contact: "SEARCH",
  organize: "ORGANIZE",
  duplicates: "ORGANIZE",
  storage_report: "READ",
  watch: "AUTOMATE",
  wallpaper: "CONTROL",
  lock: "CONTROL",
  battery: "READ",
  install: "CREATE",
  routines: "AUTOMATE",
  clarify: "CONVERSE",
};

/** Verbs (English + Hinglish) scanned from the raw text for secondary intents. */
const VERB_SCAN: Array<[RegExp, IntentKind]> = [
  [/\b(open|launch|start|kholo?|khol do|start karo)\b/i, "OPEN"],
  [/\b(play|bajao?|chala(?:o| do)?)\b/i, "PLAY"],
  [/\b(search|find|look ?up|google|dhundo?|dhoondo?)\b/i, "SEARCH"],
  [/\b(create|make|new|banao?|banado?)\b/i, "CREATE"],
  [/\b(delete|remove|hatao?|delete karo)\b/i, "DELETE"],
  [/\b(move|rename)\b/i, "MOVE"],
  [/\b(copy|copy karo)\b/i, "COPY"],
  [/\b(send|bhejo?|bhej do)\b/i, "SEND"],
  [/\b(read|padho?|summarize|summarise)\b/i, "READ"],
  [/\b(write|likho?|likh do)\b/i, "WRITE"],
  [/\b(explain|samjhao?|why|how does)\b/i, "EXPLAIN"],
  [/\b(compare|difference|vs\.?)\b/i, "COMPARE"],
  [/\b(research|find out|look into)\b/i, "RESEARCH"],
  [/\b(code|program|script)\b/i, "CODE"],
  [/\b(debug|fix|theek karo)\b/i, "DEBUG"],
  [/\b(organize|clean|saaf|arrange)\b/i, "ORGANIZE"],
  [/\b(automate|schedule)\b/i, "AUTOMATE"],
  [/\b(click|type|press|type karo|paste)\b/i, "CONTROL"],
  [/\b(remember|yaad rakho)\b/i, "REMEMBER"],
  [/\b(learn|seekho)\b/i, "LEARN"],
  [/\b(continue|aage badho|next phase)\b/i, "CONTINUE"],
  [/\b(stop|cancel|ruk ja|band karo|rok do)\b/i, "STOP"],
];

/** Prerequisite intents — implied by the primary, not said out loud. */
const HIDDEN_FROM: Array<[IntentKind, IntentKind, string]> = [
  ["PLAY", "SEARCH", "playing always starts with finding the right song/source"],
  ["SEND", "WRITE", "sending means composing the message first"],
  ["DEBUG", "CODE", "debugging implies reading the code"],
];

const QUESTION_RE = /\b(what|why|how|when|who|which|kya|kyu|kyun|kaise|kaun|kahan)\b|\?\s*$/i;

// ─── The builder ─────────────────────────────────────────────────────────────

export function buildUnderstanding(raw: string, opts: BuildOptions = {}): Understanding {
  const t0 = Date.now();
  const memory: ReferenceInput = { ...(opts.memory ?? {}), ...(opts.execContext ?? {}) };

  // ── Stage 1: reference resolution ("close it" → "close Visual Studio Code")
  const resolution: ResolutionResult = resolveReferences(raw, memory);
  const tRef = Date.now();

  // ── Stage 2: deterministic parse (the proven V2 parser, zero model calls)
  const parsed = parseIntentV2(resolution.resolved, {
    context: {
      ...(opts.execContext ?? {}),
      updatedAt: opts.execContext ? Date.now() : 0,
    } as any,
    workspacePath: opts.workspacePath,
  });
  const tParse = Date.now();

  // ── Stage 3: intent detection ────────────────────────────────────────────
  const intents = detectIntents(raw, parsed);
  // ── Stage 4: object detection ────────────────────────────────────────────
  const objects = detectObjects(parsed, raw, opts.deviceIndex ?? null);
  // ── Stage 5: classification ──────────────────────────────────────────────
  const { classification, classifyWhy } = classifyTask(parsed, raw);
  // ── Stage 6: goal ────────────────────────────────────────────────────────
  const meaning = deriveGoal(parsed, objects, resolution.resolved);
  // ── Stage 7: clarification decision ──────────────────────────────────────
  const clarification = decideClarification(parsed, resolution, objects, classification);
  const tEnrich = Date.now();

  // ── Stage 8: explanation trail ───────────────────────────────────────────
  const explanation: string[] = [];
  if (resolution.notes.length) explanation.push(...resolution.notes.map((n) => `Reference: ${n}`));
  if (resolution.unresolved) explanation.push(`Reference: "${resolution.unresolved}" not in recent memory`);
  explanation.push(
    `Intent ${intents.primary.kind} (${intents.primary.confidence.toFixed(2)}) — ${intents.primary.because}`
  );
  for (const s of intents.secondary.slice(0, 2)) explanation.push(`Also ${s.kind} (${s.confidence.toFixed(2)}) — ${s.because}`);
  for (const h of intents.hidden) explanation.push(`Implied ${h.kind} — ${h.because}`);
  for (const o of objects) explanation.push(`Object: ${o.name} → ${o.type} (${(o.confidence * 100).toFixed(0)}%, via ${o.resolvedVia})`);
  explanation.push(`Classified ${classification} — ${classifyWhy}`);
  if (clarification.needed) explanation.push(`Clarification needed — ${clarification.because}`);

  return {
    literal: raw,
    resolved: resolution.resolved,
    meaning,
    intents,
    objects,
    classification,
    isTask: parsed.isTask && classification !== "chat" && classification !== "question",
    clarification,
    parsed,
    explanation,
    referenceNotes: resolution.notes,
    timings: {
      referenceMs: tRef - t0,
      parseMs: tParse - tRef,
      enrichMs: tEnrich - tParse,
      totalMs: tEnrich - t0,
    },
  };
}

// ─── Stage implementations ───────────────────────────────────────────────────

function detectIntents(raw: string, parsed: ParsedIntent): Understanding["intents"] {
  const mapped = ACTION_INTENT[parsed.action];
  const primaryKind: IntentKind = mapped ?? (parsed.isTask ? "CONTROL" : "CONVERSE");
  const primary: UnderstoodIntent = {
    kind: primaryKind,
    confidence: parsed.isTask ? Math.max(0.5, parsed.confidence) : 0.55,
    because: parsed.isTask
      ? `parser resolved the action "${parsed.action}"`
      : "no task verbs — treating as conversation",
  };

  // Secondary intents: additional verbs present in the raw sentence.
  const lower = raw.toLowerCase();
  const secondary: UnderstoodIntent[] = [];
  const seen = new Set<IntentKind>([primaryKind]);
  for (const [re, kind] of VERB_SCAN) {
    if (re.test(lower) && !seen.has(kind)) {
      seen.add(kind);
      secondary.push({ kind, confidence: 0.6, because: `verb found in "${raw.trim().slice(0, 40)}"` });
    }
    if (secondary.length >= 3) break;
  }

  // Hidden (implied) intents — prerequisites of the primary.
  const hidden: UnderstoodIntent[] = [];
  for (const [when, implies, why] of HIDDEN_FROM) {
    if (!why) continue;
    if (primaryKind === when && !seen.has(implies)) {
      hidden.push({ kind: implies, confidence: 0.5, because: why });
    }
  }

  return { primary, secondary, hidden };
}

function detectObjects(parsed: ParsedIntent, raw: string, deviceIndex: DeviceLookup | null): UnderstoodObject[] {
  const objects: UnderstoodObject[] = [];
  const seen = new Set<string>();
  const push = (o: UnderstoodObject) => {
    const key = `${o.type}:${o.name.toLowerCase()}`;
    if (!o.name || seen.has(key)) return;
    seen.add(key);
    objects.push(o);
  };

  for (const step of parsed.steps) {
    switch (step.action) {
      case "open_app": {
        const hintName = APP_HINTS[step.target.toLowerCase()] ?? step.target;
        const indexed = deviceIndex?.findApp(step.target) ?? null;
        push({
          name: indexed?.name ?? hintName,
          type: "app",
          confidence: indexed ? 0.99 : APP_HINTS[step.target.toLowerCase()] ? 0.97 : 0.85,
          resolvedVia: indexed ? `device index (${indexed.via})` : APP_HINTS[step.target.toLowerCase()] ? "alias table" : "parser",
        });
        break;
      }
      case "open_website": {
        const hint = SITE_HINTS[step.target.toLowerCase()];
        push({
          name: hint?.label ?? titleCase(step.target),
          type: "website",
          confidence: hint ? 0.95 : 0.8,
          resolvedVia: hint ? "site alias table" : "parser",
        });
        break;
      }
      case "open_url":
        push({ name: step.target, type: "url", confidence: 0.98, resolvedVia: "explicit URL" });
        break;
      case "open_folder":
        push({ name: step.target, type: "folder", confidence: 0.75, resolvedVia: "parser" });
        break;
      case "open_file":
        push({ name: step.target, type: "file", confidence: 0.75, resolvedVia: "parser" });
        break;
      case "play_media":
      case "search_youtube": {
        const q = step.params?.query || step.target;
        push({ name: q, type: "song", confidence: 0.8, resolvedVia: "parser query" });
        if (step.target && step.target !== "youtube" && step.target !== "spotify") {
          push({ name: step.target, type: "website", confidence: 0.7, resolvedVia: "parser target" });
        }
        break;
      }
      case "search_web":
      case "site_search":
        push({ name: step.params?.query || step.target, type: "text", confidence: 0.7, resolvedVia: "parser query" });
        break;
      case "compose_email":
      case "compose_message":
        if (step.target) push({ name: step.target, type: "person", confidence: 0.6, resolvedVia: "parser target" });
        break;
      case "process_kill":
        push({ name: step.target, type: "app", confidence: 0.7, resolvedVia: "parser (process)" });
        break;
      case "file_op": {
        const isFolder = /folder|directory/i.test(step.target);
        push({
          name: step.target,
          type: isFolder ? "folder" : /\.\w{1,6}$/.test(step.target) ? "file" : "text",
          confidence: 0.7,
          resolvedVia: "parser",
        });
        break;
      }
      default:
        break;
    }
  }

  // A bare URL the user pasted.
  const urlInRaw = raw.match(/https?:\/\/[^\s"<>]+/i);
  if (urlInRaw && !objects.some((o) => o.type === "url")) {
    push({ name: urlInRaw[0], type: "url", confidence: 0.95, resolvedVia: "explicit URL" });
  }

  // Unknown explicit target (low confidence, honest).
  if (parsed.isTask && parsed.target && objects.length === 0) {
    push({ name: parsed.target, type: "unknown", confidence: 0.4, resolvedVia: "parser (unresolved)" });
  }

  return objects;
}

function classifyTask(parsed: ParsedIntent, raw: string): { classification: TaskClass; classifyWhy: string } {
  if (!parsed.isTask) {
    if (QUESTION_RE.test(raw)) return { classification: "question", classifyWhy: "interrogative phrasing, no task verbs" };
    return { classification: "chat", classifyWhy: "no task verbs — plain conversation" };
  }
  const n = parsed.steps.length;
  if (n >= 3) return { classification: "complex_workflow", classifyWhy: `${n} chained steps across multiple targets` };
  if (n === 2) return { classification: "medium_task", classifyWhy: "2 chained steps" };
  return { classification: "simple_action", classifyWhy: "single direct step" };
}

function deriveGoal(parsed: ParsedIntent, objects: UnderstoodObject[], resolved: string): string {
  const obj = objects[0]?.name ?? parsed.target;
  const q = parsed.query || parsed.steps[0]?.params?.query || "";
  // Steps carry the FINE-GRAINED action; the top-level is coarser.
  const a = parsed.steps[0]?.action ?? parsed.action;
  switch (a) {
    case "open_app":
      return `Launch ${obj} (desktop app) and bring it to the front`;
    case "open_website":
      return `Open ${obj} in the browser`;
    case "open_url":
      return `Open ${obj}`;
    case "open_folder":
      return `Open the ${obj} folder`;
    case "open_file":
      return `Open ${obj}`;
    case "play_media":
      return q ? `Play "${q}" on the preferred music source, best match first` : `Start media playback`;
    case "search_youtube":
      return q ? `Find "${q}" on YouTube and play the best match` : `Search YouTube`;
    case "search_web":
      return q ? `Search the web for "${q}"` : `Search the web`;
    case "site_search":
      return q ? `Search ${parsed.target} for "${q}"` : `Search ${parsed.target}`;
    case "read_page":
      return `Read the current page/screen and report`;
    case "compose_email":
    case "compose_message":
      return obj ? `Draft a message to ${obj}` : `Draft a message`;
    case "file_op":
      return `${titleCase(parsed.query || parsed.summary || "file operation")}`;
    case "process_kill":
      return `Force-close ${obj}`;
    default:
      return parsed.summary || firstSentence(resolved);
  }
}

function decideClarification(
  parsed: ParsedIntent,
  resolution: ResolutionResult,
  objects: UnderstoodObject[],
  classification: TaskClass
): Clarification {
  // Only tasks can need clarification — chat/questions go to the companion.
  if (classification === "chat" || classification === "question") {
    return { needed: false };
  }
  const verbs = /^(open|close|launch|start|kill|focus|play|find|show|kholo|band karo|dekho|dikhao)\b/i;

  // 1. A reference ("it"/"that") was used but memory has nothing to resolve it.
  if (resolution.unresolved && verbs.test(resolution.resolved)) {
    const verb = resolution.resolved.match(verbs)?.[1] ?? "act on";
    return {
      needed: true,
      question: `Which one should I ${verb.toLowerCase()}? You said "${resolution.unresolved}" but nothing recent matches. Tell me the name once and I'll remember it.`,
      because: "unresolved pronoun reference with empty memory",
    };
  }

  // 2. A confident action verb with NO target at all ("open", "play").
  if (
    parsed.isTask &&
    parsed.steps.length === 0 &&
    !parsed.target.trim() &&
    objects.length === 0 &&
    verbs.test(resolution.resolved)
  ) {
    const verb = resolution.resolved.match(verbs)?.[1] ?? "act on";
    return {
      needed: true,
      question: `${titleCase(verb)} what? Give me the name (app, site, song, file…) and I'll take it from there.`,
      because: "task verb without any target object",
    };
  }

  return { needed: false };
}

function firstSentence(text: string): string {
  const s = text.trim().split(/(?<=[.!?])\s+/)[0] ?? text.trim();
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
}

function titleCase(text: string): string {
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}
