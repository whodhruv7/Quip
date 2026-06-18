# Quip V0.1 — Windows Floating Companion

> Pix — a small AI companion that lives on your desktop, floats above every
> window, and answers anything you ask. Premium, minimal, calm. Not a chatbot.

This is **Version 0.1**. The goal is emotional quality, not features. One
companion (**Pix**), one job (answer fast and feel alive), one platform
(Windows desktop).

---

## What it does

1. Launch Quip → **Pix** appears bottom-right of your screen.
2. Pix **floats above all windows** (YouTube, VS Code, anything).
3. **Drag** Pix anywhere. Position is remembered across restarts.
4. **Single click** → a glass **Ask panel** opens.
5. **Double click** → panel closes.
6. Type a question → **OpenRouter** streams the answer live.
7. Markdown + code blocks render cleanly. Auto-scrolls.

That's it. No login, no dashboard, no settings, no memory, no clutter.

---

## Tech stack

- **Electron** — transparent, frameless, always-on-top window
- **React + TypeScript** — UI
- **Vite** — dev server + build
- **TailwindCSS** — styling (white / aqua `#6FD6FF` / pink `#FF9FEF`)
- **Framer Motion** — Pix breathing, floating, blinking, thinking, responding, sleeping
- **OpenRouter** — streaming chat (key stays in the main process, never in the UI)

---

## Setup

### 1. Install dependencies

```bash
cd quip-v01-desktop
npm install
```

> If the Electron binary download is slow, use the mirror:
> ```bash
> # Windows (cmd)
> set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
> npm install
> ```

### 2. Add your OpenRouter API key

A `.env` file is already created with a placeholder. Replace the key with
**your own** from <https://openrouter.ai/keys>:

```env
OPENROUTER_API_KEY=sk-or-v1-your-key-here
OPENROUTER_MODEL=deepseek/deepseek-chat-v3-0324:free
```

> ⚠️ **Rotate any key that was ever pasted in chat.** This file is gitignored
> and the key is never written into source, but once exposed in chat it should
> be treated as compromised.

### 3. Run in dev

```bash
npm run dev
```

This starts Vite (port 5173) and launches Electron pointing at it.

### 4. Build & run the packaged app

```bash
npm run build   # compile electron + build renderer to dist/
npm start       # launch the built app
```

---

## Using Quip

| Action            | Result                         |
| ----------------- | ------------------------------ |
| Launch app        | Pix appears bottom-right       |
| Drag Pix          | Moves anywhere on desktop      |
| Single click Pix  | Opens / toggles the Ask panel  |
| Double click Pix  | Closes the Ask panel           |
| Type + Enter      | Sends to Pix, streams answer   |
| Shift + Enter     | New line in input              |
| Tray icon → Quit  | Exits Quip                     |

---

## Pix states

Pix is never static. It cycles through:

- **idle** — gentle float + breathing + random blinks
- **hover** — slightly brighter, lifts a touch
- **thinking** — soft aqua→pink glow pulse (request sent, waiting)
- **responding** — energetic pulse (tokens streaming in)
- **sleeping** — dims and dozes after ~1 min of inactivity

---

## Project structure

```
quip-v01-desktop/
├── .env                    # OPENROUTER_API_KEY (gitignored)
├── electron/
│   ├── main.ts             # window + IPC + OpenRouter streaming
│   ├── preload.ts          # secure bridge to renderer
│   └── shared.ts           # IPC channel names + types
└── src/
    ├── App.tsx             # window layout, drag, click logic
    ├── components/
    │   ├── Pix.tsx         # the companion (SVG + motion states)
    │   ├── AskPanel.tsx    # glass chat panel
    │   ├── ChatMessage.tsx # markdown bubble
    │   └── ChatInput.tsx   # input + send
    ├── hooks/              # useChat, usePixState, useWindowDrag
    ├── animations/         # Framer Motion variants
    ├── lib/                # localStorage helpers
    └── types/              # shared TS types
```

---

## Security model

- The OpenRouter key lives **only** in the Electron **main process** (read from
  local `.env`). It is never exposed to the renderer, never bundled, never
  committed.
- The renderer talks to the main process through a narrow, typed IPC bridge
  (`window.quip`). It can ask "send this chat" but never sees the key.
- Chat history is stored in `localStorage` (recent messages only). No memory
  engine, no cloud sync.

---

## What's NOT in V0.1 (intentionally)

Login, signup, dashboard, onboarding, settings pages, memory engine,
personality engine, companion evolution, database, cloud sync, Kai, Ren,
notifications, voice. These are marked with `// Future:` comments where they'll
plug in later.

---

## Troubleshooting

**"⚠ check API key" under Pix**
→ Your `.env` is missing `OPENROUTER_API_KEY`, or the key is invalid/expired.
  Edit `.env`, then fully quit and relaunch.

**Pix doesn't appear**
→ Check the tray icon (bottom-right of Windows taskbar) → "Show Pix".
  The window is taskbar-less by design.

**Rate-limited (429)**
→ The free model caps requests. Wait a moment and try again, or switch
  `OPENROUTER_MODEL` in `.env` to another free model from
  <https://openrouter.ai/collections/free-models>.

**Drag feels laggy**
→ Make sure hardware acceleration is on. Electron enables it by default.

---

_V0.1 is a prototype. Build for emotional quality over feature quantity._
