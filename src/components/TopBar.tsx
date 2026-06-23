<<<<<<< HEAD
// Quip V2 — Top bar (SIMPLE).
//
// Just: companion dots (left) + new chat + settings + close (right).
// No model badge (was clutter). Clean, minimal.

import type { CompanionId } from "@/types";
=======
// Quip V2 — Top bar.
//
// Companion switch (small avatar dots), model indicator, settings gear, close.
// Draggable (via the drag hook). Glass effect.

import { useState, useEffect } from "react";
import type { CompanionId, ModelRouterStatus } from "@/types";
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
import { getCompanion } from "@/lib/companion-config";

interface TopBarProps {
  companionId: CompanionId;
  onCompanionChange: (id: CompanionId) => void;
  onSettingsToggle: () => void;
  onNewChat: () => void;
<<<<<<< HEAD
=======
  onHistoryToggle?: () => void;
  historyCount?: number;
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
  onClose?: () => void;
  onHideChat?: () => void;
}

<<<<<<< HEAD
export function TopBar({ companionId, onCompanionChange, onSettingsToggle, onNewChat, onClose, onHideChat }: TopBarProps) {
  const handleClose = onClose ?? onHideChat;

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
      {/* Companion dots — switch between Pix/Kai/Zee */}
      <div className="flex items-center gap-1">
=======
export function TopBar({ companionId, onCompanionChange, onSettingsToggle, onNewChat, onHistoryToggle, historyCount, onClose, onHideChat }: TopBarProps) {
  const handleClose = onClose ?? onHideChat;
  const [modelStatus, setModelStatus] = useState<ModelRouterStatus | null>(null);

  useEffect(() => {
    window.quip.getModelStatus().then(setModelStatus).catch(() => {});
  }, []);

  const theme = getCompanion(companionId);

  return (
    <div
      className="flex items-center gap-2 px-4 py-2.5"
      style={{
        background: "rgba(252,253,255,0.94)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderBottom: "1px solid rgba(0,0,0,0.04)",
      }}
      data-tauri-drag-region
    >
      {/* Companion dots */}
      <div className="flex items-center gap-1.5">
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
        {(["pix", "kai", "zee"] as CompanionId[]).map((id) => {
          const c = getCompanion(id);
          const active = id === companionId;
          return (
            <button
              key={id}
              onClick={() => onCompanionChange(id)}
<<<<<<< HEAD
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
=======
              className="relative flex h-7 w-7 items-center justify-center rounded-full transition-all"
              style={{
                background: active
                  ? `${c.primary}18`
                  : "transparent",
                border: active
                  ? `1.5px solid ${c.primary}55`
                  : "1.5px solid transparent",
              }}
              title={c.name}
            >
              <span
                className="h-2.5 w-2.5 rounded-full transition-transform"
                style={{
                  background: c.primary,
                  transform: active ? "scale(1.15)" : "scale(0.85)",
                  opacity: active ? 1 : 0.5,
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
                }}
              />
            </button>
          );
        })}
      </div>

<<<<<<< HEAD
      {/* Spacer */}
      <div className="flex-1" />

      {/* New chat */}
      <button
        onClick={onNewChat}
        className="flex h-6 w-6 items-center justify-center rounded-md text-quip-gray transition-colors hover:bg-black/[0.04]"
        title="New chat"
        aria-label="New chat"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
=======
      {/* Spacer (draggable) */}
      <div className="flex-1" data-tauri-drag-region />

      {/* Model badge */}
      {modelStatus && (
        <div
          className="flex items-center gap-1 rounded-full px-2 py-0.5"
          style={{
            fontSize: 10,
            fontWeight: 500,
            color: modelStatus.healthy ? "#6b7280" : "#ef4444",
            background: "rgba(0,0,0,0.04)",
          }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: modelStatus.healthy ? "#22c55e" : "#ef4444" }}
          />
          {modelStatus.active.label.split("·")[0]?.trim()}
        </div>
      )}

      {/* New chat button */}
      <button
        onClick={onNewChat}
        className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-black/[0.04]"
        title="New chat"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

<<<<<<< HEAD
      {/* Settings */}
      <button
        onClick={onSettingsToggle}
        className="flex h-6 w-6 items-center justify-center rounded-md text-quip-gray transition-colors hover:bg-black/[0.04]"
        title="Settings"
        aria-label="Settings"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
=======
      {/* History button */}
      <button
        onClick={onHistoryToggle}
        className="relative flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-black/[0.04]"
        title="History"
        disabled={!onHistoryToggle}
        style={{ opacity: onHistoryToggle ? 1 : 0.45, cursor: onHistoryToggle ? "pointer" : "default" }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <path d="M3 4v5h5" />
          <path d="M12 7v5l3 2" />
        </svg>
        {!!historyCount && historyCount > 0 && (
          <span
            className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-semibold text-white"
            style={{ background: "#111827" }}
          >
            {historyCount > 9 ? "9+" : historyCount}
          </span>
        )}
      </button>

      {/* Settings gear */}
      <button
        onClick={onSettingsToggle}
        className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-black/[0.04]"
        title="Settings"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

<<<<<<< HEAD
      {/* Close */}
      <button
        onClick={handleClose}
        className="flex h-6 w-6 items-center justify-center rounded-md text-quip-gray transition-colors hover:bg-red-50 hover:text-red-500"
        title="Close"
        aria-label="Close chat"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
=======
      {/* Close button */}
      <button
        onClick={handleClose}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-quip-gray transition-colors hover:bg-red-50 hover:text-red-500"
        title="Hide chat"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
