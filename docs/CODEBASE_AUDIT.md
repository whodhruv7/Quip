# Quip — Codebase Audit (overnight engineering run)

> Method: full read of `electron/` (main, engine, brains, brain, system, actions) and `src/` (App, all components/hooks/lib), IPC cross-check, static scans, build + 425 tests green at baseline. Every finding below carries file:line evidence. Anything unverifiable is marked **UNVERIFIED**.

**Baseline:** commit `ae6b1ab`, `npm run build` ✓ (2.8s), `npm test` 425 pass / 0 fail, Node 20 sandbox (Linux — runtime Electron GUI verification limited to headless boot smoke; Windows-only paths marked as such).

---

## A. Architecture as-built (verified)

- **Boot:** `main.ts:2044` single-instance lock → `whenReady`: `ensureQuipShortcut` (fire-and-forget), `initDeviceIndex` (fire-and-forget), execution-log persist path, `await bootstrap(...)` (main.ts:2066) → store profile/worldModel → spatial compute/watch → timeline/dream/swarm/weekly/proactive init → journal load → **`createWindow(companion)` + tray (main.ts:2174–2175)** → delayed health probes (2195) → 15s self-heal loop (2207).
- **Windows:** ONE BrowserWindow factory (main.ts:654–699), transparent 132×176 sprite, 4 modes (`setWindowMode` main.ts:348–397): companion / panel / full / fullscreen. Extra companions via `swarmManager` same factory (headless spawns = registry-only).
- **Execution spine (LIVE path):** `IPC.TASK_EXECUTE` (main.ts:1102) → `brain/hub.ts processCommand` → **direct** plans → `actions/engine.ts` (verified executor, recovery, execution-log) — **or** agent/chat → `engine/orchestrator.ts` → `agent-loop.ts` + `engine/tool-registry.ts` (45+ tools incl. desktop-controller, screen-vision, browser-automation, file-ops, web-reading).
- **Chat spine:** `CHAT_SEND` (main.ts:~960–1090) → buildSystemPrompt (memory/KG/DNA/mood/timeline) → `modelRouter.stream` → SSE chunks → renderer.
- **Provider chain:** QUIP_PRIMARY_PROVIDER → groq→gemini→cerebras→nvidia→openrouter→ollama (env-store.ts:22), per-provider model fallback, circuit breaker (2 fails → 30s→10min park; 429 Retry-After respected), timeouts 60s/12s/25s, net.fetch→node fetch transport fallback. Keys: cwd/.env → appPath/.env → userData/.env (userData wins), never logged, Settings writes userData/.env live.
- **Persistence:** userData/*.json — memory (200 cap + decay), execution log (ring 250), connections (ring 80), screenshots (last 8), chat (renderer localStorage 60×21 sessions). **Unbounded: knowledge-graph.json, timeline.json** (§B4).
- **Security posture:** contextIsolation on, nodeIntegration off, sandbox false (needed for preload surface), deny-list tool filter (tool-registry.ts:66–74), approval gate for risky steps.

## B. Findings (each verified by read; severity = impact × likelihood)

### B1. First launch: device scan blocks the first window (severity: HIGH — startup UX/reliability)
- Evidence: `createWindow` runs only **after** `await bootstrap(...)` (main.ts:2066→2174); on first run `ensureProfile` finds no `device-profile.json` and runs the full Windows scan (device-brain.ts:555–566) before any window exists.
- Also: `BOOTSTRAP_PROGRESS` is broadcast via `broadcastToRenderers` (main.ts:2039) while the windows map is **empty** → the first-run scan animation (ScanOverlay) can never be seen on the very first launch.
- User-visible symptom: double-click → nothing for tens of seconds on first run → looks exactly like "app khul tak nhi rha".
- Fix strategy: create the companion window **before/parallel to** bootstrap (renderer shows ScanOverlay while main finishes), flush buffered progress events once a window exists; keep boot fail-soft.
- Verification: instrument stage timestamps; simulate empty profile dir; assert window visible < ~2s and progress events received.

### B2. `CHAT_SEND` builds the system prompt OUTSIDE its try block (HIGH — error UX/reliability)
- Evidence: `buildSystemPrompt` at main.ts:964 sits before the try; a throw (memory/KG/DNA/mood read) rejects the invoke with no `CHAT_ERROR` → renderer shows unhandled failure instead of the styled error bubble.
- Fix: wrap prompt construction in the same guarded section; emit CHAT_ERROR with honest reason.
- Verification: targeted test stubbing a throwing brain; assert renderer receives CHAT_ERROR.

### B3. Deterministic orchestrator path has NO timeout (HIGH — task engine hang)
- Evidence: `orchestrator.executeWithRetry` (orchestrator.ts:503–524) has no timeout wrapper; `searchYouTubeResults` fetch (browser-automation.ts:228–231) and legacy scrape (legacy-tools.ts:116) have no AbortSignal → a hung network call stalls the task (and its state) indefinitely.
- Fix: per-step deadline wrapper on the deterministic path (reuse Action Engine step timeout), AbortSignal on scrapes.
- Verification: unit test with a hanging fetch mock; task must fail honestly within budget.

### B4. Unbounded growth + synchronous whole-file writes: knowledge-graph.json, timeline.json (MEDIUM — perf/storage)
- Evidence: knowledge-graph.ts:91–96 `writeFileSync` on every upsert/link, entities/links never trimmed; timeline-brain.ts:47 writeFileSync per event, `logEvent` pushes forever.
- Fix: cap + prune (importance/recency), debounce writes, keep ring bounds like execution-log.
- Verification: soak test N upserts → file size bounded; boot read time bounded.

### B5. §42 violation: WeeklyReflection fabricates data (MEDIUM-HIGH — trust)
- Evidence: WeeklyReflection.tsx:14–24 fakes "executed 14 tasks, completed 3 major coding sessions, 2 hours" after 1.5s; comment admits it. Feedback buttons call nothing though `recordReflectionFeedback` exists (preload.ts:320–325) and real data exists (`getWeeklyDigest`, execution-log, connection-journal).
- Fix: render REAL digest from `getWeeklyDigest`/action log; honest empty state; wire feedback buttons; theme-tokenize (it also ignores themes entirely — bg-white/90 etc.).
- Verification: component renders zero-fake text; empty state when log empty; feedback persists.

### B6. First-run ScanOverlay can fake "done" before bootstrap finishes (MEDIUM — trust/startup)
- Evidence: ScanOverlay.tsx:36–39 — 1.2s fallback marks first-run scanned regardless of real bootstrap completion.
- Fix: drive completion from the real `bootstrap done` event (with generous timeout); combined with B1 the progress events will actually arrive.
- Verification: slow-scan simulation → overlay stays until real done; fast scan → no fake delay.

### B7. Permission modes: full backend, ZERO UI (MEDIUM-HIGH — product gap)
- Evidence: engine/permission-modes.ts (Safe/Medium/Dangerous machine, live gate) + IPC `quip:get|set|cycle-permission-mode` (main.ts:1299–1314) + preload get/set/cycle (preload.ts:81–86) — but **no renderer call site anywhere** (grep clean). Mega-spec §29 expects mode-aware permission UX.
- Fix: add a Permissions card in Settings (Desktop or AI tab): 3 modes with explanation + persisted indicator; approval panel already exists for per-step asks.
- Verification: UI switch → IPC → gate behavior changes (e.g. Dangerous requires approval in Safe mode, auto-runs in Dangerous mode) → mode survives restart.

### B8. Battery telemetry hardcoded → dead features (LOW-MEDIUM — honesty)
- Evidence: environment-brain.ts:33–62 `snapshot()` returns `battery.supported:false, level:1, charging:true` always; low-battery prompt section (main.ts:482–488) and `proactiveEngine.checkBatteryCritical` (main.ts:2153) can never fire.
- Fix: real Windows battery read (PowerShell WMI) cached 60s, honest unsupported fallback.
- Verification: on AC → charging true; sandbox/Linux → honest unsupported (no fake).

### B9. Dead / duplicated systems (MEDIUM — coherence, §36)
- `brains/task-brain.ts` (542) + `tool-executor.ts` (265) + `capability-registry.ts` (399): legacy parse→plan→execute pipeline. Only lifeline = unused `runTask` import (main.ts:89 — verified sole occurrence). Loads at boot, never executes. **Fix: remove import; delete trio (tests referencing them updated); keep capability data that's still unique inside intent-parser-v2.**
- `engine/window-policy.ts`: test-only orphan → delete with its test (or promote; not used by product).
- `IPC.SWARM_BROADCAST` (shared.ts:130): declared, never used → remove.
- Unused imports: `loadProfile` (main.ts:83), `summarizeJournal` (main.ts:74).
- Duplicate risk tables ×3 (system/permission-system.ts:27–46, engine/permission-modes.ts:32–98, actions/contracts.ts:40–58) → single source in actions/contracts, others reference.
- Two YouTube search impls (tool-executor.ts:51–80 dies with B9 trio; browser-automation.ts:226–241 remains).
- Renderer dead hooks: `useKeyboard.ts`, `useDeviceProfile.ts`, `useSpatialLayout.ts` (imported nowhere) → delete (Esc-to-full is already handled in App.tsx:135–142).
- Dead renderer API surface (exposed, never called): swarm set, knowledge-graph set, weekly set (weekly becomes live with B5), permission set (becomes live with B7), workspace context, DNA, connection journal, action log, dismissProactive, env-change listener. **Decision: keep (they are the vision's HUD surface) but mark; remove only true never-planned ones.**
- Dead CSS: `.quip-glass .quip-skeleton .quip-note .quip-card-quiet .quip-input .quip-accent-text .quip-chip .quip-row-btn` (index.css) → remove or adopt.
- Two theme storage keys (storage.ts QuipPrefs.theme stale union vs `quip-theme`) → single key.
- Stale comments: CompanionSwitch.tsx:3 "all 3 companions" (6), Companion.tsx:1 "Ivy"→skales.

### B10. Boot health probe churn + wrong transport (LOW-MEDIUM)
- Evidence: main.ts:2195–2198 serially probes every provider via plain Node fetch (no proxy support) + `runModelAutoHealth` — up to ~60s background churn, false "network" failures behind proxies.
- Fix: single combined probe via router's transport (net.fetch path), parallel with tighter deadlines (≤8s), delay to 6s, cache result for Doctor.
- Verification: probe duration bounded; Doctor reflects same result source.

### B11. Renderer hardcoded colors bypassing theme tokens (MEDIUM — UX polish)
- Evidence: WeeklyReflection (whole file, light-only classes — broken on default violet), TopBar pill (#22c55e/#ef4444) + speaking bars (#f59e0b), ChatMessage badge (#16a34a/#dc2626), ChatWelcome greens/ambers, ConfirmModal gradient, ActionApprovalPanel palette, SettingsPanel toggle knobs (#fff) + depth bars hardcode Pix colors for all 6 companions (1889, 2010).
- Fix: route through `--quip-ok/--quip-warn/--quip-bad/--chrome-*`; depth bars take active companion colors.
- Verification: visual pass across all 10 themes × light/dark chrome.

### B12. Companion micro-gaps (LOW — polish)
- Kai/Ren accept `eyeOffset` but ignore it (Companion.tsx:158/203) → 2 of 6 don't track cursor.
- `sleeping` state unreachable (types/chat.ts:7, App.tsx:252–274 never yields it) → wire idle-timeout sleep or remove.
- `outcomeFlash` pose can stick past 2s (App.tsx:244–251, no re-render timer).
- Fullscreen mode ~110-line near-duplicate of full (App.tsx:834–939) → parameterize one FullLayout.

### B13. Settings robustness (LOW)
- Unguarded async: refreshMemory/handleForget/handlePin (SettingsPanel.tsx:398–411), handleResetDNA (:426–431) → add try/catch + honest error state.
- Dark-flag dead ternary SettingsPanel.tsx:1440.

### B14. Misc reliability (LOW)
- `RESCAN_DEVICE` allows unbounded concurrent full rescans (main.ts:1411–1423) → single-flight guard.
- ChatLayout auto-scroll uses 150ms setInterval while busy (ChatLayout.tsx:67–73) → event-based.
- `.quip-skeleton` exists but unused; loading states could adopt it (chat history load).

### B15. Windows-only paths UNVERIFIED in sandbox (explicit)
- desktop-shortcut.ts (.lnk via PowerShell), screen-vision PowerShell capture, system-control (volume/brightness), msedge-tts network voice, real provider endpoints. All code-reviewed only; runtime verification requires Windows. Marked in CAPABILITY_MAP accordingly.
- Headless Linux boot smoke performed (§D); full GUI lifecycle test requires a display.

## C. IPC contract audit
- ~60 channels declared; 55+ handlers registered; preload 1:1 with handlers for used surface.
- Dead: `IPC.SWARM_BROADCAST`. Off-registry literals: `quip:set-companion`, `quip:get|set|cycle-permission-mode`, `quip:approval-resolve`, swarm's raw `quip:auto-task` / `quip:inter-companion-msg` → **move into shared.ts registry** (single source of truth).
- `main/scripts/ipc-audit.cjs` exists as a static checker → keep as CI gate; extend with preload↔renderer usage diff.

## D. Baseline runtime verification
- Build ✓ (tsc electron + vite renderer), tests 425/0.
- Headless boot smoke: `xvfb-run electron .` — see FINAL_TEST_REPORT for result and timing.
- Repeated launch/close/reopen cycles: see FINAL_TEST_REPORT.

## E. Fix order adopted (dependency-aware)
1. **P0 startup/reliability:** B1 (+B6), B2, B3.
2. **P1 architecture coherence:** B9 (dead trio + registry literals + unused imports), B4 (bounded stores), B10 (probe), B8 (battery).
3. **P1 product:** B7 (permission UI), B5 (weekly real data).
4. **P2 UX polish:** B11 tokens, B12 companion gaps, B13, B14.
5. Backlog items beyond this session: see docs/BACKLOG.md (400+ tasks).
