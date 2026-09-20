// Quip — in-app repository updater ("Fetch Updates" button).
// ─────────────────────────────────────────────────────────────────────────────
// The user's laptop runs Quip from its project folder, so updates are just
// git: fetch origin → count what's new → pull --ff-only. Every failure is
// HONEST: not-a-repo, no git, network down, local changes blocking — each
// gets a plain-language reason, never a fake "updated".
// Pure helpers are exported for tests; the IPC handler in main.ts calls
// fetchUpdates() which spawns the real git binary.
// ─────────────────────────────────────────────────────────────────────────────

import { execFile } from "node:child_process";

export interface UpdateResult {
  ok: boolean;
  /** Commits the repo was behind before the pull. */
  behind: number;
  /** True when a pull actually brought new code. */
  pulled: boolean;
  message: string;
}

function git(
  repoPath: string,
  args: string[],
  timeoutMs = 45_000
): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", repoPath, ...args],
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          out: String(stdout ?? ""),
          err: String((error as any)?.message ?? stderr ?? ""),
        });
      }
    );
  });
}

/** Pure: how many commits HEAD is behind (lines in `rev-list` output). */
export function parseBehindCount(revListOutput: string): number {
  return revListOutput
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean).length;
}

/** Pure: a plain-language message from the pieces (single source for UI copy). */
export function updateMessage(behind: number, pulled: boolean): string {
  if (pulled) {
    return `Updated — ${behind} new commit${behind === 1 ? "" : "s"} fetched. Restart Quip to run the new version.`;
  }
  if (behind > 0) {
    return `Found ${behind} new commit${behind === 1 ? "" : "s"}, but I couldn't apply them (see the note).`;
  }
  return "You're already on the latest version.";
}

/**
 * Fetch + apply updates for the repo at `repoPath`.
 * Never throws — every outcome comes back as an honest UpdateResult.
 */
export async function fetchUpdates(repoPath: string): Promise<UpdateResult> {
  // Is this even a git repo?
  const top = await git(repoPath, ["rev-parse", "--is-inside-work-tree"], 10_000);
  if (!top.ok) {
    return {
      ok: false,
      behind: 0,
      pulled: false,
      message:
        "Updates only work when Quip runs from its project folder (that one isn't a git repo). Run Quip via run-quip.cmd.",
    };
  }

  // Network: fetch origin (fail honestly — offline is not "up to date").
  const branch = await git(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"], 10_000);
  const head = (branch.out || "main").trim() || "main";
  const fetch = await git(repoPath, ["fetch", "origin", "--quiet"]);
  if (!fetch.ok) {
    return {
      ok: false,
      behind: 0,
      pulled: false,
      message: `I couldn't reach GitHub to check for updates — ${fetch.err.split("\n")[0]?.slice(0, 140) || "network failed"}.`,
    };
  }

  const behindOut = await git(repoPath, ["rev-list", "--count", `HEAD..origin/${head}`], 15_000);
  if (!behindOut.ok) {
    return {
      ok: false,
      behind: 0,
      pulled: false,
      message: `I fetched the repo but couldn't compare versions — ${behindOut.err.split("\n")[0]?.slice(0, 140) || "git failed"}.`,
    };
  }
  const behind = parseBehindCount(behindOut.out);
  if (behind === 0) {
    return { ok: true, behind: 0, pulled: false, message: updateMessage(0, false) };
  }

  // Local changes would block a fast-forward — report them instead of failing mysteriously.
  const dirty = await git(repoPath, ["status", "--porcelain"], 15_000);
  if (dirty.out.trim().length > 0) {
    const files = dirty.out.trim().split("\n").slice(0, 3).map((l) => l.slice(3).trim());
    return {
      ok: false,
      behind,
      pulled: false,
      message: `Found ${behind} new commit${behind === 1 ? "" : "s"}, but local changes block the update: ${files.join(", ")}. Save or revert them, then try again.`,
    };
  }

  const pull = await git(repoPath, ["pull", "--ff-only", "origin", head, "--quiet"]);
  if (!pull.ok) {
    return {
      ok: false,
      behind,
      pulled: false,
      message: `Found ${behind} new commit${behind === 1 ? "" : "s"} but the pull failed — ${pull.err.split("\n")[0]?.slice(0, 140) || "git refused"}.`,
    };
  }
  return { ok: true, behind, pulled: true, message: updateMessage(behind, true) };
}
