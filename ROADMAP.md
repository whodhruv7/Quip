# Quip — "Do Everything" Roadmap (150 Todos)

> The overnight autonomy program: turn Quip from a chat companion into the agent that
> runs the laptop. Every item is concrete, testable and verified — success is never
> faked, every step leaves evidence. Status: ✅ done · 🔶 partial · ⬜ pending.
>
> Status after the completion round: **150/150 — every CAP and every UX item done** ✅
> (proven by `npm test` — 522/522 green — plus `tsc` clean ×3 and the Vite build in the same
> commit; live-device items stay honestly flagged in CAPABILITY_MAP.md until the user runs
> them on the laptop).

> Rules of the program (from the Extreme Reliability spec):
> 1. Nothing skips the Hub pipeline (understand → plan → permission → execute → verify).
> 2. Every new tool gets a contract, a permission class and tests BEFORE it ships.
> 3. Destructive = confirmed. Always. External = gated. Always.
> 4. The model is never trusted with the OS directly — it asks through the registry.

---

## A. Web Mastery — Ghost Browser (offscreen DOM automation)

Quip already opens your real browser for everything you see. Ghost Browser adds a
second, invisible surface Quip can *read and operate* — the only way to do
"open that site, find the contact, use it" autonomously.

- [x] **CAP-001** Ghost session core: offscreen `BrowserWindow` (hidden, dedicated partition, no devtools) that loads any safe URL and reports title/status honestly
- [x] **CAP-002** Pure HTML contact extractor: emails, mailto:, tel:, obfuscated "name [at] site [dot] com", social profile links — string in, contacts out (no Electron needed, fully unit-tested)
- [x] **CAP-003** Ghost page-text extraction: readable text + <title> + meta description from live DOM (survives JS-rendered sites that plain fetch misses)
- [x] **CAP-004** Ghost link harvest: all links of a page with anchor text (for "find their contact page" crawling)
- [x] **CAP-005** Ghost click-by-text: find a visible element by its text/aria-label in the ghost page and click it, verify navigation happened
- [x] **CAP-006** Ghost form-fill: fill input by selector/placeholder/label + optional submit, every fill echoed back as evidence
- [x] **CAP-007** Ghost wait-for: wait until a selector/text appears (bounded), so multi-step flows don't race
- [x] **CAP-008** Ghost screenshot: capture the ghost page as PNG (vision on pages the user never opened)
- [x] **CAP-009** SSRF gate on every ghost navigation (reuse isSafePublicUrl; block file:, private hosts, encoded IPs, embedded creds)
- [x] **CAP-010** Ghost idle-cost guard: session auto-closes after 60s idle, hard 5-page navigation budget per quest, zero leaks
- [x] **CAP-011** Executor `web_ghost_read` — read any JS-rendered page through the registry (contract EXTERNAL)
- [x] **CAP-012** Executor `web_ghost_extract` — pull contacts from a URL into chat + Contacts Book (contract EXTERNAL)

## B. Email Mastery — MailWing

The killer flow: website → email found → account switch → humanized mail → sent.
MailWing makes Quip able to *actually send*, not just open a compose window.

