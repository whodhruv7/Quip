// Quip V2 — PROACTIVE ENGINE (Phase 2)
// -----------------------------------------------------------------------------
// Quip's proactive intelligence layer. Instead of ONLY reacting to user input,
// Quip now NOTICES things and proactively suggests helpful actions.
//
// Monitors:
//   - Memory pressure (high RAM usage via process.memoryUsage())
//   - Late night working (user active after 11pm)
//   - Battery critical (< 15%, not charging)
//   - Long session (working 3+ hours without a break)
//   - Weekly reflection trigger (7+ days since last sync)
//   - Cute check-ins (greetings, hydration, encouragement — quiet-hours aware,
//     shuffle-bag rotation so messages never repeat back-to-back)
//
// Architecture:
//   - Debounced per-trigger to avoid spam (each trigger has a cooldown)
//   - Emits typed ProactiveSuggestion events via a listener set
//   - Main process subscribes and forwards to renderer via IPC
// -----------------------------------------------------------------------------

export type ProactiveTrigger =
  | "ram_pressure"
  | "late_night"
  | "battery_critical"
  | "long_session"
  | "weekly_reflection"
  | "cute_checkin";

export interface ProactiveSuggestion {
  trigger: ProactiveTrigger;
  message: string;       // User-facing message for Quip to say
  actionLabel?: string;  // Optional CTA label (e.g. "Turn on Dark Mode")
  actionId?: string;     // Optional action ID the renderer can handle
  timestamp: number;
}

/** Persisted settings shape (userData/quip-proactive.json). */
export interface ProactivePersistedState {
  enabled: boolean;
  lastFired: Partial<Record<ProactiveTrigger, number>>;
}

/** Injectable persistence so the engine stays testable without Electron. */
export interface ProactivePersistence {
  load(): ProactivePersistedState | null;
  save(state: ProactivePersistedState): void;
}

type SuggestionListener = (s: ProactiveSuggestion) => void;

// Cooldown per trigger — prevents repeated firing
const TRIGGER_COOLDOWNS_MS: Record<ProactiveTrigger, number> = {
  ram_pressure:       30 * 60 * 1000, // 30 min
  late_night:         60 * 60 * 1000, // 1 hour
  battery_critical:   15 * 60 * 1000, // 15 min
  long_session:       60 * 60 * 1000, // 1 hour
  weekly_reflection:   7 * 24 * 60 * 60 * 1000, // 7 days
  cute_checkin:       45 * 60 * 1000, // 45 min
};

const RAM_PRESSURE_THRESHOLD_MB = 400; // Warn if heap > 400MB
const BATTERY_CRITICAL_THRESHOLD = 0.15;
const LATE_NIGHT_HOUR_START = 23;
const LATE_NIGHT_HOUR_END = 5;
const LONG_SESSION_MS = 3 * 60 * 60 * 1000; // 3 hours

// Cute check-ins fire at most every 45 minutes and NEVER during quiet hours.
// The pool rotates with a shuffle bag — no message repeats until the whole
// pool has been seen.
const CUTE_CHECKIN_COOLDOWN_MS = 45 * 60 * 1000;
const CUTE_CHECKINS: string[] = [
  "Heyy 👋 Ready when you are.",
  "Need any help? I'm right here.",
  "Don't forget to drink some water 💧",
  "You've been working for a while 😭 Stretch your back a little?",
  "Psst — small breaks make big ideas ✨",
  "Just checking in — everything okay? 🌷",
  "I believe in you. What are we building next? 💪",
  "Eyes off the screen for 20 seconds — look at something far away 👀",
  "If you need anything opened, found or fixed — just say the word 😌",
  "That project of yours is going to be great. Keep going 🚀",
];

class ProactiveEngine {
  private listeners = new Set<SuggestionListener>();
  private lastFired = new Map<ProactiveTrigger, number>();
  private sessionStartMs = Date.now();
  private timer: NodeJS.Timeout | null = null;
  /** Settings toggle — "Let Quip check in on me". Battery warnings stay on. */
  private enabled = true;
  private persistence: ProactivePersistence | null = null;
  private saveTimer: NodeJS.Timeout | null = null;

