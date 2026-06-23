// Quip V2 — Keyboard shortcuts hook.
//
// Global keyboard navigation:
//   Cmd/Ctrl+K        → toggle chat panel
//   Esc               → close chat panel (or settings if open)
//   Cmd/Ctrl+,        → open settings
//   Cmd/Ctrl+Shift+N  → new chat
//   Cmd/Ctrl+1/2/3    → switch companion (Pix/Kai/Zee)
//
// Respects input fields — shortcuts don't fire when typing in a textarea/input
// (except Esc, which clears the input).

import { useEffect } from "react";

interface KeyboardShortcutsProps {
  onToggleChat: () => void;
  onCloseChat: () => void;
  onOpenSettings: () => void;
  onNewChat: () => void;
  onSwitchCompanion: (id: "pix" | "kai" | "zee") => void;
  isSettingsOpen: boolean;
}

export function useKeyboardShortcuts({
  onToggleChat,
  onCloseChat,
  onOpenSettings,
  onNewChat,
  onSwitchCompanion,
  isSettingsOpen,
}: KeyboardShortcutsProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement;
      const isTyping =
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "INPUT" ||
        target?.isContentEditable;

      // Esc — close settings or chat (works even when typing)
      if (e.key === "Escape") {
        if (isTyping) {
          // Let the input handle it (clear)
          return;
        }
        e.preventDefault();
        onCloseChat();
        return;
      }

      // Don't trigger other shortcuts while typing
      if (isTyping) return;

      // Cmd/Ctrl+K — toggle chat
      if (mod && e.key === "k") {
        e.preventDefault();
        onToggleChat();
        return;
      }

      // Cmd/Ctrl+, — open settings
      if (mod && e.key === ",") {
        e.preventDefault();
        onOpenSettings();
        return;
      }

      // Cmd/Ctrl+Shift+N — new chat
      if (mod && e.shiftKey && e.key === "n") {
        e.preventDefault();
        onNewChat();
        return;
      }

      // Cmd/Ctrl+1/2/3 — switch companion
      if (mod && (e.key === "1" || e.key === "2" || e.key === "3")) {
        e.preventDefault();
        const companions = ["pix", "kai", "zee"] as const;
        onSwitchCompanion(companions[Number(e.key) - 1]);
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    onToggleChat,
    onCloseChat,
    onOpenSettings,
    onNewChat,
    onSwitchCompanion,
    isSettingsOpen,
  ]);
}
