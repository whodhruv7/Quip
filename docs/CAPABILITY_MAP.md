# Quip — Capability Map

> Status legend: **Live** (verified reachable + exercised) · **Partial** (wired but incomplete/missing surface) · **Planned** (priced in the vision, not built) · **Blocked** (documented external limitation) · **Unverified** (code-reviewed; not executable in the Linux sandbox).

## Core engine
| Capability | Status | Notes |
|---|---|---|
| Understanding pipeline (10 stages, structured object) | Live | brain/hub + understanding + references; 427-test suite coverage |
| Intent classification + hidden intents | Live | intent-parser-v2 + fixtures |
| Reference resolution ("again", "it", "the file") | Live | session referents; fixture-tested |
| Clarification gate | Live | clarify shape + quick-reply options |
| Task decomposition (agent-shaped goals) | Live | orchestrator + agent-loop, registry-vocabulary constrained |
| Plan execution with per-step verification | Live | actions/engine + verifier + expectation contracts |
| Bounded recovery ladder (retry → re-resolve → degrade → cancel) | Live | actions/recovery; deadlines now on BOTH paths |
| Task cancellation within one step deadline | Live | cancel channel + tokens |
| Execution log (ring 250, debounced) | Live | actions/execution-log |
| Learned procedures / workflow replay | Planned | store + trust-score design in vision Ch.15 (P4) |

## Device & environment
| Capability | Status | Notes |
|---|---|---|
| Device scan + knowledge index (diff-only, <50ms lookup) | Live | brain/device-index; verified boot-created stores |
| Installed-app discovery + default handlers | Live | engine/app-discovery (24h TTL + diff) |
| Window geometry clamp / multi-display | Live | window-geometry + display-metrics hook |
| Battery telemetry (real, Windows WMI) | Live (Windows) / honest-unsupported (elsewhere) | 60s cache; honesty test |
| Network reachability + transport journal | Live | connection-journal ring 80 |
| Foreground app / workspace context | Live | in-memory, session-scoped |
| File discovery index | Live | engine/file-discovery |

## Computer control & screen
| Capability | Status | Notes |
|---|---|---|
| Screen capture + vision interpretation | Live (code) / Unverified (Windows runtime) | PowerShell capture path reviewed; confidence floors defined |
| Structured screen queries (titles/geometry/process) | Live | cheap observations |
| App launch/focus/close with verification | Live | process/window observed |
| Mouse/keyboard input synthesis | Live (code) / Unverified (Windows runtime) | permission-gated; deny-listed targets |
| Browser navigation + account-aware URLs | Live | %40 /u/<n>/ authuser= contracts pinned by tests |
| Web reading + citation (Agent Reach) | Live | engine/web-reading + channels (GitHub/V2EX/Bilibili/Twitter) |
| Filesystem read/write/move/search | Live | file-ops; working-area approval rule pending (Planned) |
| Clipboard primitives | Live (code) / Unverified | round-trip verification |
| OS settings (volume/brightness) | Live (code) / Unverified | read-back verification |
| Session history UI | Planned | archive store exists; surface is P3 |
| Browser co-pilot (active-tab observation) | Planned | extension bridge design (P4) |

## Intelligence & providers
| Capability | Status | Notes |
|---|---|---|
| 6-provider failover chain (Groq→Gemini→Cerebras→NVIDIA→OpenRouter→Ollama) | Live | circuit breaker, model spares, honest trails |
| Key management (env precedence, Settings save, masking) | Live | userData/.env wins; never crosses bridge |
| Doctor diagnostics + health pill | Live | parallel probes now |
| Screen-vision model routing (vision-capable flags) | Live | model-router |
| Token budgeting / prompt assembler budgets | Partial | per-block caps partially enforced; ledger surface planned |
| Streaming chat with failover notices | Live | SSE chunking + provider chip |
| Voice output (Groq → Edge neural → local SAPI) | Live (chain) / Unverified (audio on Windows) | settings + test button |
| Voice input (push-to-talk) | Planned | ASR abstraction design (P3/P4) |
| Sentence-streamed speech | Planned | chunked synthesis (P3) |

