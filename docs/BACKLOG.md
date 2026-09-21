# Quip Engineering Backlog — 400+ task execution ledger

> Generated from the Master Future Vision blueprint (docs/MASTER-FUTURE-VISION.pdf) and the verified codebase audit (docs/CODEBASE_AUDIT.md). Every task carries acceptance criteria and a verification method. A task is DONE only when its verification has actually run and passed — never merely because code was written. Statuses: `todo` → `doing` → `done` / `blocked(reason)`.


**Total tasks: 493** across 25 domains, dependency-ordered by phase (P0 startup/reliability → P1 architecture → P2 efficiency → P3 UX → P4 capability depth → P5 polish/verification).


## Phase P0 — Startup & reliability blockers (do first; nothing else starts with P0 open)

| ID | Domain | Task | Acceptance criteria | Verification | Status |
|----|--------|------|---------------------|--------------|--------|
| Q-001 | Execution & Legacy | AbortSignal on legacy-tools scrape | Legacy fallback path bounded | timeout test | done |
| Q-002 | Startup & Lifecycle | Create companion window before bootstrap completes | Window visible before blocking bootstrap; bootstrap continues in background | boot test: window-visible timestamp < 2s warm | done |
| Q-003 | Startup & Lifecycle | Buffer BOOTSTRAP_PROGRESS events until first window exists | No progress event is dropped when broadcast runs before windows map is populated | unit test: buffer flush delivers all stages to late window | done |
| Q-004 | Startup & Lifecycle | Render real ScanOverlay progress on first launch | Overlay shows live stage events and completes only on real bootstrap done | clean-start test with simulated slow scan | done |
| Q-005 | Startup & Lifecycle | Remove ScanOverlay 1.2s fake-done timer | Overlay never marks scanned before real done event; generous timeout only as last resort | code assert + slow-scan test | done |
| Q-006 | Startup & Lifecycle | Add launch-log stage timestamps for every boot stage | Each stage logs started/completed ms; failures log reason | read log in boot test; assert fields | todo |
| Q-007 | Startup & Lifecycle | Make bootstrap per-stage fail-soft explicit | Each init stage catch logs its name; boot proceeds with honest degraded flags | inject stage failure; boot completes | todo |
| Q-008 | Startup & Lifecycle | Single-flight device rescans | Concurrent RESCAN_DEVICE calls collapse to one running scan; last-wins | fire 5 IPC rescans; one scan observed | todo |
| Q-009 | Startup & Lifecycle | Second-instance focuses existing window in current mode | Launching twice focuses; no duplicate window; mode unchanged | launch twice in test harness | todo |
| Q-010 | Startup & Lifecycle | Close button returns panel/full/fullscreen to companion | X in any non-companion mode shrinks to companion; process alive | renderer + main integration test | todo |
| Q-011 | Startup & Lifecycle | Close in companion mode keeps mascot and process | X in companion mode is a no-op on window; app stays alive | integration test | todo |
| Q-012 | Startup & Lifecycle | Only Settings quit and tray quit terminate process | QUIT_APP and tray quit path set isQuitting and exit; no other path exits | process-exit assertions per path | todo |
| Q-013 | Startup & Lifecycle | Quit flushes memory store and journals before exit | before-quit flush completes; no truncated JSON on next boot | quit test + store validity check | todo |
| Q-014 | Startup & Lifecycle | Renderer crash reload x3 then window recreate | Crash recovery ladder works; companion returns after recreate | simulated renderer kill | todo |
| Q-015 | Startup & Lifecycle | Unresponsive renderer force-crash and rebuild | Hang recovery works within defined timeout | simulated hang test | todo |
| Q-016 | Startup & Lifecycle | Self-heal re-show of hidden companion windows | 15s loop re-shows lost windows without stealing focus from real apps | hide-window simulation | todo |

## Phase P1 — Architecture coherence + honest product gaps

| ID | Domain | Task | Acceptance criteria | Verification | Status |
|----|--------|------|---------------------|--------------|--------|
| Q-017 | Permissions & Ledger | Dangerous allowlist management UI | Full-trust mode's allowlist viewable/editable in Settings | UI test | todo |
| Q-018 | Startup & Lifecycle | Display-metrics change clamps geometry | Companion never lost when display config changes | display change simulation | todo |
| Q-019 | Startup & Lifecycle | Clean-start matrix automation | Empty userData boot passes: scan visible, no errors, stores created | CI smoke with temp userData | done (sandbox: scripts/boot-smoke.sh — empty-userData boot, stores created, process alive; Windows matrix rows remain) |
| Q-020 | Startup & Lifecycle | Repeated open/close/reopen lifecycle loop test | 20 cycles leave no window/process leaks and no state divergence | loop test with assertions | todo |
| Q-021 | Startup & Lifecycle | Boot with no keys produces calm onboarding state | no-key message renders; no crash; Settings reachable | boot test without env | todo |
| Q-022 | Startup & Lifecycle | Boot with malformed .env is fail-soft | Bad lines skipped with log; valid keys still load | malformed env test | todo |
| Q-023 | Startup & Lifecycle | Boot offline: no network-dependent stage blocks | All network stages have deadlines; boot completes offline | network-failure simulation | todo |
| Q-024 | Startup & Lifecycle | Tray icon fallback chain never renders empty tray | 3-level icon fallback incl. embedded base64 verified | unit test of icon resolver | todo |
| Q-025 | Startup & Lifecycle | Tray menu Show/Quit match window semantics | Show focuses current mode; Quit terminates cleanly | tray action tests (where testable) | todo |
| Q-026 | Startup & Lifecycle | First-run shortcut ensure is non-blocking | ensureQuipShortcut never delays window; result visible only in logs | timing assert | todo |

## Phase P2 — Performance, efficiency, caching, measurement

