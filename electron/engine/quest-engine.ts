// Quip Quest Engine — named multi-step flows with verification + routines
// ─────────────────────────────────────────────────────────────────────────────
// Quests are how Quip does "30000-kam" work: a website email pulled out and a
// humanized mail sent, downloads organized, a morning brief spoken. Every step
// verifies before the next runs; destructive steps ALWAYS pass an approval
// gate; a failed step fails the quest honestly (skip-with-note only where the
// step is genuinely optional). Progress streams as structured events.
//
// Dependency rule: this module NEVER imports tool-registry (circularity). The
// runtime (executeTool / requestApproval / progress sink) is injected at boot
// via configureQuestRuntime().
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import {
  ghostExtractContacts,
  pickBestContact,
  isAmbiguousContact,
  ambiguousChoiceLine,
  rememberLastContact,
  lastRememberedContact,
  type GhostContact,
} from "./web-ghost";
import {
  resolveAccount,
  sendMail,
  humanizeEmail,
  gmailComposeUrl,
  type MailTone,
} from "./mailwing";
import {
  planOrganize,
  describePlan,
  applyOrganizePlan,
  type OrganizePlan,
} from "./file-butler";
import { batteryStatus } from "./ghost-hands";
import { weatherRead } from "./weather";
import { noteProblem } from "./problem-diary";

// ─── Runtime injection ───────────────────────────────────────────────────────

export interface QuestRuntime {
  executeTool: (
    action: string,
    step: { target?: string; params: Record<string, string> }
  ) => Promise<{ success: boolean; output: string; note: string; evidence?: string[] }>;
  requestApproval: (title: string, lines: string[]) => Promise<boolean>;
  signal?: { aborted: boolean };
}

let runtime: QuestRuntime | null = null;

// CAP-060: autonomy budget — the SAME destructive confirmation inside one
// quest (e.g. a second send in a loop) can be auto-approved up to N times.
// 0 (default) = ask every time. Never applies across different quests.
let approvalBudget = 0;

export function setQuestApprovalBudget(maxSameApproval: number): void {
  approvalBudget = Math.max(0, Math.min(20, Math.floor(maxSameApproval)));
}

export function getQuestApprovalBudget(): number {
  return approvalBudget;
}

export function configureQuestRuntime(rt: QuestRuntime): void {
  runtime = rt;
}

function needRuntime(): QuestRuntime {
  if (!runtime) throw new Error("Quest runtime not configured — configureQuestRuntime() must run at boot");
  return runtime;
}

// ─── Events ──────────────────────────────────────────────────────────────────

export type QuestStepStatus =
  | "running" | "done" | "failed" | "skipped" | "waiting_permission" | "cancelled";

export interface QuestEvent {
  questId: string;
  questTitle: string;
  stepIndex: number;
  stepTotal: number;
  stepName: string;
  status: QuestStepStatus;
  detail?: string;
}

export type QuestEventSink = (e: QuestEvent) => void;

let eventSink: QuestEventSink | null = null;

export function setQuestEventSink(sink: QuestEventSink | null): void {
  eventSink = sink;
}

// ─── Quest model ─────────────────────────────────────────────────────────────

export interface StepOutcome {
  ok: boolean;
  detail: string;
  /** Optional data merged into the quest context for later steps. */
  data?: Record<string, unknown>;
  /** Skipped steps don't fail the quest — the note explains why. */
  skipped?: boolean;
}

export interface QuestStepDef {
  name: string;
  description: string;
  risk: "safe" | "medium" | "dangerous";
  run: (ctx: QuestCtx) => Promise<StepOutcome>;
}

export interface Quest {
  id: string;
  title: string;
  steps: QuestStepDef[];
}

export interface QuestCtx {
  params: Record<string, string>;
  data: Record<string, unknown>;
  rt: QuestRuntime;
  emit: (status: QuestStepStatus, detail?: string) => void;
}

