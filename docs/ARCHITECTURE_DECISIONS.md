# Quip — Architecture Decisions (overnight engineering run)

> Each decision: context → decision → rationale → consequences. Companion documents: docs/MASTER-FUTURE-VISION.pdf (direction), docs/CODEBASE_AUDIT.md (evidence), docs/BACKLOG.md (execution), docs/BUGS_AND_FIXES.md (lifecycle).

## ADR-001: The window is created before bootstrap, not after
- **Context:** First launch ran a full device scan before any window existed; the user saw nothing for tens of seconds (the exact "app khul tak nhi rha" report), and the scan-progress events fired into an empty window map so the scan overlay could never be seen.
- **Decision:** `createWindow(defaultCompanionId)` + `createTray()` execute immediately on `whenReady`; `await bootstrap(...)` follows; progress flows to the live renderer.
- **Rationale:** Presence is the product. A companion that makes you wait is a widget you close. The scan is the only honest excuse for first-run latency and it must therefore be *visible*.
- **Consequences:** The renderer must tolerate a not-yet-ready backend (it already did — fail-soft stages); bootstrap errors cannot kill the window (they never could — the whole call was wrapped).

## ADR-002: Production loads the renderer from repo-root `dist/`
- **Context:** Boot smoke exposed `ERR_FILE_NOT_FOUND` for `dist-electron/dist/index.html`: the production `loadFile` path joined `__dirname` (dist-electron/electron) with `../dist`, but Vite emits to repo-root `dist/`. Production mode silently rendered nothing — the white-screen class of the startup bug family.
- **Decision:** `path.join(__dirname, "../../dist/index.html")`.
- **Rationale:** Correctness beats cleverness; the path is now annotated in-source so the next refactor cannot silently undo it.
- **Consequences:** `npm run build` + `npm start` and the `run-quip.cmd` launcher now render the real UI. Dev mode is untouched (vite server URL path).

## ADR-003: The scan overlay completes on truth, never on a timer
- **Context:** A 1.2s fallback marked first-run "scanned" while the backend was still scanning — a small lie that trains users to distrust progress indicators.
- **Decision:** Overlay closes on the backend's real `done` flag; an 8s zero-event watchdog is the only fallback (dead-pipeline case).
- **Rationale:** §42 NEVER FAKE SUCCESS applies to progress UI as much as to task results.
- **Consequences:** First-run overlay duration now matches the real scan; a truly stuck backend still dismisses instead of hanging forever.

## ADR-004: One planning pipeline (the legacy trio is deleted, not quarantined)
- **Context:** `brains/task-brain.ts` + `tool-executor.ts` + `capability-registry.ts` (~1,200 lines) replicated the live parse→plan→execute pipeline. Their only lifeline was one unused import. Loaded on every boot, executed never.
- **Decision:** Delete the trio, remove the import, re-point tests. Deleted rather than parked behind a flag.
- **Rationale:** Quarantines are attics; attics fill. A second engine invites future contributors to extend the wrong path. The live pipeline (brain hub → actions/engine → tool registry) is verified by 427 tests.
- **Consequences:** Faster boot parse; single source of truth; the import-graph CI gate now guards against recurrence.

## ADR-005: Every persistent store obeys the same bound-and-debounce contract
- **Context:** The knowledge graph and timeline grew without limit and rewrote their files synchronously on every event — the two outliers among otherwise disciplined bounded stores (memory 200, execution log ring 250, connections ring 80, screenshots ring 8).
- **Decision:** Knowledge graph: 500 entities / 1,500 links with importance+recency eviction (user-root entity immune) and 2s debounced saves. Timeline: 400-event window (newest kept) with debounced saves. Soak tests enforce both.
- **Rationale:** "More capability per byte" is enforced by store contracts, not by discipline. Unbounded growth is a slow storage leak wearing a useful name.
- **Consequences:** Old files with excess data are trimmed on the next save; eviction is importance-aware so real knowledge survives.

## ADR-006: Permission modes are user-governable surface, not just engine state
- **Context:** The permission mode machine (ask_every_time / approve_task / full_access), its IPC channels, and persistence were fully live with zero renderer calls — a permission system the user could not actually operate.
- **Decision:** A Settings → Desktop card ("Ask before actions") with three plain-language choices; copy mirrors the engine's mode-by-risk matrix; mode persists via the userData .env store.
- **Rationale:** A permission system without a switch is a permission system the user cannot govern — governance is the product feature.
- **Consequences:** Approval behavior is now predictable from Settings; remembered-grants scoping remains a scheduled P1 item (BACKLOG Permissions).

## ADR-007: Honesty over plausibility in telemetry (battery) and digests (weekly reflection)
- **Context:** Battery was a hardcoded constant silently disabling every low-power feature; the weekly reflection fabricated impressive-sounding statistics from a 1.5s timer.
- **Decision:** Battery reads real WMI values on Windows (60s cache) and reports honest-unsupported elsewhere. Weekly reflection renders the real digest from the weekly-reflection engine (timeline + memory + relationship profile) with an honest "quiet week" empty state; feedback buttons record through the existing IPC.
- **Rationale:** A companion that invents facts about your laptop or your week is worse than one that says "I don't know." Trust is the product.
- **Consequences:** Low-power awareness is live where a battery exists; the reflection feature is finally connected end-to-end.

## ADR-008: The IPC registry is the single source of channel truth
- **Context:** The audit found live channels living as raw string literals (permission-mode trio, approval-resolve, set-companion, swarm channels) and one dead declared channel (SWARM_BROADCAST) — drift between the registry, handlers, and preload.
- **Decision:** All literals promoted into `shared.ts`; the dead channel removed; a registry-contract test added; the static ipc-audit checker extended with renderer-usage coverage is scheduled as a CI gate.
- **Rationale:** The IPC boundary is where this app's regressions bite; the boundary must be checkable by script, not by memory.
- **Consequences:** Channel renames are now one-place changes; undeclared channels fail the contract test.

## ADR-009: Deterministic execution carries deadlines like everything else
- **Context:** The agent path had per-step budgets; the deterministic orchestrator path had none — a hung fetch could stall a task indefinitely. Scrapes had no AbortSignals.
- **Decision:** 45s per-step deadline wrapper on the deterministic path (honest timeout result); 10s AbortSignals on the YouTube/legacy scrapes.
- **Consequences:** The worst case is bounded and legible everywhere; the trail names the layer that spent the time.

## ADR-010: Boot health probes run in parallel
- **Context:** Six serial provider probes with ~10s timeouts each meant the boot health check could churn for a minute in the background and lag the Doctor.
- **Decision:** `Promise.all` across providers with stable row order.
- **Rationale:** Same result, ~6× sooner; the pill and Doctor stay honest without taxing boot.
- **Consequences:** Transport pinning of the probe itself remains open (F-23) — tracked, not hidden.
