// Quip App Watcher — notices when the user opens something new
// ─────────────────────────────────────────────────────────────────────────────
// Polls the foreground window; when a NEW app stays in front for two
// consecutive probes, Quip gently asks "need any help?" — with an Open
// button so tapping the notice focuses that app. Carefully rate-limited and
// suppressed while Quip itself is acting (Ghost Cursor active, task running,
// or Quip just focused a window itself) — an assistant that nags is worse
// than no assistant.
//
// Pure decision core (unit-tested) + a soft polling loop. Fails soft always.
// ─────────────────────────────────────────────────────────────────────────────

import { getForegroundWindowTitle } from "./action-verifier";
import { ghostActiveUntil } from "./ghost-cursor";
import {
  appNameFromTitle,
  isQuipTitle,
  shouldAsk,
  ASK_COOLDOWN_MS,
  STABILITY_MS,
  type WatchDecision,
  type WatchVerdict,
} from "./app-watcher-core";

// Re-export the pure core so consumers (and tests) have a single surface.
export {
  appNameFromTitle,
  isQuipTitle,
  shouldAsk,
  ASK_COOLDOWN_MS,
  STABILITY_MS,
  type WatchDecision,
  type WatchVerdict,
} from "./app-watcher-core";

// ─── Polling loop (main-process side) ────────────────────────────────────────

export type AppNoticeSink = (notice: { appName: string; title: string; timestamp: number }) => void;
export type ActingProbe = () => boolean;

let timer: ReturnType<typeof setInterval> | null = null;
let sink: AppNoticeSink | null = null;
let enabled = true;
let pollInFlight = false;
let prevAppName = "";
let lastAppName = "";
let lastAskAt = 0;
let lastChangeAt = 0;
let sawChange = false;

export function configureAppWatcher(fn: AppNoticeSink | null): void {
  sink = fn;
}

export function setAppNoticeEnabled(v: boolean): void {
  enabled = v;
}

/** The renderer (or main) marks Quip-busy windows so we never interrupt. */
export function startAppWatcher(pollMs = 6000, actingProbe?: ActingProbe): void {
  if (timer) return;
  lastChangeAt = Date.now();
  timer = setInterval(async () => {
    if (pollInFlight) return;
    pollInFlight = true;
    try {
      const title = (await getForegroundWindowTitle()) ?? "";
      const now = Date.now();
      const appName = appNameFromTitle(title);
      if (appName !== prevAppName) {
        prevAppName = appName;
        sawChange = true;
        lastChangeAt = now;
      }
      if (!sawChange) return;
      const actingNow =
        (actingProbe?.() ?? false) || now < ghostActiveUntil() || now < lastChangeAt + STABILITY_MS;
      const verdict = shouldAsk({
        prevAppName,
        newTitle: title,
        lastAppName,
        lastAskAt,
        lastChangeAt,
        actingNow,
        enabled,
        now,
      });
      if (!verdict.ask) return;
      lastAppName = appName;
      lastAskAt = now;
      sink?.({ appName: verdict.appName, title: title.slice(0, 120), timestamp: now });
    } catch {
      /* probing failures are silently ignored — cosmetic feature */
    } finally {
      pollInFlight = false;
    }
  }, pollMs);
}

export function stopAppWatcher(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Test hook. */
export function resetAppWatcher(): void {
  prevAppName = "";
  lastAppName = "";
  lastAskAt = 0;
  lastChangeAt = Date.now();
  sawChange = false;
}