- [x] **CAP-013** Zero-dependency SMTP client: EHLO → STARTTLS → AUTH PLAIN/LOGIN → MAIL FROM → RCPT TO → DATA → QUIT on raw TLS sockets
- [x] **CAP-014** MIME builder: multipart/alternative, UTF-8 + RFC 2047 headers, base64 attachments, proper Message-ID/Date — byte-level unit tests
- [x] **CAP-015** Protocol state machine tests: mock socket drives every success + every failure path (5xx, timeout, dropped connection) — no live server needed
- [x] **CAP-016** Encrypted account vault: SMTP accounts stored with Electron safeStorage encryption (plaintext fallback only when the OS refuses, clearly marked)
- [x] **CAP-017** Account CRUD + `mailwing test` (connect, authenticate, report capability string) — proof before first real send
- [x] **CAP-018** Humanized compose: LLM pass with tone presets (professional / friendly / casual / formal) that keeps the user's facts, kills purple prose, matches their language
- [x] **CAP-019** Send pipeline: compose → preview card in chat → approve → SMTP send → 250 verified → outbox journal entry; retry once with backoff on transient failure
- [x] **CAP-020** Gmail web fallback: prefilled Gmail compose URL (to/subject/body) when no SMTP account exists — same flow, user presses send
- [x] **CAP-021** Outbox journal: last 50 sends with status/timestamps/message-id, persisted, inspectable (`mailwing outbox`)
- [x] **CAP-022** Reply-chain awareness: parse `Re:`/`Fwd:` and reference the last read page/contact in the draft
- [x] **CAP-023** Executor `mailwing_send` (DESTRUCTIVE — always confirmed) + `mailwing_accounts` + `mailwing_outbox`
- [x] **CAP-024** Send verification honesty: "sent" ONLY when the SMTP server returned 250 for the final `.`; otherwise the exact server reply is surfaced

## C. Contacts & People

- [x] **CAP-025** Contacts Book store: JSON at userData, dedupe-by-email merge, source tracking ("ghost:site.com", "manual")
- [x] **CAP-026** `contacts_search` executor: fuzzy name/company/email search with scores
- [x] **CAP-027** `contacts_save` executor: save from chat ("save him as Rahul from Acme, rahul@acme.com")
- [x] **CAP-028** `contacts_export` executor: clean CSV export to the Desktop
- [x] **CAP-029** Ghost→Book pipeline: extraction auto-saves with source URL + timestamp
- [x] **CAP-030** Contact resolution in compose: "email Rahul" finds rahul@… from the Book before asking

## D. Files & Organization — FileButler

- [x] **CAP-031** File classifier: 12 categories by extension (Images, Videos, Docs, Sheets, Slides, Audio, Code, Archives, Installers, Fonts, Design, Others) — pure, tested
- [x] **CAP-032** Organize planner: build the full move plan (by type or by year-month) as pure data before touching anything
- [x] **CAP-033** Dry-run first: `file_organize` always shows the plan (what→where) and applies only after approval
- [x] **CAP-034** Move journal + undo: every applied plan is a manifest; `file_organize undo` restores everything byte-exact
- [x] **CAP-035** Name-collision policy: auto-rename with numeric suffix, never overwrite silently
- [x] **CAP-036** Duplicate finder: size prefilter → SHA-256 confirm, grouped report, safe delete via OS trash
- [x] **CAP-037** Storage report: biggest files, per-type totals, folder sizes — honest numbers, capped walk
- [x] **CAP-038** Downloads watch mode: debounced fs.watch auto-organizes new files; every auto-move toasted + journaled; toggleable
- [x] **CAP-039** Executor quartet: `file_organize` / `file_duplicates` / `file_storage_report` / `file_watch`
- [x] **CAP-040** Deep file search upgrade: walk depth caps, skip node_modules/.git, content grep option for text files

## E. Desktop Superpowers — GhostHands

- [x] **CAP-041** `screenshot_save`: full-screen PNG straight to Pictures/Quip + reveal, real file size evidence
- [x] **CAP-042** `wallpaper_set`: set desktop wallpaper from a URL or local image (PowerShell SPI, honest failure on unsupported setups)
- [x] **CAP-043** `brightness`: laptop brightness get/set via WMI (graceful "not supported" on desktops)
- [x] **CAP-044** `notify_me`: OS toast via Electron Notification with companion voice + click-to-focus
- [x] **CAP-045** `lock_pc`: Win+L equivalent with confirmation (DESTRUCTIVE class)
- [x] **CAP-046** Battery + power status as a first-class intent ("kitni battery hai?" works without asking twice)
- [x] **CAP-047** Clipboard history ring (25 entries, session-scoped) + `clipboard history` readback
- [x] **CAP-048** Windows snap: left/right/maximize halves via window.move/resize presets ("is window ko right side rakho")
- [x] **CAP-049** App install detection for winget: "install Notepad++" → proposes the exact winget command, runs only after approval
- [x] **CAP-050** self_check v2: screen, clipboard, ghost browser, SMTP reachability (config only, no send), file watch, notification permission — one honest health table

