// Quip Care Routines — the companion that looks after YOU
// ─────────────────────────────────────────────────────────────────────────────
// Time-to-time themed reminders with their own little sounds: drink water,
// rest the eyes (20-20-20), fix the posture, long screen-time nudge. Each
// kind has its own interval and its own copy bank (Hinglish-friendly, like
// the rest of Quip).
//
// Design rules:
//  • Pure core (testable): due-time computation, quiet hours, coalescing.
//  • The scheduler NEVER fires during quiet hours (23:00–07:30) — care is
//    care, not 3 AM spam. Overdue kinds fire right after quiet hours end.
//  • At most ONE reminder every COOLDOWN ms — they queue, never stack.
//  • Fails soft: a broken reminder must never break the app.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Pure core ───────────────────────────────────────────────────────────────

export type CareKind = "hydrate" | "eye_rest" | "posture" | "screen_time";

export interface CareConfig {
  hydrateMs: number;
  eyeRestMs: number;
  postureMs: number;
  screenTimeMs: number;
}

export const DEFAULT_CARE_CONFIG: CareConfig = {
  hydrateMs: 45 * 60_000,      // water every ~45 min
  eyeRestMs: 60 * 60_000,      // 20-20-20 every hour
  postureMs: 90 * 60_000,      // stretch every 1.5 h
  screenTimeMs: 120 * 60_000,  // screen-time nudge every 2 h
};

/** Min gap between ANY two reminders so they never stack. */
export const CARE_COOLDOWN_MS = 10 * 60_000;

/** Quiet hours: no reminders between 23:00 and 07:30 local time. */
export function inQuietHours(now: Date): boolean {
  const h = now.getHours();
  const m = now.getMinutes();
  const minutes = h * 60 + m;
  return minutes >= 23 * 60 || minutes < 7 * 60 + 30;
}

export interface CareState {
  lastFiredAt: Record<CareKind, number>;
  /** Session start — screen_time counts from here. */
  sessionStart: number;
  lastAnyAt: number;
}

export function freshCareState(now: number): CareState {
  return {
    lastFiredAt: { hydrate: 0, eye_rest: 0, posture: 0, screen_time: 0 },
    sessionStart: now,
    lastAnyAt: 0,
  };
}

export interface CareDue {
  kind: CareKind;
  overdueMs: number;
}

/**
 * Which care kind is most overdue right now (or null)? One at a time, most
 * overdue first, respecting the global cooldown and quiet hours.
 */
export function pickDueCare(
  state: CareState,
  config: CareConfig,
  now: number,
  nowDate: Date
): CareDue | null {
  if (inQuietHours(nowDate)) return null;
  if (now - state.lastAnyAt < CARE_COOLDOWN_MS) return null;
  const intervals: Record<CareKind, number> = {
    hydrate: config.hydrateMs,
    eye_rest: config.eyeRestMs,
    posture: config.postureMs,
    screen_time: config.screenTimeMs,
  };
  let best: CareDue | null = null;
  for (const kind of Object.keys(intervals) as CareKind[]) {
    // A kind that never fired anchors at session start — a fresh session gets
    // one full interval of grace before its first reminder (never "you haven't
    // drunk water since 1970").
    const anchor = Math.max(state.lastFiredAt[kind], state.sessionStart);
    const dueAt = anchor + intervals[kind];
    if (now >= dueAt) {
      const overdueMs = now - dueAt;
      if (!best || overdueMs > best.overdueMs) best = { kind, overdueMs };
    }
  }
  return best;
}

/** Advance state after a fired reminder. */
export function advanceCare(state: CareState, kind: CareKind, now: number): CareState {
  return {
    ...state,
    lastFiredAt: { ...state.lastFiredAt, [kind]: now },
    lastAnyAt: now,
  };
}

// ─── Copy banks (3 variants each — varied voice, Hinglish-friendly) ─────────

const COPY: Record<CareKind, { title: string; lines: string[]; sound: CareEventSound }> = {
  hydrate: {
    title: "Paani break 💧",
    sound: "hydrate",
    lines: [
      "Thoda paani pi lo — Quip will keep the tabs warm.",
      "Your brain is 73% water. Refill it, boss.",
      "Chhoti si hydration break? Aap ke liye ek glass paani ka wait hai.",
    ],
  },
  eye_rest: {
    title: "Aankhon ko aaram 👀",
    sound: "eye",
    lines: [
      "20-20-20: look 20 feet away for 20 seconds. Screens are not eyes' best friends.",
      "Blink… blink… ah, better. Ek minute door dekho.",
      "Eyes check! Door ka kuch dekho — 20 seconds. Main yahin hoon.",
    ],
  },
  posture: {
    title: "Stretch thoda 🧘",
    sound: "posture",
    lines: [
      "Kamar seedhi, kandhe relaxed — ek deep breath le lo.",
      "Roll those shoulders once. Aap ka back aap se request kar raha hai.",
      "Stand up for 30 seconds? Blood flow = better ideas.",
    ],
  },
  screen_time: {
    title: "Screen se door zara ☀️",
    sound: "screen",
    lines: [
      "It's been a while on screen — 2 minute walk? Quip sambhal lega.",
      "Long session! Ek chhoti break — chai? stretch? khidki se bahar?",
      "You've been at it for hours. Zara door dekho, you've earned the view.",
    ],
  },
};

type CareEventSound = "hydrate" | "eye" | "posture" | "screen";

/** Pick a copy line, varying by occurrence so it never feels canned. */
export function careCopy(kind: CareKind, occurrence: number): { title: string; body: string; sound: CareEventSound } {
  const bank = COPY[kind];
  const line = bank.lines[Math.abs(occurrence) % bank.lines.length];
  return { title: bank.title, body: line, sound: bank.sound };
}

// ─── Scheduler (main-process side) ───────────────────────────────────────────

export type CareSink = (event: { kind: CareKind; title: string; body: string; sound: CareEventSound }) => void;

let timer: ReturnType<typeof setInterval> | null = null;
let state = freshCareState(Date.now());
let occurrenceCounter = 0;
let sink: CareSink | null = null;

export function configureCareRoutines(fn: CareSink | null): void {
  sink = fn;
}

/** Test hook: replace the internal state. */
export function resetCareState(now: number): void {
  state = freshCareState(now);
  occurrenceCounter = 0;
}

export function startCareRoutines(tickMs = 60_000): void {
  if (timer) return;
  timer = setInterval(() => {
    try {
      const now = Date.now();
      const due = pickDueCare(state, DEFAULT_CARE_CONFIG, now, new Date(now));
      if (!due) return;
      const copy = careCopy(due.kind, occurrenceCounter++);
      state = advanceCare(state, due.kind, now);
      sink?.({ kind: due.kind, ...copy });
    } catch {
      /* care must never crash the app */
    }
  }, tickMs);
}

export function stopCareRoutines(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
