# Quip — AI Life Companion OS

> *"Quip is not a chatbot. Quip is not an assistant. Quip is a Context Engine wrapped inside a companion."*

**Made with love by [Dhruv Sharma](https://heydhruv.vercel.app) **

Quip is a Windows desktop AI companion that **lives on your screen**. It understands what you say, remembers who you are, speaks its replies out loud, sees your screen, opens your apps and websites, and executes real tasks on your laptop — with a permission system and honest failure reporting. Nothing is faked: if Quip can't do something, it tells you exactly why.

---

## ⚡ Start Quip — exact commands (Windows)

> **Node.js 18+ is required** (20 LTS recommended). Install it from **https://nodejs.org** first — click the big green **LTS** button, run the installer, keep clicking Next. Restart any open terminals after installing.

### ✅ Way 1 — The easy way (double-click, recommended)

```bat
git clone https://github.com/whodhruv7/Quip.git
cd Quip
run-quip.cmd
```

`run-quip.cmd` does **everything automatically**:
1. Checks Node.js is installed
2. Runs `npm install` (idempotent — always safe, catches new dependencies after updates)
3. Creates your `.env` from the template
4. Rebuilds **only when code changed** — warm starts take seconds, not 40s
5. Launches Quip — your companion appears on screen

Nothing fails silently: every step is logged to `quip-launch.log` in the project folder, and if any step breaks, a **Windows message box pops up with the exact reason** — no more invisible crashes.

After the first run, you can launch Quip any time by **just double-clicking `run-quip.cmd`** — or use **Settings → "Add Quip to my desktop"** inside the app to get a real desktop icon, then launch from there like a normal app. No terminal needed.

### ✅ Way 2 — Manual commands (same result, typed by hand)

Open **Command Prompt** (Win + R → type `cmd` → Enter) and run, one line at a time:

```bat
git clone https://github.com/whodhruv7/Quip.git
cd Quip
npm install
copy .env.example .env
npm run build
npm start
```

That's it — the companion appears on your screen.

> **Already cloned?** Skip the first two lines. To get the latest version first, run `git pull` inside the `Quip` folder before building.

### 🔑 Add your AI key (one time)

Quip talks to free AI providers. Get a free key from **https://console.groq.com/keys** (takes 1 minute, no credit card — keys start with `gsk_`), then either:

- **Inside the app (easiest):** Settings → **AI Brain** → paste your key → Save. It persists automatically, no restart needed. **This works even if you skipped the `.env` step.**
- **Or in the file:** open `.env` in Notepad and fill in `GROQ_API_KEY=gsk_...`

You can also add backup providers (all have free tiers): Cerebras (`cloud.cerebras.ai`), NVIDIA (`build.nvidia.com`), Gemini (`aistudio.google.com/apikey`), OpenRouter (`openrouter.ai/keys`). Quip **automatically fails over** between every provider that has a key — if one is down, the next one answers within the same message.

---

## 🩺 Troubleshooting — "Quip won't open"

Every known failure and its exact fix. Run these in Command Prompt **inside the `Quip` folder**.

### 1. `'npm' is not recognized...` or `'git' is not recognized...`

That program isn't installed or the terminal is older than the install.
- Install Node.js LTS from https://nodejs.org (npm comes with it) and Git from https://git-scm.com/download/win
- **Close and reopen Command Prompt**, then try again.

### 2. `npm install` fails or hangs at `electron` (very common on Indian networks)

The Electron binary download times out. Use the mirror:

```bat
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
rmdir /s /q node_modules
del package-lock.json
npm install
```

### 3. `npm install` fails with random permission / path errors

```bat
rmdir /s /q node_modules
del package-lock.json
npm cache clean --force
npm install
```

Make sure you're **not running from inside OneDrive/Desktop-synced folders** if it keeps failing — clone to something like `C:\Quip`.

### 4. Error mentions `Cannot find module ...dist-electron...`

The build step didn't run. Always build before `npm start`:

```bat
npm run build
npm start
```

### 5. Build fails with TypeScript errors

You're probably on an old or half-updated copy:

```bat
git status
git pull
rmdir /s /q node_modules
npm install
npm run build
```

If `git pull` says your local files are modified, run `git stash` then `git pull` again.

### 6. The window never appears (no error either)

- **Open `quip-launch.log`** in the Quip folder — the launcher logs every step there and pop-ups show the exact failure reason.
- Look at the terminal output — `npm start` prints what's happening. Wait ~10 seconds after `Launching Quip...`
- Press **Ctrl + R** after launch if the window shows a blank white screen.
- Check the companion isn't hiding: tap the **Quip mascot on your screen**, or use **Settings → Show Quip**.
- Check the tray (bottom-right of the taskbar, near the clock) for the Quip icon.
- The **X button does NOT quit Quip** — it only hides the window so the mascot stays with you. The only way to fully quit is **Settings → Quit Quip**. If Quip is still running, launching it again focuses the existing instance instead of opening a duplicate.

### 7. Companion appears but says it can't reach any AI provider

- Open **Settings → AI Brain**, paste your Groq key, hit Save.
- Or fill `GROQ_API_KEY` in `.env` and relaunch.
- Behind a VPN/antivirus/proxy? Set `QUIP_TRANSPORT=net` (or `node`) in `.env` and relaunch.
- Check **Settings → Doctor** — it runs a live connectivity probe and tells you exactly which provider is failing and why.

### 8. Voice doesn't speak

Voice is on by default (Groq neural voice → free Edge neural voice → your Windows built-in voice). If it's silent:
- Check **Settings → AI Brain → Speak replies** is on.
- Check the laptop isn't muted and the default output device is right.
- Offline with no key? Quip falls back to the local Windows voice automatically.

### 9. Everything else — full reset (fixes 99% of weird states)

```bat
git stash
git pull
rmdir /s /q node_modules
rmdir /s /q dist
rmdir /s /q dist-electron
del package-lock.json
npm install
npm run build
npm start
```

Still broken? Open an issue at https://github.com/whodhruv7/Quip/issues and paste the terminal output — it always says exactly what failed.

### Run tests (for developers)

```bat
npm test
```

---

## 🧩 What Quip does today

### 💬 Understands you (Understanding Engine)
Every message becomes a structured **understanding object** through a 10-stage pipeline: intent classification (primary + secondary + hidden intents with confidence scores), pronoun resolution ("play it **again**" remembers what *again* was), specific addressing, task decomposition, and a clarification gate when your ask is genuinely ambiguous. Provider-independent — it works the same whichever AI brain is active.

### 🦾 Does real things (Action Engine)
A separated pipeline — Head Brain → Action Planner → Permission Manager → Action Engine → Device Controller — executes plans with per-action **verification** (SCREEN STATE → TARGET → ACTION → VERIFY), bounded recovery on failure, structured execution logs, and **honest failure reasons**. Quip never silently fails and never fakes success.
- Opens apps, sites and files across your whole laptop
- Account-aware Google addressing — "open my Gmail" lands in **your** logged-in account (`/mail/u/<n>/`, `?authuser=`)
- YouTube, Spotify, ChatGPT, Gemini, Flipkart and more recognized natively
- Task approval panel + 3 permission modes (Safe / Medium / Dangerous gating)
- Real task cancellation — you can stop what it's doing

### 👀 Sees your screen (Screen Vision)
Quip takes a screenshot of what's in front of you and understands it with a vision model — "what am I looking at?", "click the login button" — using your existing keys, no extra signup.

### 🌐 Autonomy Wave — the agent that runs the laptop (new)
The overnight upgrade that turns Quip from an assistant you instruct into an agent that **completes whole missions**. Every mission is permission-gated, step-verified and undoable. Full list in [ROADMAP.md](ROADMAP.md); failure handling in [docs/ERROR-LEDGER.md](docs/ERROR-LEDGER.md).

- **🌐 Ghost Browser** — a hidden second browser Quip can *read and operate*: "extract emails from acme.com" pulls every contact (even deobfuscated `name [at] site [dot] com`) into your local Contacts Book, follows the site's contact page when the homepage hides people, clicks and fills forms inside pages, and never touches your real browser's cookies. SSRF-gated, budget-capped (6 pages/session), idle auto-closed.
- **✉️ MailWing — real email** — a zero-dependency SMTP client (STARTTLS, AUTH PLAIN/LOGIN, MIME, attachments) with an encrypted account vault (Electron safeStorage). "send a formal email to rahul@acme.com about the invoice" → Quip humanizes the draft (professional/friendly/casual/formal), shows it to you, sends only after your approval, and claims "sent" **only** on the server's 250. No SMTP account? It opens a prefilled Gmail draft instead. Reachability tests quit before MAIL FROM — testing can never send anything.
- **🗂️ FileButler** — "organize my downloads" plans every move (by type or by month), shows you the plan, moves only after you confirm, journals a manifest and undoes byte-exact on "undo organize". Duplicate finder (size → SHA-256), storage reports, and a Downloads watch mode that auto-organizes new files with a toast for every move.
- **🤲 GhostHands** — screenshot-to-PNG, wallpaper, brightness, real OS notifications, PC lock (always confirmed), battery as a first-class intent, session clipboard history, winget app installs ("install notepad++").
- **🧭 Quest Engine** — multi-step missions with live progress cards: **email-from-website** (read the site → pick the contact → humanize → approve → send), **organize-downloads**, **morning-brief** (battery + weather, spoken). Save your own chains as **routines** — "save a routine called morning that organizes downloads", then "run morning routine".
- **⌨️ Command palette (Ctrl+K)** — every task, theme and setting in one fuzzy search. Press **?** for all shortcuts.

> MailWing setup: Settings → **MailWing** → add your SMTP account (Gmail app password works great) → hit **Test** (verifies TLS + login, sends nothing) → done.

### 🗣️ Speaks out loud (Voice)
Replies are spoken through a 3-engine chain: **Groq neural voice** → free **Edge neural voice** (`en-IN-NeerjaNeural` reads Hinglish naturally) → your laptop's **built-in Windows voice** offline. If one fails, the next takes over mid-conversation.

### 🔌 Never loses its brain (Provider Failover)
Six providers in one automatic chain: **Groq → Cerebras → NVIDIA → Gemini → OpenRouter → Ollama (offline)**. Circuit breakers, first-byte timeouts, Retry-After handling, auto model discovery, a live health pill in the UI, and a **Doctor** screen that probes everything and reports exact causes. Keys can live in `.env` or be managed inside Settings → AI Brain.

### 🖥️ Four screen modes
Switch from the TopBar button or the Settings Screen-mode card:
- **Companion** — just the sprite on your screen (small transparent window)
- **Panel** — a small chat panel beside the companion
- **Full** — the complete Quip app interface, centered and rounded
- **Fullscreen** — TRUE full screen, the entire display edge to edge; **Esc** brings you back

### 🏠 Lives on your desktop
- **Real desktop shortcut** — Settings → "Add Quip to my desktop" creates a proper Windows icon with the clear Quip logo. Double-click = companion appears.
- **X never quits** — the cross button only hides the window; your companion stays on screen, always. The **only** way to fully quit is Settings → Quit Quip.
- **Fetch Updates** — one button in Settings that pulls the latest code safely (your local changes are stashed and restored automatically) and tells you honestly if a restart is needed. The launcher then picks up any new dependencies automatically on next start.
- **One instance** — launching Quip twice focuses the running companion instead of spawning a clone.

### 🎭 Six companions, one soul

| Companion | Personality |
|-----------|-------------|
| **Pix** 🟦 | The Creative Spark — playful, energetic |
| **Kai** 🟣 | The Wise Guide — calm, analytical |
| **Ren** 🟪 | The Fearless Explorer — bold, curious |
| **Bubbles** 🩵 | The Joyful Friend — warm, bouncy |
| **Capy** 🟤 | The Calm One — unhurried, soothing |
| **Skales** 🟢 | The Original Gecko — the Skales companion, redrawn in Quip's pixel-sprite language |

Switch anytime from the top bar. Each has its own personality, colors, aura and memory branch.

### 🎨 Ten full themes (integrated inside the chatbox too)

**Quip Violet** (brand default) · Cloud · Aqua · Bubblegum · Mint · Sunset · Ocean · Forest · Midnight · Carbon

Themes color **everything** — the panel, the chatbox (fully opaque, no screen bleeding through), the logo in the top-left corner of the chatbox, buttons, bubbles and accents — applied before first paint so there's no flash of the wrong look.

### 🖥️ Device Knowledge Layer
First-launch device scan indexes your OS, hardware, installed apps and default browser. Lookups are diff-only and land under 50ms, so task planning stays instant. Deterministic fast-paths run before any AI is asked.

---

## 📜 Full changelog — everything built so far

**Build 11 — Autonomy Wave: Ghost Browser, MailWing, FileButler, Quests** *(latest)*
- **Ghost Browser** — offscreen DOM automation: contact extraction (emails, phones, obfuscated addresses), contact-page following, click-by-text, form-fill, SSRF gate + navigation budget + idle auto-close; scripts JSON-encode every value (injection-proof)
- **MailWing** — zero-dependency SMTP client with byte-tested protocol machine (STARTTLS, AUTH PLAIN/LOGIN with mechanism negotiation, MIME/attachments, dot-stuffing), safeStorage-encrypted account vault, humanized compose with honest fallback, approval-gated sends verified by SMTP 250, Gmail-compose fallback, outbox journal, and a reachability test that physically cannot send
- **FileButler** — dry-run organize plans → apply → manifest → undo, collision-safe renames, SHA-256 duplicate finder with .quip-trash, storage reports, Downloads watch with auto-organize toasts, system-directory deny list
- **Quest Engine** — email-from-website / organize-downloads / morning-brief with live quest progress cards, permission-system approvals inside quests, cancellation, bounded recovery, plus user-defined **routines**
- **GhostHands** — screenshot-save, wallpaper, brightness (WMI), OS notifications, PC lock, battery, clipboard history ring, winget installs
- **27 new executors** wired end-to-end: registry ↔ contracts ↔ catalog ↔ permission modes ↔ intent parser (English + Hinglish), all proven by three-way sync tests
- **UX wave** — toast system, WebAudio sound design (per-companion pitch, mute toggle), live quest card, command palette (Ctrl+K), shortcuts overlay (?), code-block copy buttons, watch-move toasts, focus-visible rings, reduced-motion + prefers-contrast support
- **495/495 tests green** (was 425) · tsc clean ×3 · frontend API surface made type-honest (ReflectionAPI + AutonomyAPI)
- **docs/ERROR-LEDGER.md** — every error hit while building + every runtime failure class, marked and explained

**Build 10 — Launcher never fails silently + true fullscreen**
- **The "app won't open" bug root-caused and fixed** — the launcher only installed dependencies when `node_modules` was missing, so updates that added a dependency broke boot with zero diagnostics. Now `npm install` always runs (idempotent), builds happen only when code changed (warm start = seconds), every step logs to `quip-launch.log`, and any failure pops a Windows message box with the real reason
- **TRUE fullscreen (4th screen mode)** — the entire display edge to edge, alwaysOnTop off, Esc to return; screen modes are now Companion / Panel / Full / Fullscreen
- **Opaque themed chatbox** — the desktop can never show through the chat surfaces anymore
- **Theme-aware chatbox logo** top-left + all hardcoded light-only inks replaced with theme tokens
- **Bold desktop icon** — clearer logo on the desktop shortcut

**Build 9 — Desktop + polish round**
- Real Windows desktop shortcut created from inside the app (clear Quip logo, no terminal)
- Cross button keeps the mascot on screen — quit lives only in Settings
- Theme system rebuilt end-to-end: 10 themes, integrated into the chatbox, opaque chatbox, theme-aware chatbox logo

**Build 8 — Settings V3 + brand round**
- Settings V3 "kwazy UX" — Quip Appearance, Fetch Updates buttons, 10-theme picker, user logo
- Heavy deliberate prompt for the understanding pipeline
- Account-aware addressing (Gmail `/u/<n>/`, Google `?authuser=` with `%40` encoding)
- Quip Violet brand theme + refreshed logo assets, honest failure reasons surfaced

**Build 7 — §43 engineering report**
- 14-item delivery report: architecture, engines, reliability, security, tests, limitations, DoD mapping (`docs/ENGINEERING-REPORT.md`)

**Build 6 — Action Engine V1 (Phase 2)**
- Unified plan executor with safety classes, contract validation, structured execution log
- Bounded recovery, mode-aware permission gates, WAITING_FOR_PERMISSION / RECOVERING states in the UI
- Square action buttons + persisted permission mode, 'play it again' context resolution
- 33 new tests — **372 total**

**Build 5 — Head Brain (Phase 1)**
- Permanent Understanding Engine: intents/objects/classification pipeline, reference resolution
- Device knowledge index, execution planner with verify expectations
- Task lifecycle state machine + clarification gate

**Build 4 — Connectivity round**
- Env precedence fixed, circuit breaker, Gemini + Ollama providers
- Token diet, Doctor screen, auto model health, Edge voice, health pill
- Root-caused the entire "providers never connect" failure class

**Build 3 — V3 agent core + voice + reach**
- 4-provider failover (Groq/Cerebras/NVIDIA/OpenRouter) + auto model discovery
- Real voice (TTS), screen vision, agent-reach web reading
- Skales docs/weather/system ports, Agent-Reach channels (GitHub/V2EX/Bilibili/Twitter)
- Groq-first provider, real agentic tool loop, honest failures

**Build 2 — Stability**
- Fixed the companion-vanish crash, ONE window factory, real task cancellation
- Honest agent states, Skales gecko roster, real-browser-only policy, device self-check
- Cute companion states + proactive check-ins

**Build 1 — V2 ground-up rebuild**
- 15-layer brain architecture (Device, Task, Environment, Memory, Spatial, Capability Registry, Goal-Plan-Execute, Knowledge Graph, Workspace Context, Relationship Engine, Memory Importance, Companion Mood, Device Abstraction, Permission System, Companion Evolution)
- Memory that learns from conversations, trust layer ("opening Edge because it's your default browser"), spatial positioning, mood-driven animations, cosmetic unlocks

---

## 🏗️ Architecture

```
┌──────────────── MAIN PROCESS (Electron) ────────────────┐
│                                                         │
│  Understanding Engine (10-stage pipeline)               │
│        │ structured understanding object                │
│        ▼                                                │
│  Action Planner ──► Permission Manager ──► Action Engine│
│                                             │           │
│                                             ▼           │
│                                     Device Controller   │
│              (apps · sites · screen · files · verify)   │
│                                                         │
│  Model Router: Groq → Cerebras → NVIDIA → Gemini        │
│                → OpenRouter → Ollama (offline)          │
│  Voice Chain: Groq TTS → Edge Neural → Windows SAPI     │
│  Device Knowledge Layer (diff-only, <50ms lookups)      │
│  Memory Brain + Knowledge Graph + Relationship DNA      │
│  Doctor + Health Probe + Structured Failure Reports     │
│                                                         │
└────────────────────┬────────────────────────────────────┘
                     │ IPC (typed bridge)
┌────────────────────▼────────────────────────────────────┐
│               RENDERER (React + Vite)                   │
│  Companion (6, mood-driven) · Chatbox (themed, opaque)  │
│  TopBar · SettingsPanel (AI Brain/Doctor/Appearance/    │
│  Device/Memory/DNA/Progression) · ActionApprovalPanel   │
└─────────────────────────────────────────────────────────┘
```

## 📁 Project structure

```
Quip/
├── run-quip.cmd                  # ⭐ Double-click launcher (install + build + run)
├── install-desktop-trigger.cmd   # Desktop trigger installer
├── .env.example                  # API key template (copy → .env)
├── electron/
│   ├── main.ts                   # Bootstrap + window factory + IPC hub
│   ├── preload.ts                # Secure typed bridge
│   ├── shared.ts                 # IPC channel registry
│   ├── engine/                   # Understanding + intent parser + planner
│   ├── brains/                   # 15-layer V2 brain architecture
│   └── system/                   # Model router, permissions, app updates,
│                                 #   TTS chain, desktop shortcut, doctor
├── src/                          # React renderer (components, hooks, lib, types)
│   ├── lib/theme.ts              # 10-theme system
│   └── lib/companion-config.ts   # 6-companion roster
├── tests/                        # 372 tests (npm test)
└── docs/                         # ENGINEERING-REPORT.md + validation checklist
```

---

## 🔒 Privacy & security

- **All memory is local** — stored in your app data folder, never sent to any cloud
- **API keys stay in the main process** — the renderer never sees them
- **No telemetry** — no analytics, no tracking
- **Permission gates** — Safe / Medium / Dangerous action classes with an approval panel
- **You're in control** — view, pin, forget, or clear memories anytime; quit only when you say so

## 🛠️ Tech stack

| Layer | Technology |
|-------|-----------|
| Desktop | Electron 31 |
| UI | React 18 + TypeScript 5 |
| Build | Vite 5 + TailwindCSS 3 |
| Animation | Framer Motion 11 |
| AI | Groq · Cerebras · NVIDIA · Gemini · OpenRouter · Ollama |
| Voice | Groq TTS · Edge Neural · Windows SAPI |
| Vision | Groq / OpenRouter vision models on your existing keys |
| Tests | Node test runner — 495 tests |

## 🗺️ Roadmap

The live 150-item program — **100 capability + 50 UX todos with real-time status** — is now [ROADMAP.md](ROADMAP.md) (100 ✅ verified, 25 🔶 partial, 25 ⬜ planned). Every ✅ is proven by the test suite in the same commit.

- **Next** — chat search + drag-drop, taskbar progress mirroring, first-run tour, ghost wait-for executor, per-quest autonomy budget
- **Later** — sentence-level voice streaming, expanded Agent Reach device control, ghost page screenshots, specialized recovery classes

## 🤝 Contributing

Personal project by **Dhruv Sharma**, but feedback and issues are welcome: https://github.com/whodhruv7/Quip/issues

## 👨‍💻 Author

**Made with love by Dhruv Sharma**

- 🌐 Website: [heydhruv.vercel.app](https://heydhruv.vercel.app)
- 📸 Instagram: [@who_dhruv7](https://instagram.com/who_dhruv7)
- 💻 GitHub: [@whodhruv7](https://github.com/whodhruv7)

> *"Quip is not a chatbot, and not just an agent. It is a Context Engine wrapped inside a companion."*