| ID | Domain | Task | Acceptance criteria | Verification | Status |
|----|--------|------|---------------------|--------------|--------|
| Q-027 | Architecture | Delete legacy task-brain/tool-executor/capability-registry trio | Files removed; import graph clean; tests green | build+tests after removal | done |
| Q-028 | Architecture | Remove unused runTask import lifeline | main.ts no longer references legacy pipeline | grep zero matches | done |
| Q-029 | Architecture | Re-point any legacy-pipeline tests to live pipeline | No test imports deleted modules; coverage preserved via brain-hub tests | test suite green | todo |
| Q-030 | Architecture | Single source risk table in actions/contracts | permission-modes + permission-system reference contracts table | unit test: tables identical | todo |
| Q-031 | Architecture | Delete engine/window-policy.ts or promote it | No test-only production modules; decision recorded | import-graph report | done |
| Q-032 | Architecture | Split main.ts IPC handlers into ipc/ modules | main.ts < 1200 lines; handlers grouped by domain | line-count check + tests | todo |
| Q-033 | Architecture | Extract buildSystemPrompt into prompt/ module | Prompt assembly unit-testable; CHAT_SEND thin | unit tests on prompt builder | todo |
| Q-034 | Architecture | Extract window factory + tray into windows/ module | Lifecycle code isolated from IPC | module boundary review + tests | todo |
| Q-035 | Architecture | Import-graph reachability CI gate | Unreachable electron modules fail build unless allowlisted | gate catches planted orphan | todo |
| Q-036 | Architecture | Allowlist file for test-only modules | Explicit, reviewed, minimal | review + docs | todo |
| Q-037 | Architecture | Consolidate duplicate YouTube search | One implementation (browser-automation) serves all callers | grep single implementation | todo |
| Q-038 | Architecture | Rename colliding permission modules for clarity | engine/permission-modes vs system/permission-system names disambiguated | grep + build | todo |
| Q-039 | Architecture | Document module ownership map | docs/ARCHITECTURE.md lists owner + responsibility per module | docs present; review | todo |
| Q-040 | Architecture | Brains vs engine vs brain layering doc | Which layer owns knowledge vs execution vs understanding, written | docs present | todo |
| Q-041 | Architecture | Deprecate parallel SITES table remnants | intent-parser hints are the only destination data source | grep | todo |
| Q-042 | Architecture | world-model generator single write path | Only generator writes world-model.json | write-path audit | todo |
| Q-043 | Architecture | memory-brain instance single write path | One instance owns memory.json writes | audit + tests | todo |
| Q-044 | Architecture | execution-log as sole action history | No parallel action records elsewhere | grep | todo |
| Q-045 | Architecture | window-geometry helper owns all geometry math | No duplicated clamp math in main.ts | unit tests + grep | todo |
| Q-046 | Architecture | Shared JSON store utility (load/save/debounce/cap) | One store util replaces copy-pasted load/save across brains | refactor + tests | todo |
| Q-047 | Architecture | Typed error taxonomy module | Honest-failure reasons use shared error kinds | unit tests | todo |
| Q-048 | Architecture | Event emitter util for engine events | Task lifecycle events via one typed emitter | unit tests | todo |
| Q-049 | Architecture | Remove duplicate env parsing paths | env-load.ts is the only .env reader | grep | todo |
| Q-050 | Architecture | Config constants module (sizes, budgets) | Magic numbers (132x176, 548x560, 1060x680) centralized | grep + tests | todo |
| Q-051 | Architecture | Decision record: legacy trio deletion rationale | ADR in docs/ARCHITECTURE_DECISIONS.md | docs present | todo |
| Q-052 | Architecture | Decision record: single risk table rationale | ADR present | docs present | todo |
| Q-053 | Caching & Indexing | Cache registry with invalidation table | Every cache: key, TTL, invalidation, bound (docs + tests) | registry + tests | todo |
| Q-054 | Caching & Indexing | Device index boot-diff correctness | Diff merge leaves unchanged records untouched | diff test | todo |
| Q-055 | Caching & Indexing | App-index TTL refresh | 24h TTL refresh opportunistic in background | ttl test | todo |
| Q-056 | Caching & Indexing | Display-change invalidation | Geometry caches invalidate on event | event test | todo |
| Q-057 | Caching & Indexing | Provider model-list session cache | Health check before reuse | cache test | todo |
| Q-058 | Caching & Indexing | Observation cache hint invalidation | Inputs/navigation invalidate captures | invalidation test | todo |
| Q-059 | Caching & Indexing | Reading cache per URL+hash | Unchanged page cached per session | cache test | todo |
| Q-060 | Caching & Indexing | Procedure fast-path cache | Trusted shapes resolved without planner | integration test | todo |
| Q-061 | Caching & Indexing | Understanding cache per session | Identical message reuse | cache test | todo |
| Q-062 | Caching & Indexing | Cache cost accounting snapshot | Sizes + freshness work reported | diagnostic test | todo |
| Q-063 | Caching & Indexing | Stale-cache adversarial tests | Wrong-with-confidence impossible: invalidations proven | adversarial tests | todo |
| Q-064 | Caching & Indexing | Hash util shared module | One hashing impl across caches | refactor + tests | todo |
| Q-065 | Caching & Indexing | Cache metrics | Hit rates visible in diagnostics | metrics test | todo |
| Q-066 | Caching & Indexing | Cache docs | Table 22-1 kept current | docs | todo |
| Q-067 | Caching & Indexing | Index rebuild recovery | Corrupt index rebuilds honestly | corruption test | todo |
| Q-068 | Caching & Indexing | Alias table persistence + bounds | Learned aliases stored, capped | store test | todo |
| Q-069 | Execution & Verification | Per-step deadline on deterministic orchestrator path | executeWithRetry wrapped; hang fails honestly within budget | hanging-fetch test | done |
| Q-070 | Execution & Verification | AbortSignal on YouTube result scrape | searchYouTubeResults aborts at deadline | timeout test | done |
| Q-071 | Execution & Verification | Unclear verdict implemented in verifier | Ambiguous observation yields unclear, not pass | verifier unit test | todo |
| Q-072 | Execution & Verification | Expectation match-rule library | equals/exists/contains/delta rules shared by all steps | rule unit tests | todo |
| Q-073 | Execution & Verification | Evidence retention per step | StepRecord stores observation + verdict + timings | record schema test | todo |
| Q-074 | Execution & Verification | Recovery ladder budgets enforced | retry 1, re-resolve 1, degrade 1, then cancel | ladder tests | todo |
| Q-075 | Execution & Verification | Recovery transcript in step record | Each attempt logged with outcome | record test | todo |
| Q-076 | Execution & Verification | Cancellation token plumbing | Steps + long primitives honor token at boundaries | cancel tests | todo |
| Q-077 | Execution & Verification | Stop within one step deadline | cancelTask -> engine stops within max step deadline | integration test | todo |
| Q-078 | Execution & Verification | Partial completion reporting | done vs not-done listed on cancel/fail | integration test | todo |
| Q-079 | Execution & Verification | Compensating action offer | Safe cleanup offered for cancelled plans (close opened page) | policy test | todo |
| Q-080 | Execution & Verification | Execution log ring 250 enforced | Soak test: 1000 actions, file bounded | soak test | todo |
| Q-081 | Execution & Verification | Execution log debounced writes | No sync write per event | write-pattern test | todo |
| Q-082 | Execution & Verification | Task state machine 11-state conformance | All transitions legal; no zombie states | state machine tests | todo |
| Q-083 | Execution & Verification | WAITING_FOR_PERMISSION parks task | Ask parks; resolve resumes; app-unload safe | integration test | todo |
| Q-084 | Execution & Verification | RECOVERING state surfaced to UI | Companion pose + chip during recovery | event contract test | todo |
| Q-085 | Execution & Verification | Outcome flash clear timer | Success/error pose always clears at 2s | renderer timer test | todo |
| Q-086 | Execution & Verification | Trust line rendering | Every completion message carries why-rationale | renderer contract test | todo |
| Q-087 | Execution & Verification | Honest failure message mapping | Each error kind maps to plain-language reason + next step | mapping table test | todo |
| Q-088 | Execution & Verification | Verification budget per step | Verify cost bounded; cheap checks first | policy test | todo |
| Q-089 | Execution & Verification | Observation dedupe within task | Same-region checks reuse capture until change hint | cache test | todo |
| Q-090 | Execution & Verification | Observation cost ledger | Captures + vision calls counted per task | ledger test | todo |
| Q-091 | Execution & Verification | Engine result schema stability test | Renderer-compatible result shape pinned by test | schema test | todo |
| Q-092 | Execution & Verification | Direct vs agent result parity | Both engines emit same StepRecord shape | parity test | todo |
| Q-093 | Execution & Verification | Concurrent task isolation | Two tasks cannot corrupt each other's state | concurrency test | todo |
| Q-094 | Execution & Verification | Engine exception containment | Step throw becomes fail verdict, never process crash | fault-injection test | todo |
| Q-095 | Execution & Verification | Verification documentation | Match rules + ladder documented | docs | todo |
| Q-096 | IPC & Contracts | Move off-registry IPC literals into shared.ts | set-companion, permission-mode trio, approval-resolve, swarm channels declared once | ipc-audit passes with zero literals | done |
| Q-097 | IPC & Contracts | Remove dead IPC.SWARM_BROADCAST or wire it | No declared channel lacks both handler and consumer decision recorded | registry scan | done |
| Q-098 | IPC & Contracts | Extend ipc-audit with renderer-usage diff | Checker fails CI when a channel loses its consumer or handler | checker run on mutated fixture | todo |
| Q-099 | IPC & Contracts | Wrap CHAT_SEND prompt build in guarded section | Brain throw yields CHAT_ERROR with kind, not unhandled rejection | throwing-brain stub test | done |
| Q-100 | IPC & Contracts | Audit all ipcMain handlers for try/catch coverage | Every non-trivial handler returns typed error payload on throw | static scan + targeted tests | todo |
| Q-101 | IPC & Contracts | Payload validation for window/geometry channels | NaN/garbage rejected safely; no crash path from hostile payload | fuzz payload test | todo |
| Q-102 | IPC & Contracts | Payload validation for TASK_EXECUTE input | Malformed task input rejected with honest error before planning | fuzz test | todo |
| Q-103 | IPC & Contracts | IPC timeouts documented per channel family | Each channel family declares expected latency; long ops stream progress | registry annotations + review | todo |
| Q-104 | IPC & Contracts | Preload API type completeness test | Every exposed method has payload type in shared types | type-level test (tsc) | todo |
| Q-105 | IPC & Contracts | Remove unused main.ts imports (loadProfile, summarizeJournal) | Import graph clean; boot parses fewer modules | import scan | todo |
| Q-106 | IPC & Contracts | Emit task progress events with step granularity | Renderer receives step i/n + description for both engines | execution test asserts events | todo |
| Q-107 | IPC & Contracts | Emit provider trail on chat failure | Renderer error banner shows provider chain reasons | failover test asserts trail | todo |
| Q-108 | IPC & Contracts | CHAT_ERROR kind-specific CTA mapping test | no-key renders key CTA; others render dismiss with reason | renderer contract test | todo |
| Q-109 | IPC & Contracts | approval-resolve invalid id handling | Unknown approval id resolves to honest error, no crash | unit test | todo |
| Q-110 | IPC & Contracts | Inter-companion message channel contract | swarm raw channels typed + guarded or documented test-only | registry review + test | todo |
| Q-111 | IPC & Contracts | Window-mode broadcast payload validation | Mode-changed events always carry valid WindowMode | unit test | todo |
| Q-112 | IPC & Contracts | Progress event coalescing | High-frequency progress events coalesce to <=10/s per task | event-rate test | todo |
| Q-113 | IPC & Contracts | Cancel channel guarantees | cancelTask acked; engine stops within one step deadline | cancel integration test | todo |
| Q-114 | IPC & Contracts | Environment-change listener contract | onEnvironmentChange payload typed; unsubscribes verified | unit test | todo |
| Q-115 | IPC & Contracts | GetKnowledgeGraph payload bounds | Renderer receives bounded graph slice, not unbounded file | bounds test | todo |
| Q-116 | IPC & Contracts | GetActionLog payload bounds | Bounded slice with newest-first order | bounds test | todo |
| Q-117 | IPC & Contracts | Connection journal channel contract | Bounded entries; typed reasons | bounds test | todo |
| Q-118 | Memory & Stores | Knowledge graph cap + eviction | Entities/links bounded; recency+importance eviction | soak test | done |
| Q-119 | Memory & Stores | Knowledge graph debounced writes | No sync write per upsert | write-pattern test | done |
| Q-120 | Memory & Stores | Timeline window bound | logEvent windowed; old events age out | soak test | done |
| Q-121 | Memory & Stores | Timeline debounced writes | No sync write per event | write-pattern test | done |
| Q-122 | Memory & Stores | Graph/timeline migration trims existing files | Upgrade trims with report of removals | migration test | todo |
| Q-123 | Memory & Stores | Memory importance scoring tests | Score inputs: repetition, pins, use, correction | scoring tests | todo |
| Q-124 | Memory & Stores | Decay + prune policy tests | Floor pruning; pinned immune | policy tests | todo |
| Q-125 | Memory & Stores | Memory cap 200 working entries | Soak: 1000 extractions, cap held | soak test | todo |
| Q-126 | Memory & Stores | Extraction evidence spans | Each memory shows source span | schema test | todo |
| Q-127 | Memory & Stores | User correction outranks extraction | Correction window honored | policy test | todo |
| Q-128 | Memory & Stores | Store-size CI assertions | All bounded stores asserted in tests | CI test | done (knowledge-graph + timeline soaks in tests/reliability-round-2.test.mjs) |
| Q-129 | Memory & Stores | Atomic-per-file write util | No truncated JSON after kill | crash test | todo |
| Q-130 | Memory & Stores | Relevance-filtered prompt memory slice | Only task-relevant memory enters prompt | assembler test | todo |
| Q-131 | Memory & Stores | Memory tab score display | User sees scores + evidence | renderer contract | todo |
| Q-132 | Memory & Stores | Forget/pin/prune honest results | Actions report counts; guarded handlers | UI tests + try/catch | todo |
| Q-133 | Memory & Stores | Session archive bounds (20x60) | Renderer storage bounded | store test | todo |
| Q-134 | Memory & Stores | Vision captures ring prune test | Last 8 held | ring test | todo |
| Q-135 | Memory & Stores | Connection journal ring 80 | Soak bounded | soak test | todo |
| Q-136 | Memory & Stores | Companion progression store bounds | Per-companion stats bounded | bounds test | todo |
| Q-137 | Memory & Stores | Weekly reflection real store | Digest from real logs; bounded feedback (52) | bounds + honesty tests | todo |
| Q-138 | Memory & Stores | Store documentation | Every store: purpose, cap, decay, writer | docs | todo |
| Q-139 | Memory & Stores | User-data size diagnostic | Doctor shows per-store sizes | diagnostic test | todo |
| Q-140 | Permissions & Security | Permission-mode settings card (3 modes) | Card shows current mode, switches persist, copy matches engine matrix | UI test: switch -> IPC -> persisted | done |
| Q-141 | Permissions & Security | Remembered grants store | allow-once / allow-shape grants persisted, listed, revocable | store round-trip + revoke test | todo |
| Q-142 | Permissions & Security | Grant scoping by shape + destination | An email-send grant never widens to generic send | scope tests | todo |
| Q-143 | Permissions & Security | Approval panel shows step/target/consequence | Panel copy per spec; deny is first-class outcome | renderer contract test | todo |
| Q-144 | Permissions & Security | Denial consumed by planner | Reform or honest partial after denial | integration test | todo |
| Q-145 | Permissions & Security | Mode enforcement matrix tests | Table 12-1 enforced for every risk x mode cell | matrix tests | todo |
| Q-146 | Permissions & Security | Irreversible actions always ask | Even full-trust asks for the irreversible few | matrix test | todo |
| Q-147 | Permissions & Security | Permission mode restored across restart | QUIP_PERMISSION_MODE persisted and re-applied | restart test | todo |
| Q-148 | Permissions & Security | Working areas store + settings UI | Declared areas editable; fs rules read them | store + UI tests | todo |
| Q-149 | Permissions & Security | Writes outside areas require approval in all modes | Enforced by fs primitives | enforcement test | todo |
| Q-150 | Permissions & Security | API keys masked in every log path | grep suite proves no key material in logs | log-scan test | todo |
| Q-151 | Permissions & Security | Keys never cross IPC bridge | Static + runtime assertion | bridge audit | todo |
| Q-152 | Permissions & Security | userData/.env write atomicity | Key saves atomic; no truncated env on crash | crash-in-save test | todo |
| Q-153 | Permissions & Security | Key format validation per provider | gsk_/csk-/nvapi-/sk-or-/AIza prefixes validated with honest errors | validation tests | todo |
| Q-154 | Permissions & Security | Deny-list tool screening tests | Listed tools unreachable through any executor | registry test | todo |
| Q-155 | Permissions & Security | Sandbox config review documented | contextIsolation on, nodeIntegration off decision recorded | ADR | todo |
| Q-156 | Permissions & Security | Screen-capture path injection review | PowerShell path interpolation verified app-generated only | security review note + test | todo |
| Q-157 | Permissions & Security | docs-tools arbitrary-path write guarded | Extension check + working-area rule enforced | path rule tests | todo |
| Q-158 | Permissions & Security | Secrets ledger documentation | Table 23-1 kept current in docs | docs | todo |
| Q-159 | Permissions & Security | Privacy copy accuracy check | Settings privacy copy matches actual egress + storage | review + test of egress list | todo |
| Q-160 | Permissions & Security | Log redaction defaults | Chat text redacted from main logs by default | log inspection test | todo |
| Q-161 | Permissions & Security | Clipboard sensitive-data masking | Clipboard reads masked in logs | mask test | todo |
| Q-162 | Permissions & Security | Permission decision audit events | Approvals/denials logged with shape + mode | audit log test | todo |
| Q-163 | Permissions & Security | Rate-limit approval prompts | No more than N approval asks per task without user progress | policy test | todo |
| Q-164 | Permissions & Security | Threat model document | Boundaries + soft spots written | docs | todo |
| Q-165 | Providers & Routing | Boot probe parallel + 8s cap + router transport | Probe uses net.fetch path; bounded; no proxy false-failures | probe timing test | todo |
| Q-166 | Providers & Routing | Probe results feed Doctor cache | Doctor shows boot-probe result until re-probed | integration test | todo |
| Q-167 | Providers & Routing | Circuit breaker state machine tests | 2-fail park, 30s->10min backoff, success clears | breaker tests | todo |
| Q-168 | Providers & Routing | 429 Retry-After immediate park | Respects hint up to cap | breaker test | todo |
| Q-169 | Providers & Routing | Provider health states table | healthy/degraded/parked/rate-limited/misconfigured/offline per spec | state tests | todo |
| Q-170 | Providers & Routing | Model fallback spare lists per provider | Rejected model id tries spares before provider skip | fallback tests | todo |
| Q-171 | Providers & Routing | Decommissioned-model recovery path | Free-tier model removal auto-falls to spare (llama-3.3 precedent) | fixture test | todo |
| Q-172 | Providers & Routing | Vision-capable routing flags | Vision only to vision-capable providers | routing tests | todo |
| Q-173 | Providers & Routing | Tool-use routing flags | Agent loop to tool-capable providers | routing tests | todo |
| Q-174 | Providers & Routing | Prompt budget per block (assembler) | Identity/memory/gist/tools each capped | assembler tests | todo |
| Q-175 | Providers & Routing | Overflow compression rule | Oversized blocks summarized, never truncated mid-structure | assembler test | todo |
| Q-176 | Providers & Routing | Token ledger per task | Tokens-by-block recorded; Doctor view | ledger test | todo |
| Q-177 | Providers & Routing | First-byte timeout 8-10s streaming | Chain moves on slow first byte | timeout test | todo |
| Q-178 | Providers & Routing | SSE stall timeout 25s | Mid-stream stall fails with trail | timeout test | todo |
| Q-179 | Providers & Routing | Transport swap on TLS errors | Stack-swap heuristic pinned | transport tests | todo |
| Q-180 | Providers & Routing | QUIP_PRIMARY_PROVIDER precedence | Env primary wins; settings override documented | config tests | todo |
| Q-181 | Providers & Routing | All-parked reset policy | If every provider parked, reset and try everything | breaker test | todo |
| Q-182 | Providers & Routing | Ollama opt-in end-to-end test | Enabled+reachable => serves; unreachable => honest skip | integration test (mock server) | todo |
| Q-183 | Providers & Routing | Gemini endpoint conformance | OpenAI-compatible quirks pinned | adapter tests | todo |
| Q-184 | Providers & Routing | Provider key rotation without restart | Settings save applies live via reload() | live-reload test | todo |
| Q-185 | Providers & Routing | Provider latency metrics | Per-provider p50 recorded for Doctor | metrics test | todo |
| Q-186 | Providers & Routing | Total-failure message quality | Trail rendered as readable per-provider reasons | renderer contract test | todo |
| Q-187 | Providers & Routing | Routing docs | Chain + states + knobs documented | docs | todo |
| Q-188 | Providers & Routing | Provider fixture recordings | Mock SSE streams per provider for offline tests | fixture files | todo |
| Q-189 | Startup & Lifecycle | Window position persistence per mode | Each mode remembers last geometry; clamped into current display | geometry persistence test | todo |
| Q-190 | Startup & Lifecycle | Mode-aware broadcast sync | Renderer mode changes always converge with main state | mode-switch fuzz test | todo |
| Q-191 | Startup & Lifecycle | Fullscreen entry/exit round-trip | Edge-to-edge bounds set; Esc returns to full; alwaysOnTop restored per mode | fullscreen round test | todo |
| Q-192 | Startup & Lifecycle | Warm-start build stamp correctness | Launcher rebuilds only when sources newer; stamp file logic unit-tested | stamp logic unit test | todo |
| Q-193 | Startup & Lifecycle | Launcher failure MessageBox includes real error text | Every launcher failure path pops reason, not generic message | inject failures; read message box payload | todo |
| Q-194 | Startup & Lifecycle | Launcher log rotation | quip-launch.log bounded (e.g. last 200KB) to prevent growth | log rotation test | todo |

