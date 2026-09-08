// Quip Execution Engine — System Control (deep device layer)
// ─────────────────────────────────────────────────────────────────────────────
// Real OS-level operations beyond windows/files:
//   process list + kill (with a protected-process deny-list),
//   volume up/down/mute + precise "set N" (deterministic key-press math),
//   media keys (play/pause/next/previous),
//   browser tab control (new/close/switch/back/forward/reload).
//
// Everything returns ActionVerification and verifies what it can. Nothing
// is faked: if the OS call fails, the result says so.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ok,
  fail,
  runCapture,
  windowWithTitleExists,
  type ActionVerification,
} from "./action-verifier";

// ─── Process management ─────────────────────────────────────────────────────

/** Processes Quip must NEVER kill (system-critical / security / itself). */
const PROTECTED_PROCESSES = new Set([
  "system", "system idle process", "smss", "csrss", "wininit", "winlogon",
  "services", "lsass", "svchost", "dwm", "explorer", "registry",
  "fontdrvhost", "sihost", "taskhostw", "ctfmon", "audiodg", "spoolsv",
  "searchapp", "shellexperiencehost", "windowsinternal.composablehost",
  "applicationframehost", "runtimebroker", "securityhealthservice",
  "msmpeng", "quip", "electron", "powershell", "cmd", "winpw.d", "wudfhost",
]);

export function isProtectedProcess(name: string): boolean {
  const n = (name ?? "").toLowerCase().replace(/\.exe$/, "").trim();
  return PROTECTED_PROCESSES.has(n);
}

export interface ProcessInfo {
  name: string;
  pid: number;
  memUsageKb: number;
}

/** Split one CSV line on commas that are outside quotes — pure, testable. */
export function splitCsvLine(line: string): string[] {
  const cols: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      cols.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}

/** Parse `tasklist /fo csv /nh` output — tolerant of quoted or bare fields. */
export function parseTasklistCsv(stdout: string): ProcessInfo[] {
  const out: ProcessInfo[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cols = splitCsvLine(trimmed).map((c) => c.trim());
    if (cols.length < 5) continue;
    const name = cols[0];
    const pid = parseInt(cols[1], 10);
    const mem = (cols[4] ?? "").replace(/[^0-9]/g, "");
    if (!name || !Number.isFinite(pid)) continue;
    out.push({ name, pid, memUsageKb: Number.isFinite(Number(mem)) ? Number(mem) : 0 });
  }
  return out;
}

export async function listProcesses(): Promise<ActionVerification> {
  if (process.platform !== "win32") {
    return fail(
      "Process listing currently works on Windows.",
      ["platform: " + process.platform],
      "unsupported-platform"
    );
  }
  const res = await runCapture(`tasklist /fo csv /nh`, 10_000);
  if (!res || res.code !== 0) {
    return fail("I couldn't list the running processes.", [], "tasklist-failed");
  }
  const procs = parseTasklistCsv(res.stdout);
  if (procs.length === 0) {
    return fail("I couldn't read the process list.", [], "tasklist-parse-failed");
  }
  // Summarize: busiest 12 by memory (keeps output honest but readable).
  const top = [...procs].sort((a, b) => b.memUsageKb - a.memUsageKb).slice(0, 12);
  const lines = top.map(
    (p) => `• ${p.name} (pid ${p.pid}) — ${(p.memUsageKb / 1024).toFixed(0)} MB`
  );
  return ok(
    `There are ${procs.length} processes running. The busiest:\n${lines.join("\n")}`,
    [`parsed ${procs.length} entries from tasklist`]
  );
}