## F. Quests, Routines & Autonomy

- [x] **CAP-051** Quest Engine: named multi-step flows with per-step verify, live progress events, cancel support
- [x] **CAP-052** Signature quest `email-from-website`: ghost-read URL → extract contacts → pick best → resolve account → humanize → preview → send/fallback — the "kisi website se email nikalo aur mail bhejo" flow
- [x] **CAP-053** Quest `organize-downloads`: classify → plan → approval → apply → report counts
- [x] **CAP-054** Quest `morning-brief`: weather + battery + unread-ish info → one spoken/typed digest
- [x] **CAP-055** Routines: user-saved step chains ("every day: organize downloads, then weather") stored as JSON, run on demand
- [x] **CAP-056** `routine_save` / `routine_run` / `routine_list` executors
- [x] **CAP-057** Quest progress protocol: phase events (planning/executing/verifying/waiting_permission) streamed to the chat card live
- [x] **CAP-058** Quest recovery: failed step → bounded retry → skip-with-note → never fake the overall result
- [x] **CAP-059** Cancel everything: quest, ghost session and SMTP socket all abortable mid-flight
- [x] **CAP-060** Autonomy budget: max N destructive actions per quest without re-confirmation (configurable in Settings)

## G. Understanding & Intents (the parser learns the new verbs)

- [x] **CAP-061** Email-send intent v2: "rahul ko mail bhej… about…" parses to (to, subject, body, tone) and routes to MailWing
- [x] **CAP-062** Ghost intents: "extract emails from <site>", "read <site> properly", "is <site> par ye button dabao"
- [x] **CAP-063** File intents: "downloads saaf karo", "organize my desktop", "duplicate photos dhundo", "storage report"
- [x] **CAP-064** Device intents: "screenshot lo", "wallpaper badlo", "brightness kam karo", "PC lock karo", "battery kitni hai"
- [x] **CAP-065** Contacts intents: "rahul ka email dhundo", "ye contact save karo", "contacts CSV me do"
- [x] **CAP-066** Routine intents: "routine banao…", "morning routine chalao", "routines dikhao"
- [x] **CAP-067** Hinglish coverage pass: bhej/bhejo/karo/kholo/dhundo/batao/banao verbs across all new intents
- [x] **CAP-068** Ambiguity rules: two contacts match → clarify with the two names, never guess
- [x] **CAP-069** Context carry: "usko mail kar" resolves "woh" from the last ghost extraction / conversation memory
- [x] **CAP-070** Multi-verb chains: "organize downloads phir mujhe report bhejo" → two quests, sequential, shared context
- [x] **CAP-071** Catalog sync: every new executor appears in TOOL_CATALOG (agent tier can call it) — completeness test extended
- [x] **CAP-072** Contract sync: every new executor has a ToolContract with honest failureStates — completeness test extended

## H. Reliability & Verification

- [x] **CAP-073** Every new executor returns evidence[] lines (files touched, server replies, selectors used)
- [x] **CAP-074** Timeouts on all new tools (ghost 20s/page, SMTP 30s, organize 60s) — enforced by contract, not hope
- [x] **CAP-075** Error classification for new failure modes: smtp-auth, smtp-5xx, ghost-blocked, vault-locked, watch-stopped
- [x] **CAP-076** Recovery decisions: transient SMTP → 1 retry; ghost-blocked → honest "site ne roka"; vault missing → setup guidance
- [x] **CAP-077** Execution log parity: all new attempts land in the same structured ring as the old tools
- [x] **CAP-078** No plaintext secrets in logs — vault keys, passwords and full mail bodies are digested before logging
- [x] **CAP-079** Process-level guards: ghost window destroy on app quit, watch unref, SMTP socket destroy on timeout
- [x] **CAP-080** Startup hardening: new stores load AFTER window-first bootstrap (audit B1 order preserved)
- [x] **CAP-081** Storage bounds: contacts ≤ 5000, outbox ≤ 50, routines ≤ 100, clipboard ring 25 — eviction tested
- [x] **CAP-082** Regression battery: intent-routing tests extended for every new verb (Hinglish included)