## Phase P3 — UX & companion refinement program

| ID | Domain | Task | Acceptance criteria | Verification | Status |
|----|--------|------|---------------------|--------------|--------|
| Q-195 | Companions | Kai body implements eyeOffset | Cursor tracking works for Kai | render test/manual pass | done |
| Q-196 | Companions | Ren body implements eyeOffset | Cursor tracking works for Ren | render test/manual pass | done |
| Q-197 | Companions | All-companion state matrix render pass | 6 companions x 13 states render with distinct art | matrix render checklist | todo |
| Q-198 | Companions | Companion config single source | Art literals moved to config or documented as art | config scan | todo |
| Q-199 | Companions | Progression bar uses active companion colors | Depth bar per-companion, not hardcoded Pix duo | render test | done |
| Q-200 | Companions | Cosmetics tier consistency across roster | All companions have tier1/2/3 cosmetic slots | config test | todo |
| Q-201 | Companions | Mood engine input audit | Only honest signals feed mood | audit + tests | todo |
| Q-202 | Companions | Idle micro-gesture shuffle no-repeat | Gesture bag verified | unit test | todo |
| Q-203 | Companions | Blink cadence scales with energy | moodSpeed divides blink interval | unit test | todo |
| Q-204 | Companions | Eye tracking bounds (max 0.8px) | Offset clamped | unit test | todo |
| Q-205 | Companions | Tap debounce 150ms contract | Drag vs tap discrimination | interaction test | todo |
| Q-206 | Companions | Drag threshold 5px contract | Sub-threshold = tap | interaction test | todo |
| Q-207 | Companions | Wake-up animation on sleeping exit | Burst renders; state exits cleanly | state test | todo |
| Q-208 | Companions | Roster docs per companion | Personality + palette + behavior documented | docs | todo |
| Q-209 | Companions | Companion switch preserves chat history | Switching keeps session; mood updates | integration test | todo |
| Q-210 | Companions | Cosmetic unlock event toast | onCosmeticUnlock renders once | event test | todo |
| Q-211 | Companions | Swarm spawn headless registry correctness | Registry-only spawns tracked without windows | unit test | todo |
| Q-212 | Companions | Companion sprite crash fallback | main.tsx gradient fallback verified | error-boundary test | todo |
| Q-213 | Settings | Permission-mode card (desktop tab) | Mode switch + explanation + grants list | UI tests | todo |
| Q-214 | Settings | Guard refreshMemory/handleForget/handlePin | try/catch + honest error state | error-injection test | done |
| Q-215 | Settings | Guard handleResetDNA | Same | error-injection test | done |
| Q-216 | Settings | Quit confirmation copy per spec | Copy says companion leaves; cancel prominent | copy review | todo |
| Q-217 | Settings | Restart-now only after needsRestart | Button gated by fetch result | state test | todo |
| Q-218 | Settings | Fetch Updates progress + honest conflict UI | Stash conflict surfaces honestly | conflict fixture test | todo |
| Q-219 | Settings | Shortcut button result feedback | Success/failure toast with reason | UI test | todo |
| Q-220 | Settings | Rescan progress + single-flight UI | Rescan shows state; blocked while running | UI test | todo |
| Q-221 | Settings | Device tab honest empty states | Pre-scan => scanning state, not zeros | empty-state test | todo |
| Q-222 | Settings | AI tab provider cards live data | Cards reflect config + health | integration test | todo |
| Q-223 | Settings | Model browser search | Filter models by name | UI test | todo |
| Q-224 | Settings | Voice section engine state display | Current engine + voice shown | UI test | todo |
| Q-225 | Settings | Transport selector explanation | Copy explains auto/net/node | copy review | todo |
| Q-226 | Settings | Doctor report readability | Per-provider rows with reason + action | render pass | todo |
| Q-227 | Settings | Settings deep-link initialTab | AI-pill opens AI tab; gear opens general | integration test | todo |
| Q-228 | Settings | Settings scroll persistence | Reopen keeps tab; scroll sane | UI test | todo |
| Q-229 | Settings | Accessibility: focus states + contrast | Focus visible; contrast >= 3:1 across themes | a11y pass | todo |
| Q-230 | Settings | Settings docs | Every tab documented | docs | todo |
| Q-231 | Themes & UX | Token-scan script with baseline | Color literals inventoried; count must not grow | scan script | todo |
| Q-232 | Themes & UX | TopBar health pill tokens | Pill uses --quip-ok/bad | scan zero for file | done |
| Q-233 | Themes & UX | TopBar speaking bars tokens | Amber via --quip-warn | scan | done |
| Q-234 | Themes & UX | ChatMessage action badge tokens | ok/bad tokens replace hex | scan | done |
| Q-235 | Themes & UX | ChatMessage Dot fallback from theme | Fallback reads token, not #6FD6FF | render test | done |
| Q-236 | Themes & UX | ChatInput focus styles via CSS | Inline borderColor mutation replaced by token CSS | scan | todo |
| Q-237 | Themes & UX | ChatWelcome status colors tokens | Greens/ambers via tokens | scan | todo |
| Q-238 | Themes & UX | ConfirmModal gradient tokens | Danger gradient from tokens | scan | todo |
| Q-239 | Themes & UX | ActionApprovalPanel palette tokens | Risk palette from tokens | scan | todo |
| Q-240 | Themes & UX | Settings toggle knob tokens | Knobs from chrome tokens | scan | todo |
| Q-241 | Themes & UX | Progression depth bar tokens | Per-companion colors | render test | todo |
| Q-242 | Themes & UX | WeeklyReflection theme integration | Component themed, no bg-white/90 classes | scan + render pass | done |
| Q-243 | Themes & UX | WeeklyReflection real digest | getWeeklyDigest data; zero fabricated numbers | honesty test | done |
| Q-244 | Themes & UX | WeeklyReflection feedback wired | Buttons record via recordReflectionFeedback | integration test | done |
| Q-245 | Themes & UX | WeeklyReflection honest empty state | No activity => no-activity copy | empty-state test | done |
| Q-246 | Themes & UX | Session history UI | Archive list + open + search over stored sessions | UI tests | todo |
| Q-247 | Themes & UX | archiveSession wired to New chat | New chat archives; history lists it | integration test | todo |
| Q-248 | Themes & UX | Fullscreen layout dedup with full | One parameterized FullLayout component | component tests | todo |
| Q-249 | Themes & UX | ChatLayout event-based auto-scroll | Replace 150ms polling with scroll events | behavior test | todo |
| Q-250 | Themes & UX | Skeleton loading for history open | quip-skeleton adopted for async loads | render test | todo |
| Q-251 | Themes & UX | Dark-flag dead ternary fix | SettingsPanel:1440 cleaned | scan | todo |
| Q-252 | Themes & UX | Theme pre-paint no-flash test | applySavedTheme before first paint | init-order test | todo |
| Q-253 | Themes & UX | 10-theme render pass across surfaces | Checklist: settings/chat/approval/modal/digest across all themes | manual matrix + notes | todo |
| Q-254 | Themes & UX | Two theme keys consolidated | quip-theme sole key; QuipPrefs.theme removed | storage test | todo |
| Q-255 | Themes & UX | Chatbox top-left logo theme-aware | Logo renders in all modes/themes | render test | todo |
| Q-256 | Themes & UX | Chatbox opacity contract test | Panel/full/fullscreen surfaces opaque | computed-style test | todo |
| Q-257 | Understanding Engine | Per-stage unit tests for 10-stage pipeline | Each stage tested in isolation with fixtures | stage tests green | todo |
| Q-258 | Understanding Engine | Understanding object schema validation test | Every output passes schema; invalid shapes impossible downstream | schema test | todo |
| Q-259 | Understanding Engine | Pronoun referent resolution suite | it/that/the-file/again resolve from session referents with fixtures | fixture tests | todo |
| Q-260 | Understanding Engine | Referent table session lifecycle | Referents register on success, expire on session end, bound at 20 | unit tests | todo |
| Q-261 | Understanding Engine | Clarification gate policy tests | confidence x reversibility matrix produces ask/act per spec | matrix tests | todo |
| Q-262 | Understanding Engine | Clarify options rendering contract | Enumerable ambiguity renders quick-reply options | renderer contract test | todo |
| Q-263 | Understanding Engine | Hidden intent detection (verify/did-it-work) | did-it-work maps to verification of last task | fixture test | todo |
| Q-264 | Understanding Engine | Account-scoped destination detection tests | Gmail/Drive/Calendar resolve with account scope flag | fixture tests | todo |
| Q-265 | Understanding Engine | Hint tables data-driven with tests | Each hint entry tested; no behavior keyed on exact sentences | hint catalog tests | todo |
| Q-266 | Understanding Engine | ChatGPT/Gemini/Spotify/Flipkart/YouTube-studio hints | Destination families resolve per mega-spec list | fixture tests | todo |
| Q-267 | Understanding Engine | Confidence calibration report | Stated confidence vs outcomes histogram; miscalibration flagged | report generated from logs | todo |
| Q-268 | Understanding Engine | Multilingual input fixtures (Hinglish) | Mixed-language asks produce same understanding shape | fixture tests | todo |
| Q-269 | Understanding Engine | Heavy deliberate prompt versioned + reviewed | Prompt text in module with tests on key instructions | prompt tests | todo |
| Q-270 | Understanding Engine | Understanding caching per identical message | Identical repeated message within session reuses understanding | cache test | todo |
| Q-271 | Understanding Engine | Task-shape classifier tests (direct/agent/clarify) | Shape decision consistent across fixtures | fixture tests | todo |
| Q-272 | Understanding Engine | Entity extraction bound tests | Bounded entities; no runaway extraction on long input | bounds test | todo |
| Q-273 | Understanding Engine | Message normalization suite | Whitespace, casing, punctuation normalized deterministically | fixture tests | todo |
| Q-274 | Understanding Engine | Language/register detection tests | Detection informs register, never routes to different engine | fixture tests | todo |
| Q-275 | Understanding Engine | Clarification answers teach aliases | Answer to clarify updates alias table with evidence | integration test | todo |
| Q-276 | Understanding Engine | Understanding replay harness | Any logged message replays through pipeline offline | replay tool run | todo |
| Q-277 | Understanding Engine | Intent taxonomy documented | All intent ids documented with examples | docs | todo |
| Q-278 | Understanding Engine | Pipeline performance budget | Full pipeline < 100ms deterministic stages in-sandbox | timing test | todo |
| Q-279 | Understanding Engine | Provider-independence test | Pipeline stages without model calls produce identical output regardless of provider | mock-provider test | todo |
| Q-280 | Understanding Engine | Understanding object logged (redacted) | Logs carry shape+confidence, never full private text by default | log redaction test | todo |