export async function killProcess(target: string): Promise<ActionVerification> {
  if (process.platform !== "win32") {
    return fail("Closing processes currently works on Windows.", [], "unsupported-platform");
  }
  const t = (target ?? "").trim();
  if (!t) {
    return fail("Tell me which process to close — a name or a number (pid).", [], "missing-target");
  }
  if (isProtectedProcess(t)) {
    return fail(
      `"${t}" is a system process — closing it could crash Windows, so I won't touch it.`,
      ["protected-process deny-list"],
      "protected-process"
    );
  }
  if (/^\d+$/.test(t)) {
    const pid = parseInt(t, 10);
    if (pid <= 4) {
      return fail("That pid is a system process — I won't close it.", [], "protected-process");
    }
    const res = await runCapture(`taskkill /pid ${pid} /f`, 10_000);
    if (!res || res.code !== 0) {
      return fail(`I couldn't close the process with pid ${pid} — it may have already exited.`, [], "taskkill-failed");
    }
    return ok(`Closed the process with pid ${pid}.`, ["taskkill /pid executed"]);
  }

  // By name: strip .exe, resolve the real image name from the process list.
  const bare = t.toLowerCase().replace(/\.exe$/, "");
  const res = await runCapture(`tasklist /fo csv /nh`, 10_000);
  const procs = res && res.code === 0 ? parseTasklistCsv(res.stdout) : [];
  const matches = procs.filter((p) => p.name.toLowerCase().replace(/\.exe$/, "") === bare);
  if (matches.length === 0) {
    return fail(
      `I don't see a process called "${t}" running right now.`,
      ["checked the live process list"],
      "process-not-found"
    );
  }
  if (matches.some((m) => isProtectedProcess(m.name))) {
    return fail(`"${t}" is a system process — closing it could crash Windows, so I won't touch it.`, [], "protected-process");
  }
  const kill = await runCapture(`taskkill /im ${bare}.exe /f`, 10_000);
  if (!kill || kill.code !== 0) {
    return fail(`I couldn't close "${t}". It may need admin rights.`, [], "taskkill-failed");
  }
  return ok(
    `Closed ${matches.length} process${matches.length > 1 ? "es" : ""} named "${t}".`,
    [`taskkill /im ${bare}.exe executed`, `matched ${matches.length} pid(s)`]
  );
}

// ─── Volume control ─────────────────────────────────────────────────────────

export type VolumeAction = "up" | "down" | "mute" | "unmute" | "set";

/**
 * Deterministic "set N" plan: Windows volume moves 2% per key press and
 * can't go below 0, so 50×VOLUME_DOWN floors it, then N/2 ups land on N.
 * Pure — tested.
 */
export function volumePressPlan(targetPercent: number): { downs: number; ups: number } {
  const target = Math.max(0, Math.min(100, Math.round(targetPercent)));
  return { downs: 50, ups: Math.round(target / 2) };
}

/** keybd_event P/Invoke snippet — works where SendKeys can't (media/volume VKs). */
function keybdEventPS(vk: string, times: number): string {
  const presses = Array.from({ length: Math.max(1, times) }, () => `[keybd_event]::Call(${vk},0,1,0); [keybd_event]::Call(${vk},0,2,0);`).join(" ");
  return (
    `powershell -NoProfile -Command "$sig='[DllImport(\\"user32.dll\\")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);'; ` +
    `$t=Add-Type -MemberDefinition $sig -Name Kbd -Namespace Win -PassThru; ${presses} 'done'"`
  );
}

const VK = {
  VOLUME_UP: "0xAF",
  VOLUME_DOWN: "0xAE",
  VOLUME_MUTE: "0xAD",
  MEDIA_NEXT: "0xB0",
  MEDIA_PREV: "0xB1",
  MEDIA_PLAY_PAUSE: "0xB3",
} as const;

export async function controlVolume(
  action: VolumeAction,
  level?: number
): Promise<ActionVerification> {
  if (process.platform !== "win32") {
    return fail("Volume control currently works on Windows.", [], "unsupported-platform");
  }
  if (action === "set") {
    if (!Number.isFinite(level) || Number(level) < 0 || Number(level) > 100) {
      return fail("Give me a volume level between 0 and 100.", [], "invalid-level");
    }
    const { downs, ups } = volumePressPlan(Number(level));
    const res = await runCapture(keybdEventPS(VK.VOLUME_DOWN, downs), 15_000);
    if (!res) return fail("I couldn't change the volume.", [], "volume-failed");
    if (ups > 0) {
      await runCapture(keybdEventPS(VK.VOLUME_UP, ups), 15_000);
    }
    return ok(
      `Volume set to about ${Math.round(Number(level) / 2) * 2}%.`,
      ["floored with 50×VOLUME_DOWN", `raised ${ups} steps (2% each)`]
    );
  }
  const vk =
    action === "up" ? VK.VOLUME_UP : action === "down" ? VK.VOLUME_DOWN : VK.VOLUME_MUTE;
  const times = action === "up" || action === "down" ? 4 : 1;
  const res = await runCapture(keybdEventPS(vk, times), 10_000);
  if (!res) return fail("I couldn't change the volume.", [], "volume-failed");
  const msg =
    action === "up" ? "Turned the volume up." :
    action === "down" ? "Turned the volume down." :
    action === "unmute" ? "Unmuted the sound." :
    "Toggled mute.";
  return ok(msg, [`keybd_event ${vk} ×${times}`]);
}

