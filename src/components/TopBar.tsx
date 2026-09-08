// Quip V2 — Top bar (SIMPLE).
//
// Companion dots (left) + square expand button + new chat + settings + close.
// The square expand button grows the small panel into the full Quip app
// (and shrinks it back). No model badge (was clutter). Clean, minimal.

import type { WindowMode } from "../../electron/shared";
import type { CompanionId } from "@/types";
import { getCompanion } from "@/lib/companion-config";

interface TopBarProps {
  companionId: CompanionId;
  onCompanionChange: (id: CompanionId) => void;
  onSettingsToggle: () => void;
  onReflectionToggle: () => void;
  onNewChat: () => void;
  onClose?: () => void;
  onHideChat?: () => void;
  /** Current layout mode — the square button swaps between expand/shrink */
  mode?: "panel" | "full";
  onToggleExpand?: () => void;
}

export function TopBar({ companionId, onCompanionChange, onSettingsToggle, onReflectionToggle, onNewChat, onClose, onHideChat, mode = "panel", onToggleExpand }: TopBarProps) {
  const handleClose = onClose ?? onHideChat;
  const accent = getCompanion(companionId);

  return (
    <div
      className="flex items-center gap-1.5 px-3 py-2"
      style={{
        background: "rgba(255,255,255,0.40)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderBottom: "1px solid rgba(0,0,0,0.04)",
      }}
    >
      {/* Companion dots — switch between all 6 companions */}
      <div className="flex items-center gap-1">
        {(["pix", "kai", "ren", "bubbles", "capy", "ivy"] as CompanionId[]).map((id) => {
          const c = getCompanion(id);
          const active = id === companionId;
          return (
            <button
              key={id}
              onClick={() => onCompanionChange(id)}
              className="relative flex h-6 w-6 items-center justify-center rounded-full transition-all"
              style={{
                background: active ? `${c.primary}18` : "transparent",
                border: active ? `1.5px solid ${c.primary}55` : "1.5px solid transparent",
              }}
              title={c.name}
              aria-label={`Switch to ${c.name}`}
            >
              <span
                className="h-2 w-2 rounded-full transition-transform"
                style={{
                  background: c.primary,
                  transform: active ? "scale(1.15)" : "scale(0.8)",
                  opacity: active ? 1 : 0.4,
                }}
              />
            </button>
          );
        })}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Square expand button — panel ⇄ full app */}
      <button
        onClick={onToggleExpand}
        className="flex h-7 w-7 items-center justify-center rounded-[7px] transition-all"
        style={{
          border: `1.5px solid ${accent.primary}66`,
          background: mode === "full" ? `${accent.primary}18` : "rgba(255,255,255,0.7)",
          color: accent.primary,
        }}
        title={mode === "full" ? "Back to small panel" : "Expand to full app"}
        aria-label={mode === "full" ? "Back to small panel" : "Expand to full app"}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          {mode === "full" ? (
            <>
              <path d="M9 3H4v5M15 21h5v-5" />
              <rect x="8.5" y="8.5" width="7" height="7" rx="1.2" />
            </>
          ) : (
            <>
              <path d="M4 9V4h5M20 15v5h-5" />
              <rect x="8.5" y="8.5" width="7" height="7" rx="1.2" />
            </>
          )}
        </svg>
      </button>

      {/* New chat */}
      <button
        onClick={onNewChat}
        className="flex h-6 w-6 items-center justify-center rounded-md text-quip-gray transition-colors hover:bg-black/[0.04]"
        title="New chat"
        aria-label="New chat"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      {/* Reflection */}
      <button
        onClick={onReflectionToggle}
        className="flex h-6 w-6 items-center justify-center rounded-md text-quip-gray transition-colors hover:bg-black/[0.04]"
        title="Weekly Reflection"
        aria-label="Weekly Reflection"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M3 3v18h18M7 14l5-5 4 4 5-5" />
        </svg>
      </button>

      {/* Settings */}
      <button
        onClick={onSettingsToggle}
        className="flex h-6 w-6 items-center justify-center rounded-md text-quip-gray transition-colors hover:bg-black/[0.04]"
        title="Settings"
        aria-label="Settings"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {/* Close — hides the panel; the companion itself stays on the desktop */}
      <button
        onClick={handleClose}
        className="flex h-6 w-6 items-center justify-center rounded-md text-quip-gray transition-colors hover:bg-red-50 hover:text-red-500"
        title="Close panel — companion stays"
        aria-label="Close panel"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