## Phase P4 — Capability depth (procedures, computer-use, integrations)

| ID | Domain | Task | Acceptance criteria | Verification | Status |
|----|--------|------|---------------------|--------------|--------|
| Q-281 | Browser & Web | Destination family registry | app-backed/web-backed/both with identity rules | registry tests | todo |
| Q-282 | Browser & Web | Account-aware URL builder tests | %40 encoding + /mail/u/N/ + authuser= rules pinned | url fixture tests | todo |
| Q-283 | Browser & Web | Default-browser resolution tests | Web goals land in actual default | resolution tests | todo |
| Q-284 | Browser & Web | Navigation verification (URL shape + title) | Landing confirmed; mismatch reports which disagreed | verification tests | todo |
| Q-285 | Browser & Web | Search destinations (Google/YouTube) flows | Query construction + landing verified | fixture tests | todo |
| Q-286 | Browser & Web | Web reading pipeline hardening | Fetch->extract->compress->cite with reasons on failure | pipeline tests | todo |
| Q-287 | Browser & Web | Reading grades (clean/heuristic/limited) | Pages graded; limited marked in registry | grading tests | todo |
| Q-288 | Browser & Web | Citation triple (url, fetched-at, span) | Every grounded answer cites | citation test | todo |
| Q-289 | Browser & Web | Transport selection per request | net.fetch vs node with fallback; QUIP_TRANSPORT honored | transport tests | todo |
| Q-290 | Browser & Web | Agent-reach channel registration audit | Channels typed, deadline, honest failure | registry tests | todo |
| Q-291 | Browser & Web | Channel health probes in Doctor | Per-channel status row | probe tests (mock) | todo |
| Q-292 | Browser & Web | Unhealthy channel skip policy | Planner routes around degraded channels | policy test | todo |
| Q-293 | Browser & Web | GitHub channel contract tests | Repo read flows pinned | fixture tests | todo |
| Q-294 | Browser & Web | Social/feed channels contract tests | V2EX/Bilibili/Twitter read flows pinned | fixture tests | todo |
| Q-295 | Browser & Web | License posture document | Per-channel licensing posture recorded | docs | todo |
| Q-296 | Browser & Web | Open-in-default vs in-app policy | Quip opens user's default browser; never spawns hidden browsing sessions for user goals | policy test | todo |
| Q-297 | Browser & Web | Pop-up/redirect safety rule | Verification follows final URL only | policy test | todo |
| Q-298 | Browser & Web | Download destination rule | Downloads land in declared areas | policy test | todo |
| Q-299 | Browser & Web | Browser automation capability flags | Playwright-style control flagged per destination support | flag tests | todo |
| Q-300 | Browser & Web | URL construction edge cases (search operators, params) | Encoding pinned by fixtures | fixture tests | todo |
| Q-301 | Browser & Web | Reading cache per URL+hash | Repeated read of unchanged page cached within session | cache test | todo |
| Q-302 | Browser & Web | Browser docs | Destination families + verification documented | docs | todo |
| Q-303 | Filesystem & OS | Declared working areas enforcement | Fs primitives read areas; outside => approval | enforcement tests | todo |
| Q-304 | Filesystem & OS | No-silent-overwrite rule | Clobbering write versions/asks/fails loudly per plan | rule tests | todo |
| Q-305 | Filesystem & OS | Trash-over-delete where platform allows | Delete uses recycle path; permanent only with explicit grant | policy test | todo |
| Q-306 | Filesystem & OS | Symlink boundary rule | No following symlinks outside areas | rule test | todo |
| Q-307 | Filesystem & OS | Batch operation manifests | Multi-file ops produce moved/skipped/why manifest | manifest test | todo |
| Q-308 | Filesystem & OS | File discovery index diff maintenance | Hash-based diff; no full rewalks on unchanged | diff tests | todo |
| Q-309 | Filesystem & OS | File search by name/pattern/date | Index-first queries with honest misses | query tests | todo |
| Q-310 | Filesystem & OS | Open-with-association primitive | Opens via OS; verification by launch observed | primitive test | todo |
| Q-311 | Filesystem & OS | Read/write primitives with shape validation | Content shape checked on write | primitive tests | todo |
| Q-312 | Filesystem & OS | Move/rename collision checks | Pre-check collisions; report alternatives | collision tests | todo |
| Q-313 | Filesystem & OS | Document create primitive (md/txt/docx-ready) | Creates with template; verified existence+shape | primitive tests | todo |
| Q-314 | Filesystem & OS | Clipboard read/write with round-trip verify | Verification equality | primitive tests | todo |
| Q-315 | Filesystem & OS | OS settings primitives (volume/brightness) | Read-back verification; range clamps | primitive tests (mock) | todo |
| Q-316 | Filesystem & OS | Battery real read (Windows) with cache | Real values via WMI; 60s cache; honest unsupported | read test (mock WMI); honest fallback test | done |
| Q-317 | Filesystem & OS | Battery-aware prompt section live | Low-battery line only when real signal says so | prompt test | done |
| Q-318 | Filesystem & OS | Battery-aware proactive check live | checkBatteryCritical uses real values | unit test | done |
| Q-319 | Filesystem & OS | Network info primitive | Honest online/offline/transport state | primitive test | todo |
| Q-320 | Filesystem & OS | App launch/focus/close verification | Process/window observed for each | primitive tests | todo |
| Q-321 | Filesystem & OS | Filesystem docs | Rules + primitives documented | docs | todo |
| Q-322 | Filesystem & OS | fs path traversal hardening | No path escapes via ../ or env vars in user inputs | security tests | todo |
| Q-323 | Planning | Plan schema validation tests | Every produced plan passes schema; checkpoints present for risky steps | schema tests | todo |
| Q-324 | Planning | Checkpoint placement rules | Irreversible/external steps preceded by checkpoint | policy unit tests | todo |
| Q-325 | Planning | Decomposition of compound objective fixture | Quip-project fixture decomposes into expected sub-plan chain | fixture test | todo |
| Q-326 | Planning | Decomposition budget (max depth/steps) | Decomposition bounded; runaway plans rejected | bounds test | todo |
| Q-327 | Planning | Plan trust line mandatory | Plans without why rejected by engine | engine test | todo |
| Q-328 | Planning | Registry-only step composition | Plan steps reference existing capability ids; else honest out-of-reach | validation test | todo |
| Q-329 | Planning | Model-assisted decomposition contract | Model proposes steps from registry vocabulary only | mock model test | todo |
| Q-330 | Planning | Denial reform path | Denied step can reform plan; denial consumed as input | integration test | todo |
| Q-331 | Planning | Multi-step media plan fixture | search->play->verify chain produces expected plan | fixture test | todo |
| Q-332 | Planning | File organization plan fixture | query->move loop with manifest plan | fixture test | todo |
| Q-333 | Planning | Research plan fixture | web-read->compress->file-write chain | fixture test | todo |
| Q-334 | Planning | Plan dedup within session | Identical goal shape reuses recent plan skeleton | cache test | todo |
| Q-335 | Planning | Risk propagation tests | Step risk from contracts, not caller opinion | unit tests | todo |
| Q-336 | Planning | Deadline assignment per step | From capability entry; override rejection | unit tests | todo |
| Q-337 | Planning | Parameterized plan inputs | Plans accept parameters for procedure replay | unit tests | todo |
| Q-338 | Planning | Partial plan completion semantics | Completed subset reported honestly with remaining steps | integration test | todo |
| Q-339 | Planning | Plan cancel between steps | Token honored at boundaries | cancel test | todo |
| Q-340 | Planning | Planner performance budget | Direct plan creation < 100ms in-sandbox | timing test | todo |
| Q-341 | Planning | Planner fallback when discovery empty | No candidates -> discovery or honest refusal, never hallucinated app | unit tests | todo |
| Q-342 | Planning | Plan documentation | Plan schema + lifecycle documented in docs | docs | todo |
| Q-343 | Procedures & Learning | Procedure record schema + validation | Schema per Chapter 15; no coordinates/captures | schema tests | todo |
| Q-344 | Procedures & Learning | Procedure store bounded (KB-scale records) | 100s of procedures stay small | bounds test | todo |
| Q-345 | Procedures & Learning | Learning eligibility: fully-verified plans only | Plans with guessed steps stored as notes only | policy test | todo |
| Q-346 | Procedures & Learning | Trust score update on replay | Success/fail adjusts score; thresholds gate usage | policy tests | todo |
| Q-347 | Procedures & Learning | Trusted procedure => fast path | Exact shape replays deterministically, zero tokens | integration test | todo |
| Q-348 | Procedures & Learning | Replay under full verification | Replays run through action engine gates | integration test | todo |
| Q-349 | Procedures & Learning | Replay adaptation rules | Drift matrix (title move/absent/dialog) handled | adaptation tests | todo |
| Q-350 | Procedures & Learning | 3-failure retirement to notes | Broken procedures stop replaying | policy test | todo |
| Q-351 | Procedures & Learning | Procedure inspection UI (Settings) | List/view/pin/delete live | UI tests | todo |
| Q-352 | Procedures & Learning | User-authored procedures | Recorded/described steps enter store with prior | authoring tests | todo |
| Q-353 | Procedures & Learning | Failure records feed risk estimates | Divergence notes inform planner | integration test | todo |
| Q-354 | Procedures & Learning | Procedure dedup by goal shape | Variations collapse to parameterized few | dedup test | todo |
| Q-355 | Procedures & Learning | Learned procedure size budget | < 2KB typical; enforced | budget test | todo |
| Q-356 | Procedures & Learning | Learning never blocks reply | Async learning stage | timing test | todo |
| Q-357 | Procedures & Learning | Procedure export/import format (spike) | Signed bundle feasibility | spike report | todo |
| Q-358 | Procedures & Learning | Replay permission parity | Replay never exceeds original grant scope | policy test | todo |
| Q-359 | Procedures & Learning | Learning documentation | Store + lifecycle documented | docs | todo |
| Q-360 | Procedures & Learning | Learning metrics | Procedures learned/replayed/month in Doctor | metrics test | todo |
| Q-361 | Screen & Computer Control | Unified observation service module | Screen capture + structured query + vision behind one interface | module tests | todo |
| Q-362 | Screen & Computer Control | Capture ring of 8 with prune-on-write | Storage bounded even on crash | ring test | todo |
| Q-363 | Screen & Computer Control | Screen-change hash primitive | Region hash detects change cheaply | hash test | todo |
| Q-364 | Screen & Computer Control | wait-for-change primitive | Watch region/value until differs or deadline | primitive tests | todo |
| Q-365 | Screen & Computer Control | Vision confidence floor enforcement | Below floor => unclear, never pass | floor test | todo |
| Q-366 | Screen & Computer Control | Vision question contract | Answer-or-refusal shape; no prose guessing | contract test | todo |
| Q-367 | Screen & Computer Control | Region cropping for vision calls | Targeted region reduces tokens | crop path test | todo |
| Q-368 | Screen & Computer Control | Screen-vision prompt versioned | Prompt in module with tests | prompt tests | todo |
| Q-369 | Screen & Computer Control | Display enumeration + primary default | Multi-display capture correct | display tests (sandbox-safe parts) | todo |
| Q-370 | Screen & Computer Control | DPI-aware geometry | Coordinates scale with DPI factor | geometry tests | todo |
| Q-371 | Screen & Computer Control | Described-target resolution engine | Resolve 'the button labeled X' from live observation | resolution tests | todo |
| Q-372 | Screen & Computer Control | Target re-resolution on miss | Post-action miss triggers fresh observation + re-resolve | recovery test | todo |
| Q-373 | Screen & Computer Control | Input synthesis attribution | Every synthetic input logged with step + plan | log test | todo |
| Q-374 | Screen & Computer Control | Click/type/hotkey/scroll primitives | Each verified by post-observation where applicable | primitive tests (mock-backed) | todo |
| Q-375 | Screen & Computer Control | Drag primitive with path verification | Drag end-state verified | primitive test | todo |
| Q-376 | Screen & Computer Control | Window move/resize/minimize/maximize/close primitives | Each with geometry/state verification | primitive tests | todo |
| Q-377 | Screen & Computer Control | Foreground-window query primitive | Returns title/pid/bounds honestly (unknown-safe) | primitive test | todo |
| Q-378 | Screen & Computer Control | UI-element query from accessibility APIs (exploration) | Feasibility note + prototype for element tree read | spike report | todo |
| Q-379 | Screen & Computer Control | Screen-state cache across verify checks | No duplicate captures per unchanged screen | dedupe test | todo |
| Q-380 | Screen & Computer Control | Vision call cost cap per task | Max N vision calls per task; beyond => honest degradation | cap test | todo |
| Q-381 | Screen & Computer Control | Screen capture failure honest error | OS failure surfaces reason, not silent empty | failure test | todo |
| Q-382 | Screen & Computer Control | Computer-control permission mapping | Input synthesis risk classes per Table 7-1 | mapping test | todo |
| Q-383 | Screen & Computer Control | Web-session input escalates risk | Input into browser session with external effect => dangerous | policy test | todo |
| Q-384 | Screen & Computer Control | Screen understanding fixtures | Fixture screens with expected structured reads | fixture suite | todo |
| Q-385 | Screen & Computer Control | Multi-display clamp rules | Geometry clamps into nearest display | clamp tests | todo |
| Q-386 | Screen & Computer Control | Idle detection for companion sleep | No interaction + no task => sleeping after N min | state test | todo |
| Q-387 | Screen & Computer Control | Companion sleeping wake on hover/tap | Wake animation + state exit | state test | todo |
| Q-388 | Screen & Computer Control | Computer-control docs | Primitives + verification documented | docs | todo |
| Q-389 | Screen & Computer Control | Mouse-path humanization option (exploration) | Optional eased paths for reliability on real apps | spike report | todo |
| Q-390 | Screen & Computer Control | Capture privacy rule | Captures excluded from any prompt unless task needs sight | policy test | todo |
| Q-391 | Voice | 3-engine chain failover tests | Groq->Edge->local per failure matrix | matrix tests | todo |
| Q-392 | Voice | Speaking indicator driven by playback events | Indicator reflects actual audio, not intent | renderer test | todo |
| Q-393 | Voice | Stop control for active speech | Immediate stop; queue cleared | control test | todo |
| Q-394 | Voice | Autoplay unlock path | First gesture unlocks; no silent-fail speech | interaction test | todo |
| Q-395 | Voice | Voice settings honest empty states | No-key => local voice option explained | UI test | todo |
| Q-396 | Voice | Voice test button end-to-end | Settings test speaks via current engine | integration test (mock engine) | todo |
| Q-397 | Voice | Sentence-streamed synthesis (spike) | Chunk pipeline + audio queue feasibility | spike report + prototype | todo |
| Q-398 | Voice | Sentence-streamed synthesis implementation | First sentence latency < 1.5s for long replies | latency test (mock) | todo |
| Q-399 | Voice | Voice input push-to-talk (spike) | Capture + ASR abstraction design | spike report | todo |
| Q-400 | Voice | Voice input provider abstraction | Local-first options evaluated; provider opt-in | design doc | todo |
| Q-401 | Voice | Per-companion voice profiles | Config-driven pitch/pace/engine per companion | config tests | todo |
| Q-402 | Voice | Voice chain cost accounting | TTS calls counted; logged | ledger test | todo |
| Q-403 | Voice | Offline voice path verified | No network => local engine speaks | offline test | todo |
| Q-404 | Voice | Hinglish voice rendering | en-IN voice reads mixed text naturally (fixture) | fixture test | todo |
| Q-405 | Voice | Voice docs | Chain + settings documented | docs | todo |
| Q-406 | Voice | Voice failure never blocks text reply | All engines fail => text-only + one-time note | failure test | todo |

