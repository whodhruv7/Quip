# Skales Audit (for Quip integration)

Source: https://github.com/skalesapp/skales (v7.1.0 snapshot) — Electron 28 +
Next.js 14 desktop agent with a buddy/pet overlay. Quip keeps its own
identity; Skales contributes UX behavior patterns only.

## UX Patterns To Adapt

- Pattern: notification-router trio (quiet hours 22–7, persisted per-type
  cooldowns, suppression while user is engaged)
  - Source: `src/lib/notification-router.ts`, `buddy-intelligence.ts`
  - Quip destination: `src/hooks/useProactiveCheckIn.ts`
  - Theme adaptation: Quip purple/white/blue, companion-voiced phrases

- Pattern: approval card inline in the conversation (amber card, mono rows,
  Approve/Deny buttons continuing the loop)
  - Source: `src/actions/orchestrator.ts` TOOL_SAFETY + approval gate
  - Quip destination: `src/components/ActionApprovalPanel.tsx` rendered
    directly above the chat input (replaces the old giant modal)
  - Theme adaptation: glass white card, purple/blue Allow button, risk label

- Pattern: buddy window recipe (frameless, transparent, always-on-top,
  skipTaskbar, show:false until ready, visibleOnAllWorkspaces)
  - Source: `electron/main.js` createBuddyWindow
  - Quip destination: already aligned with Quip's createWindow; Quip
    additionally persists + clamps position (regression protection)

- Pattern: window coupling — pet/chat stays accessible while task windows
  open focused but NOT always-on-top
  - Source: buddy show/hide coupling + setWindowOpenHandler routing
  - Quip destination: `electron/engine/window-policy.ts` — browser surfaces
    positioned to avoid the chat overlay region, focused after navigation

## Companions To Port

- Decision: NONE copied. Skales companion assets (skales/bubbles/capy webm +
  Petdex sprites) are proprietary ("original Skales artwork"). Quip keeps its
  own SVG pixel companions (Pix / Kai / Zee) with full state coverage:
  idle, hover, thinking, responding, sleeping.
- Adapted instead: the STATE SEMANTICS (idea=thinking, question=approval
  wait, tired=error) already match Quip's PixState model.

## Behavior To Port

- Notification behavior: category rotation (check-in / hydration / break /
  help / greeting) with 45-min per-type cooldowns and quiet hours →
  implemented in useProactiveCheckIn; newest proactive message also floats
  as an on-screen QuipSay bubble (auto-hide 12s, tap to dismiss).
- Companion motion: Quip's existing framer-motion idle/hover/thinking loop
  retained (calmer than Skales; matches Quip identity).
- Chat affordance: compact inline approval panel + smart placeholder +
  suggestion chips incl. new capabilities (open app, open project, quiz).

## Do Not Port

- Separate app shell / Next.js server-in-Electron architecture — Quip is
  Vite + React + Electron main with a single overlay window.
- Non-Quip routes (/buddy, /bootstrap, /settings pages) — Quip's UI stays.
- Duplicate state systems (file-based session queues, Telegram mirroring,
  killswitch) — future work, out of scope.
- Any Skales branding, colors (lime #84cc16), fonts, or artwork.
