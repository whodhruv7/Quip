// Quip V3 — Top bar.
//
// LOGO FIRST (the user's ask): the Quip brand mark sits at the top-LEFT of
// the chatbox, tinted by the active theme's brand color, before everything
// else. Then companion dots, brain health, screen-mode controls (expand +
// TRUE FULL SCREEN), new chat, reflection, settings, close.
//
// Every surface is theme-aware: no light-only whites, no hardcoded inks.

import { useEffect, useState } from "react";
import type { WindowMode } from "../../electron/shared";
import type { CompanionId } from "@/types";
import type { BrainHealthReport } from "@/types/models";
import { getCompanion } from "@/lib/companion-config";
import quipMark from "@/assets/quip-mark.png";

interface TopBarProps {
  companionId: CompanionId;
  onCompanionChange: (id: CompanionId) => void;
  onSettingsToggle: () => void;
  onReflectionToggle: () => void;
  onNewChat: () => void;
  onClose?: () => void;
  onHideChat?: () => void;
  /** Current layout mode — drives what the screen-mode buttons do/show. */
  mode?: WindowMode;
  onToggleExpand?: () => void;
  /** True full screen — the whole display, edge to edge. */
  onToggleFullscreen?: () => void;
  /** Opens Settings straight on the AI tab (health pill click). */
  onBrainClick?: () => void;
}

export function TopBar({ companionId, onCompanionChange, onSettingsToggle, onReflectionToggle, onNewChat, onClose, onHideChat, mode = "panel", onToggleExpand, onToggleFullscreen, onBrainClick }: TopBarProps) {
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

  const pillColor = !health || health.at === 0
    ? "rgba(128,128,128,0.55)"
    : health.healthy
      ? "rgb(var(--quip-ok))"
      : "rgb(var(--quip-bad))";
  const pillTitle = !health || health.at === 0
    ? "Brain: not checked yet"
    : health.healthy
      ? `Brain: ${health.activeProvider ?? "provider"} is answering`
      : "Brain: no provider answering — tap to run the Doctor";

  const iconBtn = (title: string, label: string, onClick: () => void, svg: React.ReactNode, danger = false) => (
    <button
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded-md transition-colors"
      style={{ color: "rgb(var(--quip-text-soft))" }}
      title={title}
      aria-label={label}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger ? "rgba(var(--quip-bad), 0.12)" : "rgba(var(--quip-line), 0.07)";
        e.currentTarget.style.color = danger ? "rgb(var(--quip-bad))" : "rgb(var(--quip-text))";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "rgb(var(--quip-text-soft))";
      }}
    >
      {svg}
    </button>
  );

  return (
    <div
      className="flex items-center gap-1.5 px-3 py-2"
      style={{
        background: "rgba(var(--quip-line), 0.035)",
        borderBottom: "1px solid rgba(var(--quip-line), 0.08)",
      }}
    >
      {/* ── The Quip logo, top-left, tinted by the theme brand ────────────── */}
      <img
        src={quipMark}
        alt="Quip"
        draggable={false}
        style={{
          width: 22,
          height: 22,
          borderRadius: 7,
          objectFit: "cover",
          boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
          flexShrink: 0,
        }}
      />

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
          style={{ background: "rgba(var(--quip-warn),0.14)" }}
          title="Quip is speaking"
        >
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="inline-block w-[2.5px] animate-bounce rounded-full"
              style={{ background: "rgb(var(--quip-warn))", height: 4 + i * 3, animationDelay: `${i * 0.12}s`, animationDuration: "0.8s" }}
            />
          ))}
        </div>
      )}

      {/* Brain health pill — real probe result, one glance */}
      <button
        onClick={onBrainClick ?? onSettingsToggle}
        className="flex h-6 items-center gap-1.5 rounded-[7px] px-2 transition-all hover:scale-[1.05]"
        style={{ background: "rgba(var(--quip-line), 0.05)", border: "1px solid rgba(var(--quip-line), 0.08)" }}
        title={pillTitle}
        aria-label={pillTitle}
      >
        <span className="h-2 w-2 rounded-full" style={{ background: pillColor }} />
        <span style={{ fontSize: 9, fontWeight: 600, color: "rgb(var(--quip-text-soft))" }}>AI</span>
      </button>

      {/* Square expand button — panel ⇄ full app (mode-aware tint) */}
      {onToggleExpand && mode !== "fullscreen" && (
        <button
          onClick={onToggleExpand}
          className="flex h-7 w-7 items-center justify-center rounded-[7px] transition-all"
          style={{
            border: `1.5px solid ${accent.primary}66`,
            background: mode === "full" ? `${accent.primary}22` : "rgba(var(--quip-line), 0.05)",
            color: accent.primary,
          }}
          title={mode === "full" ? "Back to small panel" : "Expand to the full app"}
          aria-label={mode === "full" ? "Back to small panel" : "Expand to the full app"}
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
      )}

      {/* TRUE FULL SCREEN button — the third screen mode: whole display */}
      {onToggleFullscreen && (
        <button
          onClick={onToggleFullscreen}
          className="flex h-7 w-7 items-center justify-center rounded-[7px] transition-all"
          style={{
            border: mode === "fullscreen" ? `1.5px solid ${accent.primary}` : "1.5px solid rgba(var(--quip-line), 0.16)",
            background: mode === "fullscreen" ? `${accent.primary}22` : "rgba(var(--quip-line), 0.05)",
            color: mode === "fullscreen" ? accent.primary : "rgb(var(--quip-text-soft))",
          }}
          title={mode === "fullscreen" ? "Exit full screen (Esc)" : "Full screen — the whole display"}
          aria-label={mode === "fullscreen" ? "Exit full screen" : "Full screen"}
        >
          {mode === "fullscreen" ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6" />
            </svg>
          )}
        </button>
      )}

      {/* New chat */}
      {iconBtn(
        "New chat",
        "New chat",
        onNewChat,
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      )}

      {/* Reflection */}
      {iconBtn(
        "Weekly Reflection",
        "Weekly Reflection",
        () => onReflectionToggle(),
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M3 3v18h18M7 14l5-5 4 4 5-5" />
        </svg>
      )}

      {/* Settings */}
      {iconBtn(
        "Settings",
        "Settings",
        () => onSettingsToggle(),
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      )}

      {/* Close — hides the panel; the companion itself stays on the desktop */}
      {handleClose && iconBtn(
        "Close panel — companion stays",
        "Close panel",
        handleClose,
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>,
        true
      )}
    </div>
  );
}
