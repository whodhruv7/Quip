# Quip — Final Engineering Report (§43)

**Round:** Head Brain V1 + Action Engine V1 + Hardening
**Commit:** `a17a06c` (this round) · prior: `b7bcd3b` Head Brain, `645e561` connectivity
**Test status:** 372 / 372 passing · tsc (electron, frontend, tests) clean · vite build 2.74s · routing 79/79 · IPC audit 0 broken · secret scan clean

---

## 1. System Architecture

Quip is an Electron + Vite + React desktop companion with a strictly layered execution spine. Every user message travels one path, and no layer may skip the one above it:

```
USER MESSAGE
  → Head Brain (electron/brain/)        understanding only — never touches the OS
      references → intents → objects → classification → goal
  → Planner (brain/planner.ts)          Goal → steps → per-step verify.expect → risk
  → Permission Manager (engine/permission-modes.ts)
  → Action Engine (electron/actions/)   validate → execute → timeout → recover → log
  → Device layer (engine/tool-registry.ts + desktop-controller/system-control/browser-automation)
  → OS
```

The understanding layer is provider-independent: it performs zero model calls, and swapping the LLM changes nothing about how a command is understood. The 52 device executors remain the only code that reaches the OS. The orchestrator (deterministic → model-assist → agent tool-loop → chat) continues to execute *agent-tier* goals; direct plans now execute through the Action Engine.

## 2. Understanding Engine (Head Brain)

Every message becomes a structured understanding object: primary/secondary/hidden intents with confidence, typed objects (app/file/song/website/folder), classification (chat / question / simple_action / workflow), a goal, and an explanation trail. Pronoun resolution ("close it", "play another one", "do it again", "the file I just opened") draws on conversation memory, the execution context, and the device index — this round extended it to "play it **again**" (pronoun + trailing again). Clarification is a first-class outcome: when the target is ambiguous the brain asks ONE question instead of guessing, and an unresolved pronoun is reported, never silently defaulted. The deterministic path completes in single-digit milliseconds.

## 3. Action Engine (this round's core)

`electron/actions/` is the unified execution API:

- **contracts.ts** — every one of the 54 contracted actions carries name, purpose, required inputs, timeout, expected result, honest failure states, and a verification method. §19 safety classes: `READ` (observe), `WRITE` (change state), `DESTRUCTIVE` (delete/kill/send/shell — always confirmed), `EXTERNAL` (crosses the network). `file_op` is params-aware (delete → DESTRUCTIVE, read → READ).
- **engine.ts** — executes planner steps: §20 validation (unknown action or missing required input is *refused*, never guessed) → permission gate → timeout-wrapped `executeTool` → bounded recovery → one structured log entry per attempt. `success` is derived ONLY from verified steps — there is no hardcoded success anywhere in the engine.
- **execution-log.ts** — ring of 250 entries (`task, step, action, safety, risk, mode, attempt, duration, ok, summary, evidence, failureKind, paramsDigest`); raw params are digested, never stored; subscribable; debounced persistence to `userData/quip-actions.json`; exposed via `GET_ACTION_LOG` IPC.
- **recovery.ts** — deterministic failure classification (timeout / cancelled / permission / not-found / transient / fatal) with bounded strategies: idempotent actions retry once with backoff, not-found gets one re-observe, input-injecting actions never retry, declined permission is final.

## 4. Device Knowledge Layer

One-time device scan builds a persistent index (installed apps, browsers, workspaces, repos); rescans merge only the diff; in-memory lookups are sub-50ms. `invalidateAppIndex()` provides a single rescan entry point so no stale index survives a refresh. The brain consumes the index for app resolution — an installed app is resolved locally and never falls back to a web search (§5), and file resolution never fabricates paths (§6): unmatched targets are reported honestly.

## 5. Reliability & Recovery

The 11-state task machine (§22) is enforced by a strict transition table; illegal transitions throw. This round the machine is driven by REAL engine events through a hub observer — `WAITING_FOR_PERMISSION` appears in the trace exactly when a gate opens, `RECOVERING` exactly when a retry/re-observe starts, `OBSERVING`/`VERIFYING` exactly when the engine reads or checks. A settlement helper routes to terminal states without ever throwing. Cancellation (§17) is honored between steps with an honest "Stopped — completed X of Y" summary. Timeouts become honest failures, not silent hangs.

## 6. Performance

Budgets and current behavior: intent classification <100ms (deterministic, single-digit ms typical), device lookup <50ms (in-memory index), app lookup <20ms (cached index), plan build <100ms (direct mapping), simple command end-to-end well under 1s when the device layer responds. The LLM is touched only by the pre-existing tiers gated behind genuine ambiguity (model-assist, agent loop, vision). Provider networking retains the circuit breaker (2 consecutive failures → parked with doubling backoff, 429 Retry-After honored immediately), 12s connect timeout, 25s SSE stall watchdog, and 6-provider failover ending in offline Ollama.

