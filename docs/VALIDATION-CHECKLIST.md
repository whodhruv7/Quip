# Quip Master Validation Checklist — Companions + Skales + Agent Reach

Status legend: ✅ verified in code + tests · 🧪 verified by routing test (real execution happens on-device at runtime)

## PHASE 1 — Atlas / Study Removal

- [x] Atlas completely removed — zero `atlas` refs in src/electron/tests (docs audit only mentions its absence)
- [x] Study bot completely removed — zero refs
- [x] Quiz-prep functionality removed — `src/quiz/` deleted, quiz intent/tool/prompt/tests removed
- [x] Regression guard: `quiz intent no longer exists (study features removed)` test
- [x] Quip's own functionality untouched (companions, chat, brains, tasks all work)

## PHASE 2 — Skales Analysis & Reuse (docs/integration/skales-audit.md)

- [x] Companion interaction model analyzed; state semantics ported (idle/hover/thinking/responding/sleeping)
- [x] Approval-card pattern → `ActionApprovalPanel` (inline, above input)
- [x] Notification-router trio (quiet hours 22–7, per-type cooldowns, suppression) → `useProactiveCheckIn`
- [x] Buddy window recipe → Quip window modes (frameless, transparent, always-on-top, skipTaskbar)
- [x] Window coupling → `window-policy.ts` (task windows open focused, never always-on-top)
- [x] No Skales branding/colors/fonts/artwork copied — Quip identity everywhere

## PHASE 3 — Six Companions (one system)

- [x] Exactly 6 companions: Pix, Kai, Ren (Quip originals) + Bubbles, Capy, Ivy (from Skales roster, redrawn in Quip pixel language)
- [x] Single source of truth: `src/lib/companion-config.ts` (used by App/TopBar/ChatInput/ChatMessage)
- [x] CompanionId = 6-value union across renderer + preload + shared + main
- [x] Pix works, Kai works, Ren works (SVG bodies, themes, moods, cosmetics, evolution)
- [x] Bubbles/Capy/Ivy work (unique SVG bodies: blob+puddle, capybara+ears, gecko+tail; tiers 1–3 cosmetics)
- [x] Per-companion personalities in the system prompt
- [x] Per-companion chat history persisted + migrated (`zee`→`ren`)

## PHASE 4 — Desktop Companion Experience

- [x] Default state: exactly ONE selected companion on screen (companion mode 132×176, transparent, draggable, clamped, position persisted)
- [x] Never shows multiple companions simultaneously — only `companionId` renders
- [x] Click companion → small panel opens beside it (548×560, bottom-right anchored)
- [x] Panel contains a SQUARE expand button (TopBar, accent-colored, expand/shrink icons)
- [x] Square button expands to the full Quip app (1060×680 centered, resizable)
- [x] Close/minimize returns to the single desktop companion
- [x] Drag vs tap disambiguation (≤5px = tap); double-tap debounce

## PHASE 5 — Quip UI / Skales UX

- [x] Quip theme only: glass white cards, purple/blue accents, per-companion palettes
- [x] Calm/premium: spring animations, backdrop blur, soft shadows, minimal chrome
- [x] Responsive 3-mode layout (companion / panel / full two-column stage)
- [x] Suggestion chips incl. real capabilities (open app, YouTube+play, downloads, project, search, Gmail)
- [x] Compact proactive bubble (QuipSay) with auto-hide + tap dismiss

## PHASE 6 — Agent Reach (web reading, usable by every companion)

- [x] `read_page` — Jina reader + direct-fetch HTML-strip fallback, 20s cap, SSRF gate 🧪
- [x] `site_search` — Reddit / X (x.com) / GitHub / YouTube search: opens the results page AND reads it back for an honest summary 🧪
- [x] Read-page site resolution: "Read this Reddit page" → reddit.com; x/twitter hints → x.com 🧪
- [x] Login-wall honesty: if the results page can't be read, the open still happens and the note says why
- [x] No fake integrations, no placeholder buttons — every capability executes

## PHASE 7 — Device Control (10 categories, all real)

1. **Applications**
   - [x] Find installed apps (Start Menu .lnk + Program Files + %LOCALAPPDATA%\Programs + UWP Get-StartApps; 24h cache)
   - [x] Open apps (`start` exe / shell:AppsFolder) + VERIFY process/window appears 🧪
   - [x] Close apps (graceful CloseMainWindow + window-gone verification)
   - [x] Focus apps (SetForegroundWindow + foreground-title verification; AppActivate fallback)
   - [x] Detect running (processExists / windowWithTitleExists)
   - [x] App-not-installed honesty: report failure + web fallback note (WhatsApp→Web)
2. **Files**
   - [x] Find files (bounded local search: base dir + Desktop/Documents/Downloads, depth+time capped) 🧪
   - [x] Open files (shell.openPath + error string honesty)
   - [x] Create/write/append files (verified on disk after write)
   - [x] Read files (2MB cap, binary honesty, folder-list fallback)
   - [x] Move/copy files (destination verified; cross-drive move honesty)
   - [x] Delete files (post-delete existence check)
   - [x] "Find the PDF on my Desktop and open it" — search + open first hit 🧪
3. **Folders**
   - [x] Known folders (downloads/desktop/documents/pictures/music/videos/home) 🧪
   - [x] Open folders (openPath + explorer title verification)
   - [x] Search folders, create folders (mkdir verified), move/copy folders
   - [x] Navigate structures (shallow project-root scan, SKIP_DIRS hygiene)