export interface QuestResult {
  ok: boolean;
  cancelled?: boolean;
  summary: string;
  notes: string[];
  stepsCompleted: number;
  stepsTotal: number;
  failedStep?: string;
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

function downloadsDir(): string {
  const home = process.platform === "win32" ? process.env.USERPROFILE : process.env.HOME;
  return path.join(home ?? ".", "Downloads");
}

function defaultDownloadsTarget(params: Record<string, string>): string {
  return params.dir?.trim() || downloadsDir();
}

function humanDigest(tone: string, ctx: QuestCtx): string {
  // Fact-only digest builder used by morning-brief (no LLM dependency).
  const battery = ctx.data.battery as string | undefined;
  const weather = ctx.data.weather as string | undefined;
  const lines: string[] = [];
  lines.push(`Morning brief (${tone}):`);
  if (battery) lines.push(`• Battery — ${battery}`);
  if (weather) lines.push(`• Weather — ${weather}`);
  if (!battery && !weather) lines.push("• Nothing reportable right now — battery and weather both unavailable.");
  return lines.join("\n");
}

// ─── Quest: email-from-website (the signature flow) ─────────────────────────

function buildEmailFromWebsiteQuest(params: Record<string, string>): Quest {
  return {
    id: "email-from-website",
    title: "Find a contact on a website and email them",
    steps: [
      {
        name: "read-site",
        description: `Open ${params.url} in the ghost browser and pull every contact`,
        risk: "medium",
        run: async (ctx) => {
          const r = await ghostExtractContacts(ctx.params.url);
          if (!r.ok) return { ok: false, detail: `couldn't read the site — ${r.error}` };
          ctx.data.contacts = r.contacts;
          ctx.data.siteTitle = r.title ?? "";
          ctx.data.followedContactPage = r.followedContactPage ?? false;
          if (r.contacts.length === 0) {
            return {
              ok: false,
              detail: `no email or phone found on ${ctx.params.url}${r.followedContactPage ? " (even after following their contact page)" : ""} — the site may hide contacts behind a form`,
            };
          }
          const top = r.contacts[0];
          return {
            ok: true,
            detail: `found ${r.contacts.length} contact(s); best: ${top.email ?? top.phone}`,
            data: { contacts: r.contacts },
          };
        },
      },
      {
        name: "choose-contact",
        description: "Pick the contact that matches the request",
        risk: "safe",
        run: async (ctx) => {
          const contacts = (ctx.data.contacts as GhostContact[]) ?? [];
          // CAP-068: two near-equal candidates and no hint → clarify, NEVER guess.
          if (isAmbiguousContact(contacts, ctx.params.hint)) {
            return {
              ok: false,
              detail: `two contacts match equally — ${ambiguousChoiceLine(contacts)} — tell me which one and I'll continue`,
              data: { ambiguous: true },
            };
          }
          const best = pickBestContact(contacts, ctx.params.hint);
          if (!best) return { ok: false, detail: "no contact survived selection" };
          const alternates = contacts.filter((c) => c !== best).slice(0, 3);
          rememberLastContact(best, ctx.params.url);
          ctx.data.contact = best;
          return {
            ok: true,
            detail: `chose ${best.email ?? best.phone}${best.name ? ` (${best.name})` : ""}${alternates.length ? ` — also found: ${alternates.map((c) => c.email ?? c.phone).join(", ")}` : ""}`,
          };
        },
      },
      {
        name: "resolve-account",
        description: "Find the MailWing account the mail should leave from",
        risk: "safe",
        run: async (ctx) => {
          const account = resolveAccount(ctx.params.account);
          if (account) {
            ctx.data.accountLabel = account.label;
            ctx.data.fromEmail = account.fromEmail;
            return { ok: true, detail: `sending from ${account.fromEmail} (${account.label})` };
          }
          ctx.data.fallback = "gmail";
          return {
            ok: true,
            skipped: true,
            detail: "no MailWing account configured — I'll open a prefilled Gmail draft instead (you press send)",
          };
        },
      },
      {
        name: "write-draft",
        description: "Write the humanized email body",
        risk: "safe",
        run: async (ctx) => {
          const contact = ctx.data.contact as GhostContact;
          const bodyRaw = ctx.params.body?.trim() || `Hi, I found your contact on ${ctx.params.url} and wanted to reach out.`;
          const res = await humanizeEmail({
            body: bodyRaw,
            tone: (ctx.params.tone as MailTone) ?? "professional",
            context: `The recipient's email (${contact.email}) was extracted from the website ${ctx.params.url} titled "${String(ctx.data.siteTitle ?? "")}". The user asked Quip to email this person about: ${ctx.params.about ?? ctx.params.body ?? "a general introduction"}.`,
            languageHint: ctx.params.language,
            signature: ctx.params.signature,
          });
          if (!res.body) return { ok: false, detail: "the draft came out empty" };
          ctx.data.subject = res.subject || `Hello from ${ctx.data.fromEmail ?? "Quip"}`;
          ctx.data.draftBody = res.body;
          ctx.data.humanized = res.humanized;
          return {
            ok: true,
            detail: `draft ready (${res.humanized ? "humanized" : "your words as-is"}): "${res.body.slice(0, 90)}${res.body.length > 90 ? "…" : ""}"`,
          };
        },
      },
      {
        name: "confirm-send",
        description: "Show the full draft and get explicit approval",
        risk: "dangerous",
        run: async (ctx) => {
          const contact = ctx.data.contact as GhostContact;
          ctx.emit("waiting_permission");
          const lines = [
            `To: ${contact.email ?? contact.phone}`,
            `From: ${ctx.data.fromEmail ?? "(Gmail draft)"}`,
            `Subject: ${ctx.data.subject}`,
            "",
            String(ctx.data.draftBody ?? "").slice(0, 600),
          ];
          const approved = await ctx.rt.requestApproval(`Send this email to ${contact.email}?`, lines);
          if (!approved) return { ok: false, detail: "you declined the send — nothing was sent", data: { declined: true } };
          return { ok: true, detail: "send approved" };
        },
      },
      {
        name: "deliver",
        description: "Send through MailWing or open the prefilled Gmail draft",
        risk: "dangerous",
        run: async (ctx) => {
          const contact = ctx.data.contact as GhostContact;
          if (!contact.email) {
            return { ok: false, detail: `the chosen contact has only a phone (${contact.phone}) — Quip doesn't text people without a separate approval flow` };
          }
          if (ctx.data.fallback === "gmail") {
            const url = gmailComposeUrl({
              to: contact.email,
              subject: String(ctx.data.subject ?? ""),
              body: String(ctx.data.draftBody ?? ""),
            });
            const opened = await ctx.rt.executeTool("compose_email", { target: "gmail", params: { url } });
            if (!opened.success) return { ok: false, detail: `couldn't open Gmail — ${opened.output}` };
            return {
              ok: true,
              detail: `Gmail draft opened with everything prefilled to ${contact.email} — press send when it looks right`,
            };
          }
          const res = await sendMail({
            accountId: String(ctx.data.accountLabel ?? ""),
            to: [contact.email],
            subject: String(ctx.data.subject ?? ""),
            body: String(ctx.data.draftBody ?? ""),
          });
          ctx.data.sendResult = res.status;
          if (!res.ok) return { ok: false, detail: res.output };
          return { ok: true, detail: res.output };
        },
      },
    ],
  };
}

// ─── Quest: organize-downloads ───────────────────────────────────────────────

function buildOrganizeQuest(params: Record<string, string>): Quest {
  const dir = defaultDownloadsTarget(params);
  const mode = params.mode === "date" ? "date" : "type";
  return {
    id: "organize-downloads",
    title: `Organize ${dir} by ${mode}`,
    steps: [
      {
        name: "build-plan",
        description: "Scan the folder and build the full move plan",
        risk: "safe",
        run: async (ctx) => {
          const r = planOrganize(dir, mode);
          if (!r.ok || !r.plan) return { ok: false, detail: r.error ?? "planning failed" };
          if (r.plan.entries.length === 0) {
            return { ok: true, skipped: true, detail: `${dir} is already organized — nothing to move` };
          }
          ctx.data.plan = r.plan;
          return { ok: true, detail: describePlan(r.plan) };
        },
      },
      {
        name: "confirm-plan",
        description: "Show the plan and get approval",
        risk: "dangerous",
        run: async (ctx) => {
          ctx.emit("waiting_permission");
          const plan = ctx.data.plan as OrganizePlan;
          const approved = await ctx.rt.requestApproval(
            `Move ${plan.entries.length} file(s) in ${dir}?`,
            describePlan(plan, 10).split("\n")
          );
          if (!approved) return { ok: false, detail: "you declined — no file was touched", data: { declined: true } };
          return { ok: true, detail: "plan approved" };
        },
      },
      {
        name: "apply",
        description: "Move the files and journal the manifest",
        risk: "dangerous",
        run: async (ctx) => {
          const plan = ctx.data.plan as OrganizePlan;
          const res = applyOrganizePlan(plan);
          ctx.data.applyResult = res;
          const undoHint = ` — say "undo organize" and I'll reverse it (manifest ${res.manifestId})`;
          if (!res.ok) {
            return {
              ok: res.moved > 0,
              detail: `moved ${res.moved}/${plan.entries.length}${res.failed.length ? `; failures: ${res.failed.slice(0, 3).map((f) => path.basename(f.from)).join(", ")}` : ""}${undoHint}`,
            };
          }
          return { ok: true, detail: `moved ${res.moved} file(s) into ${mode} folders${undoHint}` };
        },
      },
    ],
  };
}

// ─── Quest: morning-brief ────────────────────────────────────────────────────

function buildMorningBriefQuest(params: Record<string, string>): Quest {
  return {
    id: "morning-brief",
    title: "Morning brief: battery, weather, spoken",
    steps: [
      {
        name: "battery",
        description: "Read the battery",
        risk: "safe",
        run: async (ctx) => {
          const r = await batteryStatus();
          ctx.data.battery = r.ok ? r.summary : undefined;
          return r.ok ? { ok: true, detail: r.summary } : { ok: true, skipped: true, detail: r.summary };
        },
      },
      {
        name: "weather",
        description: "Read the weather",
        risk: "safe",
        run: async (ctx) => {
          const place = ctx.params.place?.trim();
          if (!place) return { ok: true, skipped: true, detail: "no place given — add one next time for weather" };
          const r = await weatherRead(place);
          ctx.data.weather = r.ok ? r.summary.slice(0, 300) : undefined;
          return r.ok ? { ok: true, detail: "weather read" } : { ok: true, skipped: true, detail: "weather unavailable" };
        },
      },
      {
        name: "deliver-brief",
        description: "Show the digest and speak it",
        risk: "safe",
        run: async (ctx) => {
          const digest = humanDigest("honest, no filler", ctx);
          ctx.data.digest = digest;
          const said = await ctx.rt.executeTool("speak", { target: "", params: { text: digest } });
          return {
            ok: true,
            detail: `${digest}${said.success ? "" : "\n(couldn't speak it out loud — shown here instead)"}`,
          };
        },
      },
    ],
  };
}

// ─── Quest registry + runner ─────────────────────────────────────────────────

export function buildQuest(kind: string, params: Record<string, string>): { ok: boolean; quest?: Quest; error?: string } {
  switch ((kind ?? "").trim()) {
    case "email-from-website":
    case "email_from_website":
      if (!params.url?.trim()) return { ok: false, error: "which website? I need a URL to pull the contact from" };
      return { ok: true, quest: buildEmailFromWebsiteQuest(params) };
    case "organize-downloads":
    case "organize_files":
      return { ok: true, quest: buildOrganizeQuest(params) };
    case "morning-brief":
      return { ok: true, quest: buildMorningBriefQuest(params) };
    default:
      return { ok: false, error: `unknown quest "${kind}" — known: email-from-website, organize-downloads, morning-brief` };
  }
}

export const QUEST_IDS = ["email-from-website", "organize-downloads", "morning-brief"] as const;

export async function runQuest(
  quest: Quest,
  params: Record<string, string>,
  onProgress?: (update: { step: number; total: number; description: string; status: "running" | "done" | "failed" | "skipped" | "waiting_permission" }) => void
): Promise<QuestResult> {
  const rt = needRuntime();
  const ctx: QuestCtx = {
    params,
    data: {},
    rt,
    emit: () => {},
  };
  const notes: string[] = [];
  let completed = 0;

  // CAP-060 budget: repeat approvals of the SAME title inside THIS quest can
  // be auto-approved up to approvalBudget times — everything else still asks.
  const approvalsSeen = new Map<string, { count: number; auto: number }>();
  const gatedApproval = async (title: string, lines: string[]): Promise<boolean> => {
    const key = title.toLowerCase().trim();
    const rec = approvalsSeen.get(key);
    if (rec) {
      rec.count += 1;
      if (rec.auto < approvalBudget) {
        rec.auto += 1;
        notes.push(`autonomy budget: "${title}" repeated → auto-approved (${rec.auto}/${approvalBudget})`);
        return true;
      }
    } else {
      approvalsSeen.set(key, { count: 1, auto: 0 });
    }
    return rt.requestApproval(title, lines);
  };
  ctx.rt = { ...rt, requestApproval: gatedApproval };

  for (let i = 0; i < quest.steps.length; i++) {
    if (rt.signal?.aborted) {
      emitEvent(quest, i, "cancelled", "task cancelled");
      return {
        ok: false,
        cancelled: true,
        summary: `Cancelled at step ${i + 1}/${quest.steps.length} (${quest.steps[i].name}).`,
        notes,
        stepsCompleted: completed,
        stepsTotal: quest.steps.length,
        failedStep: quest.steps[i].name,
      };
    }
    const step = quest.steps[i];
    ctx.emit = (status, detail) => {
      emitEvent(quest, i, status, detail ?? step.description);
      onProgress?.({
        step: i + 1,
        total: quest.steps.length,
        description: detail ?? step.description,
        status:
          status === "waiting_permission"
            ? "waiting_permission"
            : status === "done"
              ? "done"
              : status === "failed"
                ? "failed"
                : status === "skipped"
                  ? "skipped"
                  : "running",
      });
    };
    ctx.emit("running", step.description);
    try {
      const out = await step.run(ctx);
      if (out.skipped) {
        ctx.emit("skipped", out.detail);
        notes.push(`skipped ${step.name}: ${out.detail}`);
        completed += 1; // a skip counts as processed, not failed
        continue;
      }
      if (!out.ok) {
        // A failing step's data (e.g. {declined:true}) must still reach the
        // quest context — the summary depends on it.
        if (out.data) Object.assign(ctx.data, out.data);
        ctx.emit("failed", out.detail);
        const declinedNow = ctx.data.declined === true;
        // Problem Diary: a real step failure is a problem the user should be
        // able to see and report later. A DECLINE is not a problem — consent
        // working as designed is never recorded as a failure.
        if (!declinedNow) {
          noteProblem({
            source: "quest",
            kind: "quest-step-failed",
            title: `${quest.id} failed at step "${step.name}"`,
            detail: out.detail,
            evidence: [`quest: ${quest.id}`, `step ${i + 1}/${quest.steps.length}: ${step.name}`],
          });
        }
        return {
          ok: false,
          ...(declinedNow ? { cancelled: true } : {}),
          summary: declinedNow ? "Quest stopped — you declined the destructive step. Nothing happened." : `Stopped at "${step.name}" — ${out.detail}`,
          notes: [...notes, `failed ${step.name}: ${out.detail}`],
          stepsCompleted: completed,
          stepsTotal: quest.steps.length,
          failedStep: step.name,
        };
      }
      if (out.data) Object.assign(ctx.data, out.data);
      ctx.emit("done", out.detail);
      notes.push(`${step.name}: ${out.detail}`);
      completed += 1;
    } catch (e: any) {
      const detail = String(e?.message ?? e).slice(0, 200);
      ctx.emit("failed", detail);
      noteProblem({
        source: "quest",
        kind: "quest-step-crashed",
        severity: "high",
        title: `${quest.id} crashed at step "${step.name}"`,
        detail,
        evidence: [`quest: ${quest.id}`, `step ${i + 1}/${quest.steps.length}: ${step.name}`],
      });
      return {
        ok: false,
        summary: `Step "${step.name}" crashed — ${detail}`,
        notes: [...notes, `crashed ${step.name}: ${detail}`],
        stepsCompleted: completed,
        stepsTotal: quest.steps.length,
        failedStep: step.name,
      };
    }
  }

  const declined = ctx.data.declined === true;
  return {
    ok: declined ? false : true,
    cancelled: declined || undefined,
    summary: declined ? "Quest stopped — the send was declined." : `Quest "${quest.title}" finished (${completed}/${quest.steps.length} steps).`,
    notes,
    stepsCompleted: completed,
    stepsTotal: quest.steps.length,
  };
}

function emitEvent(quest: Quest, stepIndex: number, status: QuestStepStatus, detail?: string): void {
  try {
    eventSink?.({
      questId: quest.id,
      questTitle: quest.title,
      stepIndex,
      stepTotal: quest.steps.length,
      stepName: quest.steps[stepIndex]?.name ?? "",
      status,
      detail: detail?.slice(0, 300),
    });
  } catch {
    /* a broken sink must never break a quest */
  }
}

// ─── Routines (user-saved step chains) ───────────────────────────────────────

export type RoutineStep =
  | { kind: "quest"; questId: string; params?: Record<string, string> }
  | { kind: "tool"; action: string; params?: Record<string, string>; target?: string }
  | { kind: "say"; text: string };

export interface Routine {
  id: string;
  name: string;
  steps: RoutineStep[];
  createdAt: number;
  lastRunAt?: number;
  lastRunOk?: boolean;
}

const ROUTINES_CAP = 100; // CAP-081

let routinesDir: string | null = null;

export function configureRoutines(userDataDir: string): void {
  routinesDir = path.join(userDataDir, "routines");
  try {
    fs.mkdirSync(routinesDir, { recursive: true });
  } catch {
    /* load fails soft */
  }
}

function routinesPath(): string {
  if (!routinesDir) throw new Error("Routines not configured — configureRoutines(userDataDir) must run at boot");
  return path.join(routinesDir, "routines.json");
}

function loadRoutines(): Routine[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(routinesPath(), "utf8"));
    return Array.isArray(parsed) ? parsed.slice(0, ROUTINES_CAP) : [];
  } catch {
    return [];
  }
}

