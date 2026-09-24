// Quip Execution Engine — Short-Term Execution Context
// ─────────────────────────────────────────────────────────────────────────────
// Remembers what Quip just did so follow-up commands work naturally:
//   "Open YouTube"      → activeWebsite = youtube
//   "search mitwa"      → lastMediaQuery = mitwa
//   "play it"           → resolves query from lastMediaQuery (no repeat needed)
//   "open my quip project" then "open that folder in vscode"
//
// Cheap, in-memory, expires after 30 minutes of inactivity.
// Never sent wholesale to the model — only a compact summary line.
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionContextState {
  activeApp?: string;
  activeWebsite?: string;
  activeUrl?: string;
  lastMediaQuery?: string;
  lastOpenedPath?: string;
  lastSelectedEntity?: string;
  /** Text of the last page the agent read — lets "summarize that" work. */
  lastReadPage?: string;
  /** Comma-separated emails from the last ghost extraction — lets "email him" work. */
  lastExtractedEmails?: string;
  /** Pending file/folder choices — powers the follow-up flow
   *  ("I found 3 resumes — open the first one?" → "open the second one"). */
  pendingChoices?: PendingChoice[];
  /** The search query that produced the pending choices ("search again"). */
  pendingQuery?: string;
  /** What kind of search produced them. */
  pendingKind?: "file" | "folder" | "any";
  updatedAt: number;
}

export interface PendingChoice {
  label: string;
  path: string;
  kind: "file" | "folder" | "project";
}

const TTL_MS = 30 * 60 * 1000; // 30 minutes

let state: ExecutionContextState = { updatedAt: 0 };

export const contextStore = {
  get(): ExecutionContextState {
    contextStore.clearExpired();
    return { ...state };
  },

  update(patch: Partial<ExecutionContextState>): ExecutionContextState {
    state = { ...state, ...patch, updatedAt: Date.now() };
    return { ...state };
  },

  clearExpired(now: number = Date.now()): void {
    if (state.updatedAt && now - state.updatedAt > TTL_MS) {
      state = { updatedAt: 0 };
    }
  },

  /** Compact summary for the model prompt — a single short line, not a dump. */
  summary(): string {
    contextStore.clearExpired();
    const parts: string[] = [];
    if (state.activeApp) parts.push(`app=${state.activeApp}`);
    if (state.activeWebsite) parts.push(`site=${state.activeWebsite}`);
    if (state.lastMediaQuery) parts.push(`lastMedia="${state.lastMediaQuery}"`);
    if (state.lastOpenedPath) parts.push(`lastPath=${state.lastOpenedPath}`);
    if (state.lastSelectedEntity) parts.push(`selected="${state.lastSelectedEntity}"`);
    if (state.lastReadPage) parts.push(`lastRead=${state.lastReadPage.length} chars`);
    if (state.lastExtractedEmails) parts.push(`emails=${state.lastExtractedEmails.slice(0, 60)}`);
    if (state.pendingChoices && state.pendingChoices.length > 0) {
      parts.push(`pendingChoices=${state.pendingChoices.length} (user may say "open it" / "open the second one")`);
    }
    return parts.length ? `Current context: ${parts.join(", ")}` : "";
  },

  /** Test/refresh helper. */
  reset(): void {
    state = { updatedAt: 0 };
  },
};