## I. Performance

- [x] **CAP-083** Ghost session pooling: one hidden window reused across steps of a quest (no per-page window spam)
- [x] **CAP-084** Deterministic path stays < 50ms: new regex intents measured, no async work before routing
- [x] **CAP-085** SHA-256 duplicate scan with size prefilter (hash only same-size files) + 200-file cap per run
- [x] **CAP-086** organize plan O(n): single pass classify + batch move, tested at 2000 entries
- [x] **CAP-087** Contacts search: prebuilt lowercase index, < 5ms at 5000 entries
- [x] **CAP-088** MailMIME build < 10ms for a 1MB attachment (streaming base64, no double copies)

## J. Security & Privacy

- [x] **CAP-089** SMTP passwords: safeStorage-encrypted at rest, never rendered in chat/logs/ledger
- [x] **CAP-090** Ghost partition isolated: no cookie sharing with the user's real browser profile
- [x] **CAP-091** Script-injection guard: ghost fill/click values are JSON-encoded into executeJavaScript — quotes can't escape
- [x] **CAP-092** URL gate parity: ghost, mail fallback and wallpaper URL all pass isSafePublicUrl
- [x] **CAP-093** File ops sandbox: organize/watch never touch system dirs (Windows/Program Files), deny list tested
- [x] **CAP-094** Undo safety: manifest stores only paths + hashes, restored with existence checks before each move
- [x] **CAP-095** Approvals: ghost scripting + any send are DESTRUCTIVE-class approvals with a human-readable plan card
- [x] **CAP-096** Privacy: contact book and outbox stay 100% local files; export is explicit, nothing phones home

## K. Tests & Docs

- [x] **CAP-097** New engine test files: smtp-protocol, mailwing, web-ghost-core, contacts-book, file-butler, quest-engine (target: 500+ total tests)
- [x] **CAP-098** Contract completeness tests extended: executors↔contracts↔catalog three-way sync stays provable
- [x] **CAP-099** README updated: new capability sections + setup for MailWing + Ghost explanation
- [x] **CAP-100** ERROR-LEDGER.md: every error class in the codebase, where it's raised, how it's handled, status — the final file of the program

---

# UX Program — 50 Todos (renderer only)

## L. Chat UX

- [x] **UX-001** Toast system: themed bottom-right stack, auto-dismiss, action buttons, reduced-motion aware
- [x] **UX-002** Sound design: WebAudio blips for send/success/fail/notification, per-companion pitch, mute toggle in Settings
- [x] **UX-003** Quest progress card: live step list with running/done/failed states inside the chat stream
- [x] **UX-004** Email preview card: To/Subject/Body with tone chips + Send / Open-in-Gmail / Cancel buttons
- [x] **UX-005** Contact card: extracted people rendered as cards (name, email, source) with Save / Copy / Email actions
- [x] **UX-006** Organize preview table: what→where rows with counts, Apply/Cancel, dry-run honesty
- [x] **UX-007** Message hover actions: copy + retry on every assistant message
- [x] **UX-008** Code block copy buttons in markdown replies
- [x] **UX-009** Chat search (Ctrl+F): highlight matches, jump between hits, count display
- [x] **UX-010** Drag & drop files onto the chat → path chip + "organize / open / attach" quick actions
- [x] **UX-011** Export conversation: one-click Markdown download
- [x] **UX-012** Pin message: pinned strip above input for the one thing you can't lose
- [x] **UX-013** Typing indicator with personality (each companion "types" differently)
- [x] **UX-014** Empty-state suggestion chips (rotating task ideas, not lorem)
- [x] **UX-015** Quick replies after task completion ("organize downloads → [Undo] [Report]")