function saveRoutines(list: Routine[]): void {
  const tmp = `${routinesPath()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list.slice(0, ROUTINES_CAP), null, 2), "utf8");
  fs.renameSync(tmp, routinesPath());
}

export function saveRoutine(name: string, steps: RoutineStep[]): { ok: boolean; routine?: Routine; error?: string } {
  const cleanName = (name ?? "").trim().toLowerCase();
  if (!cleanName) return { ok: false, error: "the routine needs a name" };
  if (!steps.length) return { ok: false, error: "the routine needs at least one step" };
  const list = loadRoutines();
  const existingIdx = list.findIndex((r) => r.name === cleanName);
  const routine: Routine = {
    id: existingIdx >= 0 ? list[existingIdx].id : `r-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    name: cleanName,
    steps: steps.slice(0, 12),
    createdAt: existingIdx >= 0 ? list[existingIdx].createdAt : Date.now(),
  };
  if (existingIdx >= 0) list[existingIdx] = routine;
  else list.push(routine);
  try {
    saveRoutines(list);
    return { ok: true, routine };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 140) };
  }
}

export function listRoutines(): Routine[] {
  return loadRoutines();
}

export function deleteRoutine(name: string): { ok: boolean; error?: string } {
  const list = loadRoutines();
  const idx = list.findIndex((r) => r.name === name.trim().toLowerCase());
  if (idx === -1) return { ok: false, error: `no routine called "${name}"` };
  list.splice(idx, 1);
  try {
    saveRoutines(list);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 140) };
  }
}