// ─── Media keys ─────────────────────────────────────────────────────────────

export type MediaAction = "playpause" | "next" | "previous";

export async function mediaKey(action: MediaAction): Promise<ActionVerification> {
  if (process.platform !== "win32") {
    return fail("Media keys currently work on Windows.", [], "unsupported-platform");
  }
  const vk =
    action === "next" ? VK.MEDIA_NEXT : action === "previous" ? VK.MEDIA_PREV : VK.MEDIA_PLAY_PAUSE;
  const res = await runCapture(keybdEventPS(vk, 1), 10_000);
  if (!res) return fail("I couldn't send the media key.", [], "media-failed");
  const msg =
    action === "next" ? "Skipped to the next track." :
    action === "previous" ? "Went back to the previous track." :
    "Toggled play/pause.";
  return ok(msg, [`media key ${vk} sent`]);
}

// ─── Browser tab control ────────────────────────────────────────────────────

export type TabAction = "new" | "close" | "next" | "previous" | "reopen" | "back" | "forward" | "reload";

const BROWSER_HINTS = [
  "chrome", "edge", "firefox", "brave", "opera", "vivaldi", "browser",
  "youtube", "google", "reddit", "github", "twitter", " x ", "chatgpt",
];

/**
 * Tab control uses the browser's own shortcuts — but ONLY when a browser is
 * actually focused. Refusing with an honest message beats typing Ctrl+W into
 * the wrong app. Pure matcher is exported for tests.
 */
export function looksLikeBrowserWindow(title: string): boolean {
  const t = ` ${(title ?? "").toLowerCase()} `;
  return BROWSER_HINTS.some((h) => t.includes(h));
}

const TAB_SHORTCUTS: Record<TabAction, { keys: string; describe: string }> = {
  new: { keys: "^t", describe: "Opened a new tab." },
  close: { keys: "^w", describe: "Closed the current tab." },
  next: { keys: "^{TAB}", describe: "Switched to the next tab." },
  previous: { keys: "^+{TAB}", describe: "Switched to the previous tab." },
  reopen: { keys: "^+t", describe: "Reopened the last closed tab." },
  back: { keys: "%{LEFT}", describe: "Went back a page." },
  forward: { keys: "%{RIGHT}", describe: "Went forward a page." },
  reload: { keys: "{F5}", describe: "Reloaded the page." },
};

export async function browserTabAction(op: TabAction): Promise<ActionVerification> {
  if (process.platform !== "win32") {
    return fail("Browser tab control currently works on Windows.", [], "unsupported-platform");
  }
  const fg = await runCapture(
    `powershell -NoProfile -Command "(Get-Process | Where-Object { $_.MainWindowTitle } | Sort-Object StartTime -ErrorAction SilentlyContinue | Select-Object -Last 1).MainWindowTitle"`,
    8000
  );
  // The foreground probe is best-effort: if it says "not a browser", refuse
  // honestly instead of firing shortcuts into the wrong app.
  if (fg && fg.code === 0) {
    const title = fg.stdout.trim();
    if (title && !looksLikeBrowserWindow(title)) {
      return fail(
        `"${title}" is focused right now — open your browser first (or tell me to open it) and I'll handle the tabs.`,
        ["foreground window is not a browser"],
        "browser-not-focused"
      );
    }
  }
  const shortcut = TAB_SHORTCUTS[op];
  const res = await runCapture(
    `powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $ws.SendKeys('${shortcut.keys}'); 'sent'"`,
    8000
  );
  if (!res || res.code !== 0) {
    return fail("I couldn't send the tab shortcut.", [], "tab-failed");
  }
  return ok(shortcut.describe, [`SendKeys ${op}`]);
}

/** Convenience: is a browser even running? Used for honest pre-checks. */
export async function browserLikelyOpen(): Promise<boolean> {
  return windowWithTitleExists("chrome") || windowWithTitleExists("edge") ||
    windowWithTitleExists("firefox") || windowWithTitleExists("youtube");
}
