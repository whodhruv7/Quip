// Quip V2 — Top bar (SIMPLE).
//
// Companion dots (left) + brain health pill + square expand button + new chat
// + settings + close. The health pill shows the REAL state of the AI brain
// (boot-probed, live-updated): green = a provider answers, red = none do,
// gray = not checked yet. The amber dot pulses while the companion speaks.

import { useEffect, useState } from "react";
import type { WindowMode } from "../../electron/shared";
import type { CompanionId } from "@/types";
import type { BrainHealthReport } from "@/types/models";
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
  /** Opens Settings straight on the AI tab (health pill click). */
  onBrainClick?: () => void;
}

export function TopBar({ companionId, onCompanionChange, onSettingsToggle, onReflectionToggle, onNewChat, onClose, onHideChat, mode = "panel", onToggleExpand, onBrainClick }: TopBarProps) {
  const handleClose = onClose ?? onHideChat;
  const accent = getCompanion(companionId);

  // Live brain health — pushed by the main process after its boot probe
  // and every Doctor run. No polling, no guessing.
  const [health, setHealth] = useState<BrainHealthReport | null>(null);
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    let alive = true;
    try {
      window.quip.getBrainHealth().then((h) => {
        if (alive && h && h.at > 0) setHealth(h);
      }).catch(() => {});
      const off = window.quip.onBrainHealth((h) => {
        if (alive && h) setHealth(h);
      });
      const offSpeak = (() => {
        const handler = (e: Event) => setSpeaking((e as CustomEvent).detail === true);
        window.addEventListener("quip-speaking", handler);
        return () => window.removeEventListener("quip-speaking", handler);
      })();
      return () => {
        alive = false;
        off();
        offSpeak();
      };
    } catch {
      return () => {};
    }
  }, []);

  const pillColor = !health || health.at === 0 ? "rgba(0,0,0,0.18)" : health.healthy ? "#22c55e" : "#ef4444";
  const pillTitle = !health || health.at === 0
    ? "Brain: not checked yet"
    : health.healthy
      ? `Brain: ${health.activeProvider ?? "provider"} is answering`
      : "Brain: no provider answering — tap to run the Doctor";

  return (
    <div
      className="flex items-center gap-1.5 px-3 py-2"
      style={{
        background: "rgb(var(--chrome-bg) / 0.40)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderBottom: "1px solid rgb(var(--chrome-line) / 0.06)",
      }}
    >
      {/* Companion dots — switch between all 6 companions */}
      <div className="flex items-center gap-1">
        {(["pix", "kai", "ren", "bubbles", "capy", "skales"] as CompanionId[]).map((id) => {
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

      {/* Speaking indicator — the companion's voice is audible RIGHT NOW */}
      {speaking && (
        <div
          className="flex h-5 items-center gap-[2px] rounded-[6px] px-2"
          style={{ background: "rgba(245,158,11,0.12)" }}
          title="Quip is speaking"
        >
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="inline-block w-[2.5px] animate-bounce rounded-full"
              style={{ background: "#f59e0b", height: 4 + i * 3, animationDelay: `${i * 0.12}s`, animationDuration: "0.8s" }}
            />
          ))}
        </div>
      )}

      {/* Brain health pill — real probe result, one glance */}
      <button
        onClick={onBrainClick ?? onSettingsToggle}
        className="flex h-6 items-center gap-1.5 rounded-[7px] px-2 transition-all hover:scale-[1.05]"
        style={{ background: "rgb(var(--chrome-line) / 0.04)", border: "1px solid rgb(var(--chrome-line) / 0.07)" }}
        title={pillTitle}
        aria-label={pillTitle}
      >
        <span className="h-2 w-2 rounded-full" style={{ background: pillColor }} />
        <span style={{ fontSize: 9, fontWeight: 600, color: "rgb(var(--chrome-soft))" }}>AI</span>
      </button>

      {/* Square expand button — panel ⇄ full app */}
      <button
        onClick={onToggleExpand}
        className="flex h-7 w-7 items-center justify-center rounded-[7px] transition-all"
        style={{
          border: `1.5px solid ${accent.primary}66`,
          background: mode === "full" ? `${accent.primary}18` : "rgb(var(--chrome-line) / 0.05)",
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