## 7. Security & Permissions

Three modes — Ask Every Time (per medium/dangerous step), Approve Task (one plan-level approval), Full Access (only dangerous asks) — with identical execution logic; only the approval flow differs. Dangerous actions are confirmed in EVERY mode. Compound risks are params-aware (`file_op: delete`). Shell runs with a 20s cap, 1MB output cap, and a catastrophic deny-list. All web access passes the SSRF safe-URL gate. The chosen mode now persists across restarts (`QUIP_PERMISSION_MODE` in userData/.env, restored at boot, §29).

## 8. Observability

Per-task lifecycle traces (`[brain]` + trace dump), the structured action log (per-attempt evidence), the provider connection journal (ring of 80 with latency + honest reason), and the Doctor (real network-path probe, per-provider 1-token probes, TTS states, env-conflict warnings) give a complete evidence trail for any "what happened" question.

## 9. UI / UX (§29)

Exactly 6 companions (Pix, Kai, Ren, Bubbles, Capy, Skales) with only the selected one visible; one window factory gives every companion window the full lifecycle guarantees. State reactions are honest: IDLE / THINKING / RESPONDING / PLANNING / OBSERVING / VERIFYING / WORKING / WAITING / SUCCESS / ERROR / CANCELLED map to real phases — including the new `waiting_permission → waiting sway` and `recovering → observing` mappings. Clicking the companion toggles the side panel. Action buttons are square (7–10px radii); avatar dots stay circular by design. Approval requests always surface visually.

## 10. Test Matrix (§38)

372 tests across 16 suites. This round added 33 in `action-engine.test.mjs`: §19 class matrix (incl. compound file_op), contract completeness (every executor ↔ contract), §20 refusal matrix, recovery classification + decisions (cancelled/declined never retry; one retry for idempotent timeouts; one re-observe for not-found), engine flows per permission mode (ask/decline/approve-plan/double-ask guard), malformed-step refusal, cancellation, structured-log evidence + params digesting, §38 gap groups KEYBOARD / MOUSE / BROWSER / YOUTUBE / CONTEXT / SAFETY, hub integration (engine-path lifecycle trace with WAITING_FOR_PERMISSION→EXECUTING→VERIFYING→COMPLETED), and byte-level checks that the new honest phases exist in shared types.

## 11. Refinement & Review Passes (§40)

Four passes were executed on the new code: (1) architecture/type pass — fixed top-level vs singleton imports, stored-entry typing in the log; (2) semantics pass — found and fixed declined steps being re-executed in the main loop, and the every-step-declined early return; (3) integration pass — verified the approval flow reaches the same renderer path as the orchestrator, and phase unions were extended at every layer (shared.ts, hub, tasks.ts, App.tsx) with the renderer mapping; (4) honesty pass — summary composition, dangling-executor semantics documented, test-suite determinism (removed a keep-alive timer).

## 12. Known Limitations (honest)

Sandbox verification cannot click real Windows apps: device primitives are exercised via verified logic and the user's laptop reports real status through the Doctor and self-check. YouTube playback verification observes browser window titles — it says "press play once if it didn't start" rather than claiming playback it cannot see. Screen-vision coordinate accuracy is vision-model-limited. TTS remains Groq playai (English/Arabic) → Edge Neerja (Hinglish, unofficial) → Windows SAPI; Edge can be re-blocked by Microsoft at any time. Groq free-tier TPM still constrains long agent-loop turns.

## 13. Deployment Notes

`git pull` → `run-quip.cmd` (npx-based launcher). First run: Settings → AI Brain → paste a Groq key (30s wizard) → Run checkup. Permission mode lives in Settings → General and persists. The action log is on disk at `userData/quip-actions.json` and via the new `getActionLog` bridge.

## 14. Definition of Done — mapping

Understanding before action (§1/2) ✔ pipeline enforced · Zero random execution (§2) ✔ contract refusal + tests · References/context (§3) ✔ incl. "play it again" · App resolver honesty (§5) ✔ · File honesty (§6) ✔ · Screen loop (§8) ✔ screen-vision with post-verify · Reach split (§11) ✔ readers vs device control · YouTube verification (§12) ✔ search→understand→open→observe, honest unconfirmed state · attempted ≠ successful (§14) ✔ engine-derived success + tests · Recovery (§15-17) ✔ bounded, classified, cancellable · Safety classes (§19) ✔ · Execution-layer authority (§20) ✔ · State machine (§22) ✔ driven by real events · 6 companions + honest states + square buttons + persistence (§29) ✔ · Skales capability-only (§30) ✔ · Dead code (§36) ✔ atlas/study/quiz absent, palade templates removed · Test matrix (§38) ✔ · Refinement passes (§40) ✔ ×4 · Full-system checks (§41) ✔ ×3 · Never fake success (§42) ✔ audited, zero ungated success paths.
