// Quip App Watcher — pure decision core (no Electron imports; unit-tested
// directly). The polling loop in app-watcher.ts builds on these rules.

/** Quip's own window titles never count as "the user opened an app". */
export function isQuipTitle(title: string): boolean {
  const t = (title ?? "").toLowerCase();
  if (!t.trim()) return true; // an empty foreground is not a user action
  return t.includes("quip");
}

/**
 * Reduce a raw window title to a stable app name: drop the trailing
 * " - Document / - Site / — Mode" decorations most apps append.
 */
export function appNameFromTitle(title: string): string {
  const t = (title ?? "").trim();
  if (!t) return "";
  // Common separators: " - " (chrome/edge/vscode/explorer), " — " (em-dash), " | " (some shells)
  const cut = t.split(/\s+[—|]\s+|\s+-\s+/)[0].trim();
  return (cut || t).slice(0, 48);
}

export interface WatchDecision {
  prevAppName: string;
  newTitle: string;
  lastAppName: string;
  lastAskAt: number;
  lastChangeAt: number;
  actingNow: boolean;
  enabled: boolean;
  now: number;
}

export interface WatchVerdict {
  ask: boolean;
  appName: string;
}

/** One ask per app per session; ≥5 min between asks; app must be stable. */
export const ASK_COOLDOWN_MS = 5 * 60_000;
/** The new app must hold the foreground this long before we speak. */
export const STABILITY_MS = 9_000;

export function shouldAsk(d: WatchDecision): WatchVerdict {
  const appName = appNameFromTitle(d.newTitle);
  if (!d.enabled) return { ask: false, appName };
  if (d.actingNow) return { ask: false, appName };
  if (isQuipTitle(d.newTitle)) return { ask: false, appName };
  if (!appName) return { ask: false, appName };
  if (appNameFromTitle(d.prevAppName) === appName || appNameFromTitle(d.lastAppName) === appName) {
    // same app as before (or the one we already asked about) — no ask
    return { ask: false, appName };
  }
  if (d.now - d.lastAskAt < ASK_COOLDOWN_MS) return { ask: false, appName };
  if (d.now - d.lastChangeAt < STABILITY_MS) return { ask: false, appName };
  return { ask: true, appName };
}
