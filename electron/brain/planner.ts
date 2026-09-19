// Quip Head Brain — Execution Planner (spec Phase 1 STEP 7/8 + Phase 4)
// ─────────────────────────────────────────────────────────────────────────────
// Every request becomes a tiny execution plan BEFORE anything runs:
//
//   Goal → Required actions → Per-step verification expectation → Permissions
//
// Simple tasks plan in microseconds (direct mapping from the deterministic
// parse); complex workflows route to the existing agent tier; chat routes to
// the companion. The Action Engine (orchestrator) stays the single executor —
// this module only gives it an EXPLICIT, verifiable plan.
//
// Anti-fake-success (spec §14): every step carries an `verify.expect` — what
// must be TRUE in the world afterwards. "Attempted" never counts as "done".
// ─────────────────────────────────────────────────────────────────────────────

import type { TaskClass, Understanding } from "./understanding";
import { RETRYABLE_ACTIONS } from "../engine/orchestrator";
import { riskForStep, type RiskLevel } from "../engine/permission-modes";

export interface PlanVerify {
  /** Plain-language expected outcome — shown to the user on failure. */
  expect: string;
  /** How the outcome is checked (maps to engine/action-verifier primitives). */
  method: string;
}

export interface PlanStep {
  action: string;
  target: string;
  params: Record<string, string>;
  description: string;
  verify: PlanVerify;
  timeoutMs: number;
  /** Idempotent actions may auto-retry; input-injecting ones may not. */
  retryable: boolean;
}

export type ExecutionPath = "direct" | "agent" | "chat" | "clarify";

export interface ExecutionPlan {
  goal: string;
  kind: TaskClass;
  path: ExecutionPath;
  steps: PlanStep[];
  permissionsRequired: RiskLevel;
  expectedResult: string;
  /** The explanation trail inherited from understanding (observability). */
  why: string[];
}

// ─── Per-action verification recipes ─────────────────────────────────────────

const VERIFY_BY_ACTION: Record<string, PlanVerify> = {
  open_app: { expect: "the app's process or window is visible", method: "processExists + windowWithTitleExists" },
  open_website: { expect: "the browser is open on the site", method: "windowWithTitleExists" },
  open_url: { expect: "the URL is open in the browser", method: "windowWithTitleExists" },
  open_folder: { expect: "a File Explorer window shows the folder", method: "windowWithTitleExists" },
  open_file: { expect: "the file's associated app opened it", method: "windowWithTitleExists" },
  play_media: { expect: "the player is open and playback started", method: "URL/page observation" },
  search_youtube: { expect: "YouTube results (or the video) are open", method: "URL observation" },
  search_web: { expect: "the results page is open", method: "URL observation" },
  site_search: { expect: "the site's results are visible", method: "URL observation" },
  read_page: { expect: "page/screen content was captured", method: "observation returned content" },
  screen: { expect: "a screenshot was captured and inspected", method: "observation returned content" },
  windows_list: { expect: "window titles were enumerated", method: "observation returned list" },
  process_list: { expect: "the process list was enumerated", method: "observation returned list" },
  type_text: { expect: "the text landed in the focused window", method: "post-action observation" },
  press_key: { expect: "the key was accepted by the focused window", method: "post-action observation" },
  click: { expect: "the click landed on the intended target", method: "post-action observation" },
  scroll: { expect: "the view scrolled", method: "post-action observation" },
  drag: { expect: "the drag completed between both points", method: "post-action observation" },
  mouse_move: { expect: "the cursor reached the target point", method: "pointer position" },
  clipboard: { expect: "the clipboard now holds the expected content", method: "clipboard read-back" },
  window_control: { expect: "the window is in the requested state", method: "window state query" },
  volume: { expect: "the system volume reflects the request", method: "volume query" },
  media_key: { expect: "the player responded to the media key", method: "player state" },
  browser_tab: { expect: "the tab operation took effect", method: "tab state" },
  system_action: { expect: "the system action completed", method: "system state query" },
  process_kill: { expect: "the process no longer exists", method: "processExists → false" },
  self_check: { expect: "every capability probe returned its honest result", method: "probe report" },
  file_op: { expect: "the filesystem shows the requested change", method: "filesystem re-check" },
};