  /** Wire persistence (userData JSON). Restores cooldowns + the toggle so a
   *  restart cannot reset them (no "fires right after every relaunch"). */
  configure(persistence: ProactivePersistence): void {
    this.persistence = persistence;
    const state = persistence.load();
    if (state) {
      if (typeof state.enabled === "boolean") this.enabled = state.enabled;
      if (state.lastFired) {
        for (const [k, v] of Object.entries(state.lastFired)) {
          if (typeof v === "number") this.lastFired.set(k as ProactiveTrigger, v);
        }
      }
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(value: boolean): void {
    this.enabled = value === true;
    this.persist();
  }

  private persist(): void {
    if (!this.persistence) return;
    // Debounced — fire() can burst.
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        this.persistence!.save({
          enabled: this.enabled,
          lastFired: Object.fromEntries(this.lastFired.entries()),
        });
      } catch {
        /* best effort */
      }
    }, 500);
  }

  start(): void {
    if (this.timer) return;
    this.sessionStartMs = Date.now();
    // Check every 2 minutes
    this.timer = setInterval(() => this.runChecks(), 2 * 60 * 1000);
    // Also run once after 30s delay (let app finish starting)
    setTimeout(() => this.runChecks(), 30_000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  subscribe(listener: SuggestionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Manually check if a weekly reflection is due (called on startup). */
  checkWeeklyReflection(lastReflectionMs: number): void {
    const since = Date.now() - lastReflectionMs;
    if (since >= TRIGGER_COOLDOWNS_MS.weekly_reflection) {
      this.fire({
        trigger: "weekly_reflection",
        message: "Hey! It's been a week since we last synced. Want a quick recap of what we've accomplished together? 🗂️",
        actionLabel: "Show Reflection",
        actionId: "open_reflection",
        timestamp: Date.now(),
      });
    }
  }

  private runChecks(): void {
    this.checkRamPressure();
    this.checkLateNight();
    this.checkLongSession();
    this.checkCuteCheckIn();
    // Battery check is done from environment brain subscription (see main.ts)
  }

  checkBatteryCritical(level: number, charging: boolean): void {
    if (!charging && level < BATTERY_CRITICAL_THRESHOLD) {
      this.fire({
        trigger: "battery_critical",
        message: `⚠️ Battery at ${Math.round(level * 100)}%! You should plug in soon — losing power could interrupt what we're working on.`,
        actionLabel: "Got it",
        timestamp: Date.now(),
      });
    }
  }

  private checkRamPressure(): void {
    const heapMB = process.memoryUsage().heapUsed / 1024 / 1024;
    if (heapMB > RAM_PRESSURE_THRESHOLD_MB) {
      this.fire({
        trigger: "ram_pressure",
        message: `Memory is looking tight (${Math.round(heapMB)}MB used). I can help clear some space — want me to prune old memories or close unused apps?`,
        actionLabel: "Prune Memories",
        actionId: "prune_memories",
        timestamp: Date.now(),
      });
    }
  }

  private checkLateNight(): void {
    const hour = new Date().getHours();
    const isLateNight = hour >= LATE_NIGHT_HOUR_START || hour < LATE_NIGHT_HOUR_END;
    if (isLateNight) {
      this.fire({
        trigger: "late_night",
        message: "Hey, it's getting late 🌙 You've been grinding — maybe time to wrap up? I can set a reminder for tomorrow morning if you want.",
        actionLabel: "Set Reminder",
        actionId: "set_morning_reminder",
        timestamp: Date.now(),
      });
    }
  }

  private checkLongSession(): void {
    const sessionDuration = Date.now() - this.sessionStartMs;
    if (sessionDuration >= LONG_SESSION_MS) {
      this.fire({
        trigger: "long_session",
        message: `You've been working for ${Math.round(sessionDuration / 3600000)} hours straight 💪 Don't forget to take a break — even 5 mins helps focus.`,
        timestamp: Date.now(),
      });
    }
  }

  // ─── Cute check-ins (the companion being a companion) ────────────────────
  private cuteBag: string[] = [];

  private checkCuteCheckIn(): void {
    const hour = new Date().getHours();
    const quietHours = hour >= LATE_NIGHT_HOUR_START || hour < LATE_NIGHT_HOUR_END;
    if (quietHours) return; // never nudge someone sleeping

    const last = this.lastFired.get("cute_checkin") ?? 0;
    if (Date.now() - last < CUTE_CHECKIN_COOLDOWN_MS) return;
    // Give the session a calm start — no check-ins in the first 5 minutes.
    if (Date.now() - this.sessionStartMs < 5 * 60 * 1000) return;

    if (this.cuteBag.length === 0) {
      this.cuteBag = [...CUTE_CHECKINS].sort(() => Math.random() - 0.5);
    }
    const message = this.cuteBag.pop()!;
    this.fire({
      trigger: "cute_checkin",
      message,
      timestamp: Date.now(),
    });
  }

  private fire(suggestion: ProactiveSuggestion): void {
    // The settings toggle gates every nudge EXCEPT critical battery —
    // that one protects unsaved work, not cuteness.
    if (!this.enabled && suggestion.trigger !== "battery_critical") return;
    const last = this.lastFired.get(suggestion.trigger) ?? 0;
    const cooldown = TRIGGER_COOLDOWNS_MS[suggestion.trigger];
    if (Date.now() - last < cooldown) return; // Still in cooldown

    this.lastFired.set(suggestion.trigger, Date.now());
    this.persist();
    this.listeners.forEach((l) => l(suggestion));
  }
}

export const proactiveEngine = new ProactiveEngine();