/** Run a saved routine step-by-step through the injected runtime. */
export async function runRoutine(
  name: string,
  onProgress?: (line: string) => void
): Promise<{ ok: boolean; summary: string; results: string[] }> {
  const rt = needRuntime();
  const routine = loadRoutines().find((r) => r.name === name.trim().toLowerCase());
  if (!routine) return { ok: false, summary: `no routine called "${name}"`, results: [] };
  const results: string[] = [];
  let allOk = true;

  for (let i = 0; i < routine.steps.length; i++) {
    if (rt.signal?.aborted) {
      results.push(`cancelled at step ${i + 1}`);
      allOk = false;
      break;
    }
    const step = routine.steps[i];
    const label = `step ${i + 1}/${routine.steps.length}`;
    try {
      if (step.kind === "say") {
        const said = await rt.executeTool("speak", { target: "", params: { text: step.text } });
        results.push(`${label} say: ${said.success ? "spoken" : said.output}`);
        if (!said.success) allOk = false;
      } else if (step.kind === "quest") {
        const built = buildQuest(step.questId, step.params ?? {});
        if (!built.ok || !built.quest) {
          results.push(`${label} quest: ${built.error}`);
          noteProblem({ source: "routine", kind: "routine-quest-build-failed", title: `routine "${routine.name}" — quest "${step.questId}" failed to build`, detail: built.error });
          allOk = false;
          continue;
        }
        const res = await runQuest(built.quest, step.params ?? {});
        results.push(`${label} quest ${step.questId}: ${res.summary}`);
        if (!res.ok) allOk = false;
      } else {
        const res = await rt.executeTool(step.action, { target: step.target ?? "", params: step.params ?? {} });
        results.push(`${label} ${step.action}: ${res.output.slice(0, 160)}`);
        if (!res.success) allOk = false;
      }
      onProgress?.(results[results.length - 1]);
    } catch (e: any) {
      const detail = String(e?.message ?? e).slice(0, 140);
      results.push(`${label} failed: ${detail}`);
      noteProblem({
        source: "routine",
        kind: "routine-step-crashed",
        title: `routine "${routine.name}" — step ${i + 1} crashed`,
        detail,
      });
      allOk = false;
    }
  }

  routine.lastRunAt = Date.now();
  routine.lastRunOk = allOk;
  try {
    const list = loadRoutines();
    const idx = list.findIndex((r) => r.id === routine.id);
    if (idx !== -1) {
      list[idx] = routine;
      saveRoutines(list);
    }
  } catch {
    /* bookkeeping only */
  }

  return {
    ok: allOk,
    summary: `Routine "${routine.name}" ${allOk ? "finished" : "finished with failures"} (${routine.steps.length} step(s)).`,
    results,
  };
}
