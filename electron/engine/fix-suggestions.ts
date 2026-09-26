// Quip Fix Suggestions — plain-language "here's how this gets solved" map
// ─────────────────────────────────────────────────────────────────────────────
// Every failed task is recorded in the Problem Diary. This module turns the
// raw failure text into an actionable fix the user can act on immediately —
// shown inline in the chat ("Fix: …") and attached to diary entries.
// Pure function: no fs, no electron, fully unit-tested.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map failure texts to concrete, deduped, actionable fixes.
 * One failure class per regex — ordered so the most specific advice wins.
 */
export function suggestFor(failures: string[]): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    if (!out.includes(s)) out.push(s);
  };
  for (const f of failures) {
    const t = String(f ?? "").toLowerCase();
    if (/app (list|index)|start menu|scan failed|powershell/.test(t)) {
      push('The app list failed to load — say "rescan apps" and try again.');
    }
    if (/couldn't find an installed app|no start menu|app not found/.test(t)) {
      push('Check the app\'s exact name in the Start Menu, then say "open <name>" again. Or ask "what apps are installed?".');
    }
    if (/couldn't find (a |the )?(file|folder)|no matching (file|folder)|isn't on disk anymore/.test(t)) {
      push('Try a more specific name, or tell me the folder: "open resume.pdf in Downloads".');
    }
    if (/path missing|path-missing|moved or was deleted/.test(t)) {
      push("The file moved or was deleted — check the Recycle Bin or your OneDrive folder.");
    }
    if (/timeout|timed out|slow/.test(t)) {
      push("The system was slow to respond — one retry usually clears this.");
    }
    if (/no provider|no-key|api key|unauthorized|401/.test(t)) {
      push("Add your AI key in Settings → AI Setup, then try again.");
    }
    if (/permission|not approved|approval|declined/.test(t)) {
      push("Approve the action card when it appears (you have 60s), or switch permission mode in Settings.");
    }
    if (/open-file-failed|no application|associate/.test(t)) {
      push("Windows has no default app for this file type — right-click the file → Open with → choose an app.");
    }
    if (/cancelled/.test(t)) {
      push("The task was stopped on request — send it again whenever you're ready.");
    }
    if (/network|fetch|econn|enotfound|dns/.test(t)) {
      push("The network dropped mid-task — check the connection and retry.");
    }
  }
  return out;
}

/** Build a compact suggested prompt for the user to retry a failed intent. */
export function suggestedRetryPrompt(command: string, failures: string[]): string | null {
  const t = failures.map((f) => String(f ?? "").toLowerCase()).join(" ");
  if (/couldn't find an installed app|app not found/.test(t)) {
    const m = command.match(/open\s+(.+)/i);
    return m ? `Try: "open ${m[1].trim().split(/\s+/)[0]}" with the app's exact Start Menu name.` : null;
  }
  if (/couldn't find (a |the )?(file|folder)/.test(t)) {
    return 'Try: "open <file name> in <folder>" — e.g. "open resume.pdf in Documents".';
  }
  if (/permission|declined|approval/.test(t)) {
    return 'Say it again and tap Allow on the action card — or switch Quip to "auto-approve" in Settings.';
  }
  if (/timeout|timed out/.test(t)) {
    return `Just send it once more: "${command}". The first try probably warmed things up.`;
  }
  return null;
}
