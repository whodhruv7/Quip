# Quip V2 — AI Life Companion OS

> **Made with 💙 by [Dhruv Sharma](https://github.com/whodhruv7)**
>
> *"Quip is not a chatbot. Quip is not an assistant. Quip is a Context Engine wrapped inside a companion."*

---

## 🧠 What is Quip?

Quip is an **AI Life Companion** — a desktop application that lives on your screen, understands you, remembers you, and grows with you over time. Unlike traditional chatbots that forget everything, Quip builds a living picture of who you are, what you're doing, and what you need — then uses that context to help you.

**Three companions, one soul:**
- **Pix** 🟦 — The Creative Spark (playful, energetic)
- **Kai** 🟣 — The Wise Guide (calm, analytical)
- **Zee** 🟡 — The Fearless Explorer (curious, empathetic)

Switch between them anytime. Each has its own personality, memory branch, and mood.

---

## ✨ What's New in V2

V2 is a complete ground-up rebuild with a **15-layer brain architecture**. Every layer is modular, independent, and connected through clean APIs.

### The 15 Brain Layers

| # | Layer | Purpose |
|---|-------|---------|
| 1 | 🖥️ **Device Brain** | Discovers OS, hardware, installed apps, default browsers, displays |
| 2 | 🎯 **Task Brain** | Parses intent, builds multi-step plans, executes in milliseconds |
| 3 | 🌍 **Environment Brain** | Monitors battery, network, foreground app, system load |
| 4 | 🧠 **Memory Brain** | Stores facts, preferences, contacts with importance weighting |
| 5 | 📍 **Spatial Brain** | Calculates safe window positions — never overflows off-screen |
| 6 | 📊 **Capability Registry** | Maps abstract actions to concrete apps (never hardcodes) |
| 7 | 🧭 **Goal-Plan-Execute** | 5-phase pipeline: Goal → Plan → Verify → Execute → Confirm |
| 8 | 🧬 **Knowledge Graph** | Entity + relationship graph of your world |
| 9 | 🧠 **Workspace Context** | Tracks current file, project, browser tab in real-time |
| 10 | 🔗 **Relationship Engine** | Learns your communication style (Communication DNA) |
| 11 | ⚖️ **Memory Importance** | Scores memories 0-1, prunes low-value ones automatically |
| 12 | 🤝 **Companion Mood** | Dynamic energy/warmth/playfulness based on time + stress |
| 13 | 📱 **Device Abstraction** | Platform-independent OS operations |
| 14 | 🔐 **Permission System** | Safe/Medium/Dangerous action gating with trust layer |
| 15 | 🌱 **Companion Evolution** | Cosmetic unlocks as your relationship deepens |

### Key Features

- **🧠 Learns from conversations** — Every 10 messages, an LLM extracts facts + entities automatically
- **💙 Trust layer** — Every action shows WHY ("Opening Edge because it's your default browser")
- **⚡ Instant** — Fast-path task execution in <50ms, no waiting for LLM
- **📱 Adaptive** — Spatial Brain ensures UI never overflows, adapts to screen size
- **🔒 Private** — All memory is local, encrypted at rest. No cloud, no telemetry
- **✨ Evolving** — Companions unlock cosmetic upgrades as you bond (scarves, stars, auras)

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ and npm
- **Windows**, **macOS**, or **Linux**

### 1. Clone the repo

```bash
git clone https://github.com/whodhruv7/Quip.git
cd Quip
npm install
```

> If Electron download is slow:
> ```bash
> set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/  # Windows
> # or
> export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/  # Mac/Linux
> npm install
> ```

### 2. Add your AI API key

Create a `.env` file in the project root:

```env
# Primary (recommended — fast + free tier)
GROQ_API_KEY=your_groq_key_here

# Fallback (optional)
OPENROUTER_API_KEY=your_openrouter_key_here
OPENROUTER_MODEL=google/gemma-3-27b-it:free
```

Get a free Groq key at **https://console.groq.com/keys**

> ⚠️ Never commit your `.env` file. It's already in `.gitignore`.

### 3. Run in development

```bash
npm run dev
```

This starts Vite (port 5173) and launches Electron pointing at it.

### 4. Build for production

```bash
npm run build   # compile electron + build renderer to dist/
npm start       # launch the built app
```

---

## 🎮 Using Quip

| Action | Result |
|--------|--------|
| Launch app | First-run device scan → companion appears |
| **Tap companion** | Opens chat panel |
| **Tap again** (or X, or tap outside) | Closes chat → saves to history |
| Type + Enter | Sends message (auto-detects chat vs. task) |
| Shift + Enter | New line |
| Drag companion | Repositions (stays on-screen) |
| Top bar dots | Switch between Pix / Kai / Zee |
| Settings gear | Open settings (5 tabs) |

### What can you ask?

**Chat mode** (auto-detected):
- "What is the meaning of life?"
- "Explain quantum computing simply"
- "Write me a haiku about Mondays"

**Task mode** (auto-detected, executes locally):
- "Open YouTube" → opens your default browser
- "Play Arijit Singh" → Spotify if installed, else YouTube
- "Open Gmail" → launches default browser to Gmail
- "Open VS Code" → launches your editor
- "Search for cute cat videos" → browser search

Quip **never assumes** — it checks your device profile first, picks the right app, and tells you why.

---

## 🏗️ Architecture

```
┌─────────────── MAIN PROCESS (Electron) ───────────────┐
│                                                        │
│  Device Brain ──┬──► Capability Registry               │
│                 │    ┌──► World Model                   │
│                 │    └──► Spatial Brain                 │
│                 ▼                                       │
│  Task Brain ◄── Environment Brain                      │
│     │                                                  │
│     ▼                                                  │
│  Tool Executor ──► Permission System                   │
│     │                                                  │
│     ▼                                                  │
│  Device Abstraction (Win/Mac/Linux)                    │
│                                                        │
│  Memory Brain ◄── Memory Extractor (LLM)               │
│     │                  │                                │
│     ▼                  ▼                                │
│  Memory Importance   Knowledge Graph                   │
│                                                        │
│  Relationship Engine    Workspace Context               │
│  Companion Mood         Companion Evolution             │
│                                                        │
│  Model Router (Groq → OpenRouter fallback)              │
│                                                        │
└────────────────────┬───────────────────────────────────┘
                     │ IPC (typed bridge)
┌────────────────────▼───────────────────────────────────┐
│              RENDERER (React + Vite)                    │
│                                                        │
│  App.tsx (state machine: idle→open→closing→history)    │
│    ├── TopBar (companion switch, model, settings)       │
│    ├── ChatLayout (full-width, smooth scroll)           │
│    ├── ChatInput (single input, auto-detect intent)     │
│    ├── Companion (mood-driven animation + cosmetics)    │
│    ├── SettingsPanel (5 tabs: general/device/memory/    │
│    │                  dna/progression)                   │
│    └── ScanOverlay (first-launch scan animation)        │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## 📁 Project Structure

```
Quip/
├── electron/
│   ├── main.ts                    # Bootstrap orchestrator + IPC hub
│   ├── preload.ts                 # Secure bridge to renderer
│   ├── shared.ts                  # IPC channels + types
│   ├── brains/
│   │   ├── device-brain.ts        # Device discovery
│   │   ├── capability-registry.ts # Abstract→concrete mapping
│   │   ├── task-brain.ts          # Intent + planning
│   │   ├── environment-brain.ts   # Runtime monitoring
│   │   ├── spatial-brain.ts       # Positioning
│   │   ├── world-model.ts         # Can/cannot-do
│   │   ├── tool-executor.ts       # Safe/medium/dangerous
│   │   ├── memory-brain.ts        # Persistent memory
│   │   ├── memory-extractor.ts    # LLM compression + KG extraction
│   │   ├── memory-importance.ts   # Scoring + pruning
│   │   ├── knowledge-graph.ts     # Entity graph
│   │   ├── workspace-context.ts   # Active session tracking
│   │   ├── relationship-engine.ts # Adaptive communication style
│   │   ├── companion-mood.ts      # Dynamic emotional state
│   │   └── companion-evolution.ts # Cosmetic unlocks
│   └── system/
│       ├── bootstrap.ts           # One-click startup
│       ├── model-router.ts        # Groq→OpenRouter fallback
│       └── permission-system.ts   # Trust gating
├── src/
│   ├── App.tsx                    # Layout + toggle state machine
│   ├── components/                # 10 UI components
│   ├── hooks/                     # useChat, useSpatialLayout, etc.
│   ├── lib/                       # storage, companion-config
│   └── types/                     # Full type system
├── github-panel.html              # Standalone PAT-based push panel
├── docs/                          # Architecture docs
├── .env.example                   # Template for API keys
└── package.json
```

---

## ⚙️ Settings

Open settings from the **gear icon** in the top bar. Five tabs:

### General
- Switch companion (Pix / Kai / Zee)
- View active AI model

### Device
- Full device profile (OS, CPU, RAM, storage, displays)
- List of detected apps
- Rescan button

### Memory
- View all memories Quip has learned
- **Pin** important memories (never decay)
- **Forget** individual memories
- **Prune** low-importance memories

### Communication DNA
- See your communication style profile:
  - Preferred response length
  - Formality level
  - Emoji usage frequency
  - Humor level
- Top topics you discuss
- Reset button

### Progression
- Per-companion depth score (0-100%)
- Stats: conversations, messages, tasks, memories
- Unlocked cosmetics (scarves, stars, badges)

---

## 🔒 Privacy & Security

- **All memory is local** — stored in your app data folder, never sent to cloud
- **API keys stay in main process** — renderer never sees them
- **No telemetry** in V2 — no analytics, no tracking
- **Workspace context is in-memory only** — never persisted, never sent raw to LLM
- **You're in control** — view, pin, forget, or clear all memories anytime

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop framework | Electron 31 |
| UI framework | React 18 + TypeScript 5 |
| Build tool | Vite 5 |
| Styling | TailwindCSS 3 (white/aqua/pink theme) |
| Animations | Framer Motion 11 |
| Markdown | react-markdown + remark-gfm |
| AI providers | Groq (primary) + OpenRouter (fallback) |
| Storage | Local JSON files (future: SQLite) |

---

## 🎨 Design Philosophy

**Style:** Apple × Arc × Linear

- **Clarity** — generous whitespace, clear hierarchy
- **Depth** — glass effects, soft shadows, layered transparency
- **Motion** — smooth, spring-based, 200-300ms transitions
- **Color** — white base, aqua `#6FD6FF` primary, pink `#FF9FEF` accent
- **Calm** — never frantic, never cluttered, always premium

---

## 📝 Roadmap

### V1 (Current) ✅
- 15-layer brain architecture
- Memory compression + Knowledge Graph extraction
- Companion toggle fix (open→close→history)
- Spatial Brain adaptive positioning
- Settings with 5 tabs
- Mood-driven animations + cosmetic unlocks

### V1.5 (Next)
- Task Brain slow-path (LLM decomposition for complex commands)
- Goal-Plan-Execute re-plan-on-failure state machine
- Formal Device Abstraction Layer
- Dangerous action countdown UI
- Data export (JSON)

### V2 (Future)
- Voice input/output
- Mobile companion (React Native)
- Skill modules (Mail, Coding, Research, Study, Social, Travel)
- Companion marketplace (premium companions)
- Timeline Brain (past/present/future context)
- Reflection layer (weekly insights)

---

## 🤝 Contributing

This is a personal project by **Dhruv Sharma**, but feedback and suggestions are welcome! Open an issue on [GitHub](https://github.com/whodhruv7/Quip/issues).

---

## 📄 License

UNLICENSED — personal use only. All rights reserved.

---

## 👨‍💻 Author

**Made with 💙 by Dhruv Sharma**

- GitHub: [@whodhruv7](https://github.com/whodhruv7)
- Repository: [Quip](https://github.com/whodhruv7/Quip)

> *"Quip is not a chatbot, and not just an agent. It is a Context Engine wrapped inside a companion."*

---

_Quip V2 — Built for emotional quality over feature quantity._
