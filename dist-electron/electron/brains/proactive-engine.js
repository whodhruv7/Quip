"use strict";
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
//
// Architecture:
//   - Debounced per-trigger to avoid spam (each trigger has a cooldown)
//   - Emits typed ProactiveSuggestion events via a listener set
//   - Main process subscribes and forwards to renderer via IPC
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.proactiveEngine = void 0;
// Cooldown per trigger — prevents repeated firing
const TRIGGER_COOLDOWNS_MS = {
    ram_pressure: 30 * 60 * 1000, // 30 min
    late_night: 60 * 60 * 1000, // 1 hour
    battery_critical: 15 * 60 * 1000, // 15 min
    long_session: 60 * 60 * 1000, // 1 hour
    weekly_reflection: 7 * 24 * 60 * 60 * 1000, // 7 days
};
const RAM_PRESSURE_THRESHOLD_MB = 400; // Warn if heap > 400MB
const BATTERY_CRITICAL_THRESHOLD = 0.15;
const LATE_NIGHT_HOUR_START = 23;
const LATE_NIGHT_HOUR_END = 5;
const LONG_SESSION_MS = 3 * 60 * 60 * 1000; // 3 hours
class ProactiveEngine {
    listeners = new Set();
    lastFired = new Map();
    sessionStartMs = Date.now();
    timer = null;
    start() {
        if (this.timer)
            return;
        this.sessionStartMs = Date.now();
        // Check every 2 minutes
        this.timer = setInterval(() => this.runChecks(), 2 * 60 * 1000);
        // Also run once after 30s delay (let app finish starting)
        setTimeout(() => this.runChecks(), 30_000);
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    /** Manually check if a weekly reflection is due (called on startup). */
    checkWeeklyReflection(lastReflectionMs) {
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
    runChecks() {
        this.checkRamPressure();
        this.checkLateNight();
        this.checkLongSession();
        // Battery check is done from environment brain subscription (see main.ts)
    }
    checkBatteryCritical(level, charging) {
        if (!charging && level < BATTERY_CRITICAL_THRESHOLD) {
            this.fire({
                trigger: "battery_critical",
                message: `⚠️ Battery at ${Math.round(level * 100)}%! You should plug in soon — losing power could interrupt what we're working on.`,
                actionLabel: "Got it",
                timestamp: Date.now(),
            });
        }
    }
    checkRamPressure() {
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
    checkLateNight() {
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
    checkLongSession() {
        const sessionDuration = Date.now() - this.sessionStartMs;
        if (sessionDuration >= LONG_SESSION_MS) {
            this.fire({
                trigger: "long_session",
                message: `You've been working for ${Math.round(sessionDuration / 3600000)} hours straight 💪 Don't forget to take a break — even 5 mins helps focus.`,
                timestamp: Date.now(),
            });
        }
    }
    fire(suggestion) {
        const last = this.lastFired.get(suggestion.trigger) ?? 0;
        const cooldown = TRIGGER_COOLDOWNS_MS[suggestion.trigger];
        if (Date.now() - last < cooldown)
            return; // Still in cooldown
        this.lastFired.set(suggestion.trigger, Date.now());
        this.listeners.forEach((l) => l(suggestion));
    }
}
exports.proactiveEngine = new ProactiveEngine();
//# sourceMappingURL=proactive-engine.js.map