## Phase P5 — Final polish, verification, governance

| ID | Domain | Task | Acceptance criteria | Verification | Status |
|----|--------|------|---------------------|--------------|--------|
| Q-407 | Docs & Governance | README accuracy audit vs behavior | Commands + claims verified by tests | audit notes | todo |
| Q-408 | Docs & Governance | CAPABILITY_MAP.md authored | Live/partial/planned/blocked/unverified statuses | docs | todo |
| Q-409 | Docs & Governance | BUGS_AND_FIXES.md ledger live | Discovery->fix->verified rows for this run | docs | todo |
| Q-410 | Docs & Governance | ARCHITECTURE_DECISIONS.md authored | ADRs for this run's decisions | docs | todo |
| Q-411 | Docs & Governance | FINAL_TEST_REPORT.md authored | Verified vs unverified separation | docs | todo |
| Q-412 | Docs & Governance | WORKLOG.md continuous | Every task recorded | log audit | todo |
| Q-413 | Docs & Governance | Glossary maintained | Chapter 32 terms current | docs | todo |
| Q-414 | Docs & Governance | IPC registry doc generated | Auto-generated channel table | generator script | todo |
| Q-415 | Docs & Governance | Capability registry doc generated | Auto-generated tool table | generator script | todo |
| Q-416 | Docs & Governance | Onboarding doc | New-engineer path (ch10->5->25->31) | docs | todo |
| Q-417 | Docs & Governance | Decision: docs location policy | docs/ vs root policy | ADR | todo |
| Q-418 | Docs & Governance | Docs review cadence | Phase-gate artifact sync rule | ADR | todo |
| Q-419 | Future Capabilities | Session history search backend | Query across archived sessions locally | backend tests | todo |
| Q-420 | Future Capabilities | Semantic file search design spike | Embedding store + diff index design | spike + design doc | todo |
| Q-421 | Future Capabilities | Semantic file search prototype | Fixture file found by non-verbatim description | prototype test | todo |
| Q-422 | Future Capabilities | Browser co-pilot observation spike | Extension bridge feasibility + grants | spike report | todo |
| Q-423 | Future Capabilities | Permission profiles per task shape | Shape-scoped grants generalize remembered grants | design + tests | todo |
| Q-424 | Future Capabilities | Proactive routines (user-authored) | When-X-run-Z triggers over procedure store | design doc | todo |
| Q-425 | Future Capabilities | Calendar/mail compose destination adapters (design) | Approval-grade contracts drafted | design doc | todo |
| Q-426 | Future Capabilities | Procedure export/import format | Signed bundle spec | spec | todo |
| Q-427 | Future Capabilities | Voice identity per companion | Profiles config-driven | config tests | todo |
| Q-428 | Future Capabilities | Multimodal input (clipboard image) design | Image refs enter understanding object | design doc | todo |
| Q-429 | Future Capabilities | Accessibility-tree grounding research watch | Quarterly feasibility notes | research note | todo |
| Q-430 | Future Capabilities | Cross-device presence research watch | Sync design prerequisites tracked | research note | todo |
| Q-431 | Future Capabilities | On-device model routing watch | Ollama-class routing readiness | research note | todo |
| Q-432 | Future Capabilities | Future-capability pricing template applied | Every new idea priced per Chapter 29 template | template usage | todo |
| Q-433 | Packaging & Updates | Fetch Updates conflict UX | Pop conflict surfaces honest file list + guidance | conflict fixture test | todo |
| Q-434 | Packaging & Updates | Fetch Updates needsRestart gating | Restart banner only when required | state test | todo |
| Q-435 | Packaging & Updates | Launcher npm-install idempotency audit | Repeat runs safe offline (cache miss tolerated with message) | offline launcher test | todo |
| Q-436 | Packaging & Updates | Launcher Node version check | Rejects Node < 18 with human message | version-gate test | todo |
| Q-437 | Packaging & Updates | Bundled-runtime packaging spike | electron-builder/portable feasibility + size | spike report | todo |
| Q-438 | Packaging & Updates | Installer flow spike | NSG/MSI options; shortcut + uninstall + userData preservation | spike report | todo |
| Q-439 | Packaging & Updates | Update data migration runner | Versioned readers upgrade in place | migration tests | todo |
| Q-440 | Packaging & Updates | Migration trim report | Trims report what was removed | report test | todo |
| Q-441 | Packaging & Updates | Install-desktop-trigger review | PS1 execution policy handling documented | review note | todo |
| Q-442 | Packaging & Updates | Shortcut .lnk icon refresh | Bold icon asset; refresh without reinstall | manual + script | todo |
| Q-443 | Packaging & Updates | Uninstall cleanliness checklist | What remains/removed documented for installer future | docs | todo |
| Q-444 | Packaging & Updates | Auto-update channel decision doc | Fetch Updates vs auto: ADR | ADR | todo |
| Q-445 | Packaging & Updates | Version stamp visible in Settings | Build/version shown for support | UI test | todo |
| Q-446 | Packaging & Updates | Packaging docs | Launcher contract + roadmap | docs | todo |
| Q-447 | Performance & Efficiency | Launch budget assertions in CI | Warm < 3s, first-run scan visible: asserted from log | CI smoke | todo |
| Q-448 | Performance & Efficiency | Device lookup < 50ms benchmark | p50 from benchmark harness | benchmark test | todo |
| Q-449 | Performance & Efficiency | Direct task < 1s end-to-end benchmark | open-app fixture measured | benchmark test | todo |
| Q-450 | Performance & Efficiency | Idle CPU sampling harness | Idle process CPU near zero over 5min | sampling script | todo |
| Q-451 | Performance & Efficiency | Animation loop pauses when hidden | No render work while window hidden/minimized | profiling test | todo |
| Q-452 | Performance & Efficiency | ChatLayout polling removal perf check | CPU during long chats reduced | before/after measure | todo |
| Q-453 | Performance & Efficiency | Prompt token baseline report | Tokens per chat/agent task baseline recorded | report | todo |
| Q-454 | Performance & Efficiency | Fast-path ratio metric | Deterministic share of tasks tracked over time | metric from log | todo |
| Q-455 | Performance & Efficiency | Vision call reduction via region crop | Tokens per vision call down with cropping | before/after | todo |
| Q-456 | Performance & Efficiency | Store write amplification audit | No full-file writes when only diffs changed (post-bounds) | write audit | todo |
| Q-457 | Performance & Efficiency | App-index boot load timing | Index load < 300ms warm | timing test | todo |
| Q-458 | Performance & Efficiency | Memory footprint snapshot task | Process RSS recorded at idle + during task | snapshot script | todo |
| Q-459 | Performance & Efficiency | Large-chat renderer perf | 60-message session renders + scrolls without jank checklist | manual + devtools | todo |
| Q-460 | Performance & Efficiency | Markdown render cost check | Long code blocks render within frame budget | profile | todo |
| Q-461 | Performance & Efficiency | Vite bundle audit | three.js etc. code-split or justified | bundle report | todo |
| Q-462 | Performance & Efficiency | Electron main memory audit | No leak across 20 lifecycle cycles | RSS delta test | todo |
| Q-463 | Performance & Efficiency | Startup work deferral audit | Non-essential init moved post-window | review + timing | todo |
| Q-464 | Performance & Efficiency | Network request dedup audit | No duplicate provider probes within window | request log audit | todo |
| Q-465 | Performance & Efficiency | Perf regression gate | Budget tests fail CI on regression | CI gate | todo |
| Q-466 | Performance & Efficiency | Perf docs | Budgets + instruments documented | docs | todo |
| Q-467 | Testing & CI | IPC contract checker in CI | Registry/handler/preload/usage aligned on every push | gate | todo |
| Q-468 | Testing & CI | Import-graph reachability gate | No unreachable modules | gate | todo |
| Q-469 | Testing & CI | Token/theme-literal scan gate | Literal count never grows | gate | todo |
| Q-470 | Testing & CI | Store-bounds soak suite in CI | All bounded stores asserted | suite | todo |
| Q-471 | Testing & CI | Clean-start smoke in CI | Empty-userData boot assertions | gate | todo |
| Q-472 | Testing & CI | Lifecycle matrix row: launch warm | Automated where sandbox permits | row test | todo |
| Q-473 | Testing & CI | Lifecycle matrix row: second instance | Focus assertion | row test | todo |
| Q-474 | Testing & CI | Lifecycle matrix row: close semantics | X never quits | row test | todo |
| Q-475 | Testing & CI | Lifecycle matrix row: quit path | Process exits; flush done | row test | todo |
| Q-476 | Testing & CI | Lifecycle matrix row: renderer crash | Recovery ladder | row test | todo |
| Q-477 | Testing & CI | Lifecycle matrix row: no-keys/bad-keys/offline | Calm states | row tests | todo |
| Q-478 | Testing & CI | Windows-only release checklist doc | Rows + evidence columns for release time | docs | todo |
| Q-479 | Testing & CI | Test fixtures from schemas | No hand-crafted JSON drift | fixture rule + refactor | todo |
| Q-480 | Testing & CI | Injectable clock util | Time-based tests deterministic | util + example test | todo |
| Q-481 | Testing & CI | Screen fixtures with known hashes | Vision/verify tests offline | fixture pack | todo |
| Q-482 | Testing & CI | Provider SSE recording fixtures | Offline provider behavior tests | fixture pack | todo |
| Q-483 | Testing & CI | Flaky-test quarantine policy | Flakes quarantined with issue, not ignored | policy + tooling | todo |
| Q-484 | Testing & CI | Coverage report for engine core | Understanding/planning/engine core coverage visible | coverage report | todo |
| Q-485 | Testing & CI | Contract test for preload unsubscribe closures | All on* return working unsubscribes | contract test | todo |
| Q-486 | Testing & CI | Snapshot test: diagnostics readout | Doctor/snapshot render stable shapes | snapshot test | todo |
| Q-487 | Testing & CI | CI pipeline doc | Gates documented with failure meanings | docs | todo |
| Q-488 | Testing & CI | Test naming + location convention | tests/*.test.mjs mapping to modules documented | docs | todo |
| Q-489 | Testing & CI | Mock Windows-shell harness | PowerShell-dependent paths testable via mock | harness + example | todo |
| Q-490 | Testing & CI | Headless boot smoke (xvfb) in CI | Main process boots; window created; no crash | gate (where env allows) | todo |
| Q-491 | Testing & CI | Regression test per closed bug | Every bugs-ledger fix links a test | ledger audit | todo |
| Q-492 | Testing & CI | Nightly extended soak (optional) | Bounds + lifecycle soaks run nightly | scheduled job or script | todo |

| Q-493 | Startup & Lifecycle | Fix production renderer load path (white-screen root cause) | loadFile resolved to dist-electron/dist/index.html (nonexistent); now repo dist/ — verified by headless boot smoke with zero load errors | boot smoke + ERR_FILE_NOT_FOUND absent | done (commit c8ee774) |

## Domain summary

| Domain | Tasks |
|--------|-------|
| Startup & Lifecycle | 30 |
| Screen & Computer Control | 30 |
| Execution & Verification | 27 |
| Architecture | 26 |
| Themes & UX | 26 |
| Testing & CI | 26 |
| Permissions & Security | 25 |
| Providers & Routing | 24 |
| Understanding Engine | 24 |
| IPC & Contracts | 22 |
| Memory & Stores | 22 |
| Browser & Web | 22 |
| Filesystem & OS | 20 |
| Planning | 20 |
| Performance & Efficiency | 20 |
| Companions | 18 |
| Settings | 18 |
| Procedures & Learning | 18 |
| Caching & Indexing | 16 |
| Voice | 16 |
| Future Capabilities | 14 |
| Packaging & Updates | 14 |
| Docs & Governance | 12 |
| Execution & Legacy | 1 |
| Permissions & Ledger | 1 |
| **Total** | **492** |

## Working agreement


1. **Inspect → reproduce → diagnose → plan → implement → run → test → observe → fix → retest → record.** The loop is the law.
2. **Never mark done without executed verification** (the task's own Verification column) or a documented external limitation (e.g. Windows-only path in Linux sandbox → mark `blocked(platform)`, never `done`).
3. **Dependency order within a phase:** store/util and gate tasks before the tasks that rely on them; every fix task's regression test lands in the same change.
4. **Artifacts stay synchronized:** WORKLOG.md (chronological), docs/BUGS_AND_FIXES.md (issue lifecycle), docs/ARCHITECTURE_DECISIONS.md (decisions), docs/CAPABILITY_MAP.md (status), docs/FINAL_TEST_REPORT.md (results). At each phase gate, all five are updated before the next phase begins.
5. **Contradictions resolve toward the vision:** when old and new implementations conflict, the one consistent with docs/MASTER-FUTURE-VISION.pdf stays; the other is refactored or deleted — never both kept.