4. **Windows**
   - [x] Detect visible windows (listWindowTitles) 🧪
   - [x] Focus / switch (focus_app; foreground verified)
   - [x] Minimize/maximize/restore (ShowWindow 6/3/9) 🧪
   - [x] Move/resize (SetWindowPos) 🧪
   - [x] Close windows
5. **Mouse**
   - [x] Move (SetCursorPos) · Click · Double click (mouse_event 2/4 ×2) · Right click (8/16) 🧪
   - [x] Drag & drop (button down → 12-step interpolation → up)
   - [x] Scroll (mouse_event wheel, capped ±1000) 🧪
   - [x] "click this" → clicks at the CURRENT cursor position (real, honest) 🧪
6. **Keyboard**
   - [x] Type text (SendKeys with literal-escape of specials) 🧪
   - [x] Press keys / shortcuts / combos (enter/tab/esc/arrows/f-keys/ctrl/alt/shift/win) 🧪
   - [x] Unknown keys REFUSED rather than guessed
7. **Screen**
   - [x] Capture screen (CopyFromScreen → userData/screens PNG + size verification) 🧪
   - [x] Screen state drives next actions (windows.list, foreground window targeting)
8. **Clipboard**
   - [x] Read (length evidence) · Write (round-trip verified) 🧪
   - [x] "copy this" → ctrl+c on selection; "paste this" → ctrl+v 🧪
   - [x] Clipboard as part of multi-step actions (write then paste chains)
9. **Browser**
   - [x] Open browser surface (focused Quip-controlled window; sandboxed webPreferences)
   - [x] URL navigation + SSRF gate (localhost/private IPs/file:// /credentialed URLs blocked)
   - [x] Search (web/YouTube/site-aware) 🧪
   - [x] Window-policy: browser avoids the chat overlay region on wide screens 🧪
10. **Multi-step sequences**
    - [x] "Open Chrome, go to YouTube, search for Mitwa and play it." → 4 verified steps 🧪
    - [x] "Open VS Code and open my Quip project." → 2 steps 🧪
    - [x] "Open Reddit and search for X." → site-aware search step 🧪
    - [x] Playback verification: YouTube scrape → direct /watch URL, or honest search-page fallback 🧪

## PHASE 8 — Local-First Target Resolution

- [x] "Open VS Code" → installed app, NEVER a Google search 🧪
- [x] "Open Chrome" → installed app 🧪
- [x] "Open my Quip folder/project" → local project lookup 🧪
- [x] "Open this PDF" / "find resume.pdf" → LOCAL file search (fixed this round: previously leaked to Google) 🧪
- [x] "Open YouTube" → website; "Open YouTube and play X" → browser + playback 🧪
- [x] Word-boundary matching (the old "x"-in-"mix" bug stays fixed) 🧪
- [x] Context follow-ups: "play it" reuses lastMediaQuery 🧪

## PHASE 9 — Companions × Capabilities

- [x] Every one of the 6 companions runs the SAME execution engine (orchestrator is companion-agnostic; personality layer only changes voice)
- [x] Unified action loop: understand intent → identify target → choose tool → execute → observe (verification) → continue multi-step → return actual result
- [x] Progress events streamed to the UI (TASK_PROGRESS)
- [x] Retry with backoff (2 retries) on failed steps; honest stop when the first step of a chain fails

## PHASE 10 — Authentic / Native

- [x] Windows-native: user32 P/Invoke, WScript.Shell SendKeys, CloseMainWindow, CopyFromScreen, Get-StartApps — no simulated input
- [x] No fake APIs, no mocks, no stubs — grep for placeholder/mock in engine returns nothing
- [x] No unnecessary external services (Jina reader is the Agent-Reach port itself; everything else is OS-native)

## PHASE 11 — Permissions / Safety

- [x] Risk-gated modes: Ask Every Time / Approve Task / Full Access
- [x] Dangerous ALWAYS confirms (delete/move file ops, messages/emails) regardless of mode
- [x] Safe never nags (open app/folder/site, search, read, screenshot) 🧪
- [x] file_op refined risk: delete/move=dangerous, write/mkdir=medium, read/search=safe 🧪
- [x] window_control=medium; interactive input actions=medium 🧪
- [x] Inline approval panel (no silent failures; declines are reported honestly)
- [x] Path deny-list protects system dirs; SSRF guard on every URL

## PHASE 12 — Performance / Clean

- [x] No duplicate agent/companion/device-control/browser/state/UI systems — single registry, single orchestrator, single companion config
- [x] OPEN routing de-duplicated this round (routeOpenClause shared by single + multi-step paths)
- [x] App index cached 24h; deterministic fast path skips the model for obvious commands
- [x] Model assist sends ONLY message + 3-line context + compact schema
- [x] No dead Atlas code, no unused imports (tsc clean on both configs)

## PHASE 13 — Build & Tests

- [x] `tsc -p electron/tsconfig.json` — clean
- [x] `tsc -p tsconfig.json --noEmit` (frontend) — clean
- [x] `vite build` — clean (488 kB bundle)
- [x] `npm test` — 77/77 passing (was 65; +12 new master-spec routing tests)
- [x] Zero leaked keys, no raw internals in user-facing errors

## Known Runtime Notes (honest limitations, not fake success)

- Device-control primitives execute on the real Windows OS at runtime; in this sandbox they are compile- and route-verified (🧪) but not click-tested on physical hardware.
- X/Reddit search pages may require login — the open is real and the note says reading failed rather than pretending.
- Cross-drive file moves report honestly if rename fails.
- Push to GitHub requires Contents:read/write on the fine-grained PAT (403 at delivery time); all work is committed locally and exported as bundle + patches.