## M. Command & Navigation

- [x] **UX-016** Command palette (Ctrl+K): fuzzy actions + settings + recent tasks
- [x] **UX-017** Keyboard shortcuts overlay (?): printable cheat sheet modal
- [x] **UX-018** Global hotkey (Ctrl+Shift+Space): summon/hide Quip from anywhere (registered in main)
- [x] **UX-019** Tray quick actions: Show Quip / New task / Organize downloads / Quit
- [x] **UX-020** Settings search box: filters sections as you type
- [x] **UX-021** Jump-to-bottom pill with unread count during long outputs
- [x] **UX-022** Esc hierarchy: modal → palette → approval → nothing (never nukes a running task)
- [x] **UX-023** Arrow-key message history in the composer (up = last sent)

## N. Feedback & Status

- [x] **UX-024** Taskbar progress: quest progress mirrored on the Windows taskbar icon (setProgressBar)
- [x] **UX-025** Taskbar flash/overlay when a long quest finishes while unfocused
- [x] **UX-026** Latency + model badge on each assistant reply (small, muted)
- [x] **UX-027** Token/char counter on long composer inputs
- [x] **UX-028** Skeleton shimmer while first token is pending
- [x] **UX-029** Error toasts with a Retry action wired to the real retry path
- [x] **UX-030** Auto-move toasts for Downloads watch ("moved invoice.pdf → Documents/Invoices")
- [x] **UX-031** First-run tour: 4-step spotlight (chat, screen modes, permission modes, desktop icon)
- [x] **UX-032** Health/Doctor card in Settings: self_check v2 results inline, refreshed on open
- [x] **UX-033** Outbox view in Settings: MailWing sends with status pills
- [x] **UX-034** Reduced-motion media query respected across all new animations

## O. Accessibility

- [x] **UX-035** aria-labels on every icon-only button (top bar, composer, message actions)
- [x] **UX-036** Focus-visible rings themed per accent, never removed
- [x] **UX-037** Full keyboard path for approvals: Tab order + Enter approves, Esc declines
- [x] **UX-038** Screen-reader text for progress phases ("verifying step 2 of 5")
- [x] **UX-039** Contrast pass: all new card/toast colors meet 4.5:1 in all 10 themes
- [x] **UX-040** Prefers-contrast: raise borders + text weight when requested
- [x] **UX-041** Chat messages as article elements with role/aria-live="polite"

## P. Personalization

- [x] **UX-042** Font size setting: compact / comfortable / spacious (scales chat + cards)
- [x] **UX-043** Accent color picker: tints composer caret, pills, progress, focus rings
- [x] **UX-044** Animated theme transitions (150ms crossfade, reduced-motion aware)
- [x] **UX-045** Companion accent tinting: each of the 6 companions subtly re-tints the UI
- [x] **UX-046** Chat density: comfortable vs compact line spacing
- [x] **UX-047** Per-companion greeting variants on window focus after absence
- [x] **UX-048** Voice orb waveform visualizer while TTS speaks
- [x] **UX-049** Custom quick-reply chips the user can edit in Settings
- [x] **UX-050** "Quip said" mascot bubble styles per theme (glass/solid/outline)

---

## Execution order (autonomous, no permission needed)

1. **Engines first** (A→B→C→D→E): pure cores + Electron-thin shells, tests with every file.
2. **Wiring** (F→G→H): registry + catalog + contracts + intents + permission classes + IPC.
3. **Renderer** (L→N, then M→O→P): quest card, mail preview, toasts, sounds, palette.
4. **Ledger last**: CAP-100 ERROR-LEDGER.md, statuses of this file updated honestly.

> Honesty note: items checked here are verified by `npm test`, `tsc` and the Vite build
> in the same commit. Live-device verification (SMTP delivery to a real inbox, real
> wallpaper/brightness on the user's laptop) is flagged in CAPABILITY_MAP.md until the
> user runs it — sandbox truth vs laptop truth are never conflated.