const TIMEOUT_BY_ACTION: Record<string, number> = {
  open_app: 15_000,
  open_website: 15_000,
  open_url: 15_000,
  open_folder: 12_000,
  open_file: 12_000,
  play_media: 20_000,
  search_youtube: 20_000,
  search_web: 20_000,
  site_search: 20_000,
  read_page: 20_000,
  screen: 12_000,
  file_op: 10_000,
};

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Capability-question keywords — questions that still need REAL tools
 * (weather, summarize, system status, document reading). Mirrors the
 * orchestrator's agent-tier heuristic: these route to the agent, never to
 * plain chat, or Quip would start GUESSING the weather instead of fetching it.
 */
const CAPABILITY_RE =
  /\b(weather|mausam|temperature|forecast|summarize|summarise|summary|pdf|docx|xlsx|pptx|word file|excel|powerpoint|slide deck|cpu|memory usage|disk space|battery|network status|wifi|wi-fi|github repo|tweet|screenshot)\b/i;

// ─── The planner ─────────────────────────────────────────────────────────────

export function buildExecutionPlan(u: Understanding): ExecutionPlan {
  const why = u.explanation;

  // Clarification short-circuits everything — asking IS the correct action.
  if (u.clarification.needed) {
    return {
      goal: u.meaning,
      kind: u.classification,
      path: "clarify",
      steps: [],
      permissionsRequired: "safe",
      expectedResult: `One short question answered before acting: ${u.clarification.question ?? ""}`.trim(),
      why,
    };
  }

  // Conversational input stays conversational UNLESS it asks for a real
  // capability — "what's the weather" / "summarize this page" must hit REAL
  // tools (the agent tier), never the chat brain guessing.
  if (u.classification === "chat" || u.classification === "question") {
    const needsTools = CAPABILITY_RE.test(u.literal);
    return {
      goal: u.meaning,
      kind: u.classification,
      path: needsTools ? "agent" : "chat",
      steps: [],
      permissionsRequired: "safe",
      expectedResult: needsTools
        ? `The agent fetches real data and answers: ${u.meaning}`
        : "The companion answers in conversation.",
      why,
    };
  }

  // Not a confident deterministic task → the agent tier (existing, proven).
  if (!u.isTask || u.parsed.steps.length === 0) {
    return {
      goal: u.meaning,
      kind: u.classification,
      path: "agent",
      steps: [],
      permissionsRequired: "medium",
      expectedResult: `The tool-calling agent completes: ${u.meaning}`,
      why,
    };
  }

  // Deterministic plan — direct mapping with verification expectations.
  const steps: PlanStep[] = u.parsed.steps.map((s) => ({
    action: s.action,
    target: s.target,
    params: s.params,
    description: s.description,
    verify: VERIFY_BY_ACTION[s.action] ?? { expect: "the step's own verifier reports success", method: "executor verification" },
    timeoutMs: TIMEOUT_BY_ACTION[s.action] ?? DEFAULT_TIMEOUT_MS,
    retryable: RETRYABLE_ACTIONS.has(s.action),
  }));

  let permissionsRequired: RiskLevel = "safe";
  for (const s of steps) {
    const r = riskForStep(s.action, s.params);
    if (r === "dangerous") permissionsRequired = "dangerous";
    else if (r === "medium" && permissionsRequired !== "dangerous") permissionsRequired = "medium";
  }

  return {
    goal: u.meaning,
    kind: u.classification,
    path: "direct",
    steps,
    permissionsRequired,
    expectedResult:
      steps.length === 1
        ? capitalize(steps[0].verify.expect)
        : `${steps.length} steps complete — each verified (${steps.map((s) => s.verify.expect).join("; ").slice(0, 220)})`,
    why,
  };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