## Presence & product
| Capability | Status | Notes |
|---|---|---|
| 4 screen modes (companion/panel/full/fullscreen) | Live | mode contracts + Esc exit |
| Close = hide, quit only from Settings/tray | Live | enforced + tested |
| Single-instance focus | Live | requestSingleInstanceLock |
| Desktop shortcut from Settings (Windows .lnk) | Live (code) / Unverified (shell) | ensureQuipShortcut + Add-shortcut button |
| Fetch Updates (stash-protected pull + needsRestart) | Live | app-updates contract tests |
| 6 companions with distinct art + states | Live | roster matrix; eye tracking now consistent |
| 10 themes, pre-paint, opaque chatbox, themed logo | Live | token scan ongoing for remaining literals (Partial) |
| Permission-mode UI card | Live | new this run |
| Weekly reflection (real data) | Live | new this run |
| Session history UI / procedure inspection UI | Planned | P3 |
| Launcher run-quip.cmd (idempotent install, warm build stamp, MessageBox failures, launch log) | Live (code) / Unverified (Windows runtime) | launcher contract tests |

## Autonomy systems (the "do everything" wave — 150/150 roadmap items)
| Capability | Status | Notes |
|---|---|---|
| Ghost Browser (offscreen DOM: read/extract/click/fill) | Live (code) / Unverified (real sites) | SSRF gate, 6-page budget, idle auto-close |
| Ghost wait-for + screenshot (PNG → Pictures/Quip) | Live (code) / Unverified (runtime) | bounded 2–30s wait; byte-size evidence |
| MailWing (zero-dep SMTP + humanized compose + outbox) | Live (code) / Unverified (real SMTP send) | "sent" ONLY on server 250; Gmail fallback |
| Contacts Book (ghost→book pipeline, CSV export) | Live | dedupe-by-email, scored search |
| FileButler (organize/duplicates/storage/watch/undo) | Live | dry-run first, manifest undo, deny-listed dirs |
| GhostHands (screenshot/wallpaper/brightness/notify/lock/battery/clipboard/snap) | Live (code) / Unverified (Windows runtime) | window_snap: move+resize both verified |
| Quest Engine (email-from-website, organize-downloads, morning-brief) + routines | Live | per-step verify, skip-with-note, cancel |
| Autonomy budget (repeat destructive approval ≤N per quest) | Live | engine + IPC + Settings card; auto-approvals disclosed in notes |
| Ambiguity + context carry ("usko mail kar") | Live | top-2 within 5 pts → clarify; session contact memory |
| Multi-verb chains ("X phir Y") | Live | both halves must parse as tasks, else single intent |
| Specialized failure kinds + recovery (smtp-auth/5xx, ghost-blocked, vault-locked, watch) | Live | auth/5xx/blocked never retry; watch reobserves once |
| **Problem Diary** (every failure remembered: Settings → Problems) | Live | auto-record from tools/quests/routines/chat; dedupe+reopen; Markdown export to Desktop; chat verbs; fail-soft store |
| Global hotkey Ctrl+Shift+Space (summon/hide) | Live (code) / Unverified (Windows runtime) | registered at boot, unregistered on quit |
| Tray quick actions (Show / New task / Organize downloads / Quit) | Live | organize runs the SAME approval-gated quest |
| Taskbar progress mirror + flash-on-finish | Live (code) / Unverified (Windows runtime) | quest events drive setProgressBar/flashFrame |
| Drag & drop onto chat (path chips → organize/open/duplicates) | Live | webUtils.getPathForFile |
| Chat search, pin, export MD, quick replies, contact cards, move tables, email draft cards | Live | renderer wave; all keyboard-reachable |
| Personalization (font size, density, accent override, companion tint, bubble style, custom chips, greetings) | Live | persisted prefs/localStorage, reduced-motion respected |
| First-run tour, settings search, doctor card, outbox card | Live | one-time tour gate via prefs |

## Blocked
| Capability | Reason |
|---|---|
| Full GUI lifecycle verification in this sandbox | No display server beyond xvfb smoke; Windows release checklist owns the rest |
| Real provider end-to-end calls | No live keys in the audit environment; contract+mock tests stand in |
| Anything requiring OS permissions beyond sandbox (accessibility-tree grounding, elevated installs) | Platform-granted; documented in vision Ch.29 long-term |
