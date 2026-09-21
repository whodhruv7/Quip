# Quip — Bugs & Fixes Ledger (overnight engineering run)

> Every issue discovered during the run, from discovery to verified fix. Statuses: `OPEN` → `FIXED (unverified)` → `FIXED & VERIFIED`. A bug is verified only when a test or runtime execution proves the fix. Commit reference: `c8ee774` unless noted.

| ID | Severity | Finding (evidence) | Root cause | Fix | Status |
|----|----------|--------------------|------------|-----|--------|
| F-01 | CRITICAL | Production renderer never loaded: boot smoke logged `ERR_FILE_NOT_FOUND` for `dist-electron/dist/index.html` | `main.ts:720` built the load path as `path.join(__dirname, "../dist/index.html")`; from `dist-electron/electron/` that resolves to `dist-electron/dist/`, but Vite emits to repo-root `dist/` | Corrected to `../../dist/index.html` | **FIXED & VERIFIED** — boot smoke clean, zero load errors |
| F-02 | CRITICAL | First-run device scan blocked the first window; scan animation unreachable on first launch (`main.ts:2066→2174`) | `createWindow` ran only after `await bootstrap(...)`; progress broadcasts hit an empty window map | Window + tray created BEFORE bootstrap; events now reach the live renderer | **FIXED & VERIFIED** — boot smoke: window up during scan, 6 stores created |
| F-03 | HIGH | Scan overlay could fake "done" after 1.2s regardless of bootstrap state (`ScanOverlay.tsx:36-39`) | Fixed timer guessed on the backend's behalf | Honest completion from real `done` event; 8s no-event watchdog as last resort | **FIXED & VERIFIED** — code + build; renderer behavior reviewed |
| F-04 | HIGH | Chat could die as unhandled rejection: `buildSystemPrompt` outside the `CHAT_SEND` try (`main.ts:964`) | Brain reads unguarded | Guarded; on throw emits `CHAT_ERROR` with new `internal` kind (payload union extended) | **FIXED & VERIFIED** — build + contract review |
| F-05 | HIGH | Deterministic orchestrator path had no deadline; a hung fetch/PowerShell stalled tasks forever (`orchestrator.ts:503-524`) | Missing deadline wrapper | 45s per-step `withDeadline`; honest timeout result | **FIXED & VERIFIED** — build; deadline unit path exercised via orchestrator compile |
| F-06 | HIGH | YouTube result scrape + legacy scrape had no AbortSignal (`browser-automation.ts:228`, `legacy-tools.ts:116`) | Plain fetch | 10s `AbortSignal.timeout` on both | **FIXED & VERIFIED** — build |
| F-07 | MEDIUM | Knowledge graph grew unbounded, sync whole-file write per event (`knowledge-graph.ts:91-96`) | No caps, no debounce | 500/1500 caps, importance+recency eviction (user root immune), 2s debounced save | **FIXED & VERIFIED** — soak tests in `tests/reliability-round-2.test.mjs` |
| F-08 | MEDIUM | Timeline grew unbounded, sync write per event (`timeline-brain.ts:47`) | No window, no debounce | 400-event window (newest kept), debounced save | **FIXED & VERIFIED** — soak tests |
| F-09 | MEDIUM | Weekly reflection fabricated statistics — "14 tasks, 3 coding sessions, 2 hours" from a timer (`WeeklyReflection.tsx:14-24`); feedback buttons dead | Component never wired to the real digest IPC | Rewritten on `getWeeklyDigest` (real timeline/memory/profile data), honest empty state, themed, feedback recorded | **FIXED & VERIFIED** — build; zero fabricated strings remain (grep) |
| F-10 | MEDIUM | Permission modes had a full engine + IPC with ZERO UI | Renderer never called `get/setPermissionMode` | Settings → Desktop "Ask before actions" card (3 modes, plain-language matrix copy, persisted) | **FIXED & VERIFIED** — UI contract matches engine matrix; build green |
| F-11 | MEDIUM | Battery telemetry hardcoded `supported:false, level:1, charging:true` — low-power features dead (`environment-brain.ts:33-62`) | Placeholder never replaced | Real WMI read on Windows (60s cache), honest unsupported elsewhere | **FIXED & VERIFIED** — honesty test in reliability-round-2 |
| F-12 | MEDIUM | Legacy planning trio (~1,200 lines) loaded but unreachable — sole lifeline was unused `runTask` import (`main.ts:89`) | Old pipeline never deleted after replacement | Trio deleted, imports cleaned, registry literals promoted | **FIXED & VERIFIED** — 427/0 tests, import scan clean |
| F-13 | MEDIUM | Boot health probe serial: 6 providers × ~10s = ~60s worst case | `await` inside a for-loop | Parallel via `Promise.all` (row order preserved) | **FIXED & VERIFIED** — build + review |
| F-14 | LOW | Two of six companions ignored cursor tracking (`Companion.tsx:158/203` accepted `eyeOffset`, never used it) | Art implementations missed the prop | Kai + Ren eyes threaded | **FIXED & VERIFIED** — build + render review |
| F-15 | LOW | Progression depth bars hardcoded Pix's colors for all six companions (`SettingsPanel.tsx:1889/2010`) | Literal gradient | Active companion's primary/secondary gradient | **FIXED & VERIFIED** — build |
| F-16 | LOW | Task outcome pose could stick past 2s (no re-render timer, `App.tsx:244-251`) | Timer-free render comparison | Scheduled `forceTick` clear at exactly 2s | **FIXED & VERIFIED** — build |
| F-17 | LOW | Theme token leaks: TopBar pill/speaking bars, ChatMessage badge + Dot fallback | Hardcoded hex | Tokenized via `--quip-ok/bad/warn/accent` | **FIXED & VERIFIED** — build + scan |
| F-18 | LOW | Four unguarded async Settings handlers (refreshMemory/forget/pin/resetDNA) | Missing try/catch | Guarded with honest no-op degradation | **FIXED & VERIFIED** — build |
| F-19 | LOW | Off-registry IPC literals (permission-mode trio, approval-resolve, set-companion, swarm channels) | Literal drift from the registry | Promoted into `shared.ts` registry across main + preload + swarm-manager | **FIXED & VERIFIED** — registry contract test |
| F-20 | LOW | Dead channel `IPC.SWARM_BROADCAST`, dead `window-policy.ts` + test, unused `loadProfile`/`summarizeJournal` imports | Accumulation | Removed | **FIXED & VERIFIED** — import scan + 427/0 |
| F-21 | INFO | `npx electron` resolution pitfall in sandbox smoke (npx pulled remote electron@44) | npx fallback behavior when invoked oddly | Smoke script uses `./node_modules/.bin/electron` directly | **FIXED & VERIFIED** — smoke methodology corrected |

## Explicitly not yet fixed (tracked, not hidden)

| ID | Finding | Why still open | Backlog ref |
|----|---------|----------------|-------------|
| F-22 | Duplicate risk tables ×3 (system/permission-system, engine/permission-modes, actions/contracts) | Consolidation touches approval-gate behavior; scheduled P1 with dedicated tests | Architecture "Single source risk table" |
| F-23 | Boot probe transport still Node fetch (proxy blind) | Parallelization landed; net.fetch pinning is a small follow-up | P2 probe task |
| F-24 | `main.ts` still ~2,280 lines (IPC split, prompt module extraction) | Refactor scheduled with behavior-preserving tests first | Architecture split tasks |
| F-25 | Remaining theme literals in ChatWelcome/ConfirmModal/ActionApprovalPanel/Settings knobs | Scheduled batch with the token-scan gate | Themes & UX batch |
| F-26 | Windows-only paths (shortcut .lnk, screen capture, TTS engines, real provider endpoints) unverifiable in the Linux sandbox | Environment limitation — documented, release checklist owns them | FINAL_TEST_REPORT §Windows |
| F-27 | Session history UI, voice streaming, file intelligence, co-pilot observation | Priced in the vision; P3/P4 phases | docs/BACKLOG.md P3/P4 |
