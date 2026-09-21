# Quip — Final Test Report (overnight engineering run)

> Principle: this report separates **verified** (executed and observed) from **unverified** (code-reviewed only). Nothing here claims functionality that was not actually exercised.

## 1. Static + unit verification

| Check | Command | Result |
|---|---|---|
| Electron TypeScript compile + renderer build | `npm run build` | ✅ pass (2.7-3.2s across runs) |
| Full test suite (baseline, pre-fix) | `npm test` | ✅ 425 pass / 0 fail |
| Full test suite (post-fix, incl. new regression suite) | `npm test` | ✅ **427 pass / 0 fail** |
| New: knowledge-graph bounds soak (700 upserts → ≤500, user root survives) | `tests/reliability-round-2.test.mjs` | ✅ pass |
| New: knowledge-graph debounce (no write-per-event; file lands after 2.3s) | same | ✅ pass |
| New: timeline window (500 events → ≤400, newest kept, oldest evicted) | same | ✅ pass |
| New: environment battery honesty (non-Windows ⇒ supported:false) | same | ✅ pass |
| New: IPC registry contract (SWARM_BROADCAST removed; permission/approval/set-companion declared) | same | ✅ pass |

## 2. Runtime verification — headless boot smoke (the sandbox stand-in for Windows first-run)

**Method:** fresh `userData` temp dir, `xvfb` display, local electron binary (`./node_modules/.bin/electron . --no-sandbox`), production build, 15s observation window, stdout/stderr captured. Script: `scripts/boot-smoke.sh` (repo-adjacent copy noted in worklog).

| Assertion | Result |
|---|---|
| Process alive after 15s on a clean user-data dir | ✅ |
| First-run stores created (device-profile, knowledge-graph, device-index, world-model, proactive, …) | ✅ 6 JSON stores |
| **Pre-fix finding:** `ERR_FILE_NOT_FOUND` for the renderer (production load path) | ❌ reproduced → ✅ **fixed & gone** (post-fix log has zero load errors) |
| Renderer loads from `dist/` in production | ✅ (no `Failed to load URL` after fix) |
| dbus/GPU/xvfb noise lines | ignored (sandbox-only, not app errors) |

**What this proves:** the main process boots end-to-end with the restructured startup (window-first), the first-run scan executes and writes its stores, and — the run's headline find — the production renderer path now resolves. **What it cannot prove:** pixel-level rendering, sprite visibility, and Windows-only shell behavior (§4).

## 3. Regression coverage added this run

- `tests/reliability-round-2.test.mjs` — 6 checks pinning the fixes (bounds, debounce, honesty, registry).
- Every P0 fix is traceable: BACKLOG `done` rows → BUGS_AND_FIXES F-01…F-21 → commit `c8ee774`.

## 4. Explicitly unverified (environment limitations — not assumed working)

| Area | Why unverified | Owner |
|---|---|---|
| Windows desktop shortcut (.lnk via PowerShell), tray icon rendering, taskbar behavior | No Windows shell in sandbox | Windows release checklist |
| Screen capture + vision on real hardware | Capture uses Windows PowerShell path | Windows release checklist |
| TTS audio output (Groq/Edge/local voices) | No audio device / network voices in sandbox | Windows release checklist |
| Live provider end-to-end calls (real keys, real endpoints) | No keys in the audit environment | Provider contract tests stand in |
| Full GUI interaction (tap-to-panel, drag, mode transitions on screen) | No display beyond xvfb smoke | Manual pass on first Windows run |
| Long-horizon store growth (weeks of real usage) | Soaks are accelerated, not calendar-time | Diagnostics snapshot (P2) |

## 5. Baseline integrity at commit `c8ee774`

- Build: green. Tests: **427/0**. Stores: bounded per contract. Boot smoke: clean.
- Artifacts synchronized: CODEBASE_AUDIT (findings), BUGS_AND_FIXES (lifecycle), ARCHITECTURE_DECISIONS (ADRs 001-010), CAPABILITY_MAP (statuses), BACKLOG (37 rows marked done + Q-493 added), MASTER-FUTURE-VISION.pdf (source of truth).

## 6. Recommended next verification (on the user's Windows machine)

1. `git pull` → double-click `run-quip.cmd` → companion appears within seconds (warm) or scan is visible (first run).
2. Settings → Desktop: toggle "Ask before actions" → open an app by asking → confirm Smart mode runs it without asking, Ask-everything prompts.
3. Ask "open VS Code" → confirm the installed app opens (trust line names why) — this exercises the fixed production path end-to-end on real hardware.
4. Weekly Reflection (if prompted) → confirm real numbers, tap a feedback button.
5. X the chat panel → companion stays; Settings → Quit Quip → process exits.
