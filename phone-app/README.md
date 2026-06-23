# Quip Phone App — V2 Refinement

> A calm, premium, Apple-level phone prototype for QUIP.
> Built with Next.js + React + Framer Motion + Inter font.
> Dark mode. 8pt grid. Spring physics. No vibe-coding.

## What This Is

This is the **phone version** of Quip — a browser-based prototype that simulates the Android/iOS app experience inside a realistic phone frame. It's the design reference for the eventual native Android build.

## Screens

1. **Splash** — Calm logo animation, 2s auto-advance
2. **Onboarding** — Welcome + companion preview + features
3. **Companion Select** — Choose Pix, Kai, or Ren
4. **Home Chat** — Full chat with streaming, tones, keyboard
5. **Memory** — Searchable memory cards, pin/delete
6. **Personality** — Communication DNA bars + insights
7. **Settings** — Apple-style grouped settings, live theme switching

## Design System

- **Colors:** `#0B0B0C` bg, `#111113` surface, `#18181B` card
- **Font:** Inter (4 weights: 400, 500, 600, 700)
- **Grid:** 8pt spacing (4, 8, 12, 16, 20, 24, 32, 40, 48, 64)
- **Radius:** 12, 16, 20, 24
- **Animations:** 120ms, 180ms, 240ms (spring physics, no bounce)
- **Themes:** Aurora (purple), Ocean (blue), Blush (pink)

## Run Locally

```bash
cd phone-app
npm install
npm run dev
```

Open `http://localhost:3000` — the phone frame renders in the browser.

## Architecture

```
phone-app/
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Inter font + Quip metadata
│   │   ├── page.tsx            # Screen router (splash→onboarding→home)
│   │   └── globals.css         # Clean, reduced-motion, hidden scrollbars
│   ├── lib/
│   │   ├── quip-design.ts      # Design system (colors, spacing, typography)
│   │   └── quip-store.tsx      # Central state (useReducer + Context)
│   ├── components/
│   │   ├── phone/              # PhoneFrame, StatusBar, TabBar, HomeIndicator
│   │   ├── keyboard/           # QuipKeyboard, ThemePanel
│   │   └── companion/          # CompanionSprite (Pix/Kai/Ren SVGs)
│   └── screens/                # Splash, Onboarding, CompanionSelect, HomeChat, Memory, Personality, Settings
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
└── postcss.config.mjs
```

## Companions

- **Pix** — Playful, curious, optimistic. A smart friend.
- **Kai** — Calm, intelligent, focused. Coffee with a mentor.
- **Ren** — Empathetic, expressive, soft. A close friend.

## Philosophy

> Premium products are not built by adding.
> Premium products are built by removing.

Made with 💙 by Dhruv Sharma
