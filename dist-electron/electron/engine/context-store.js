"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.contextStore = void 0;
const TTL_MS = 30 * 60 * 1000; // 30 minutes
let state = { updatedAt: 0 };
exports.contextStore = {
    get() {
        exports.contextStore.clearExpired();
        return { ...state };
    },
    update(patch) {
        state = { ...state, ...patch, updatedAt: Date.now() };
        return { ...state };
    },
    clearExpired(now = Date.now()) {
        if (state.updatedAt && now - state.updatedAt > TTL_MS) {
            state = { updatedAt: 0 };
        }
    },
    /** Compact summary for the model prompt — a single short line, not a dump. */
    summary() {
        exports.contextStore.clearExpired();
        const parts = [];
        if (state.activeApp)
            parts.push(`app=${state.activeApp}`);
        if (state.activeWebsite)
            parts.push(`site=${state.activeWebsite}`);
        if (state.lastMediaQuery)
            parts.push(`lastMedia="${state.lastMediaQuery}"`);
        if (state.lastOpenedPath)
            parts.push(`lastPath=${state.lastOpenedPath}`);
        if (state.lastSelectedEntity)
            parts.push(`selected="${state.lastSelectedEntity}"`);
        return parts.length ? `Current context: ${parts.join(", ")}` : "";
    },
    /** Test/refresh helper. */
    reset() {
        state = { updatedAt: 0 };
    },
};
//# sourceMappingURL=context-store.js.map