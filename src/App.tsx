// Quip V0.1 — application root.
//
// Layout inside the transparent Electron window:
//   - Companion (Pix/Kai/Ren) sits bottom-right.
//   - Click opens Ask panel (glass, theme-matched).
//   - Panel has companion switcher pills + chat history.
//   - Drag moves companion anywhere.
//   - Empty areas pass clicks through to the desktop.

import { useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { Companion, COMPANIONS } from "@/components/Companion";
import { AskPanel } from "@/components/AskPanel";
import { useChat } from "@/hooks/useChat";
import { usePixState } from "@/hooks/usePixState";
import { useWindowDrag } from "@/hooks/useWindowDrag";
import type { CompanionId } from "@/types";

export default function App() {
  const [companionId, setCompanionId] = useState<CompanionId>("pix");
  const [panelOpen, setPanelOpen] = useState(false);
  const { messages, busy, error, send, clear } = useChat(companionId);
  const { state, setHovering, wake } = usePixState(busy, panelOpen);

  const isResponding =
    busy &&
    messages.some(
      (m) => m.role === "assistant" && m.streaming && m.content.length > 0
    );
  const pixState = isResponding ? "responding" : state;

  const drag = useWindowDrag(true);
  const lastClick = useRef(0);

  const handleCompanionClick = () => {
    if (drag.totalMoved() > 5) return;
    const now = Date.now();
    if (now - lastClick.current < 340) {
      setPanelOpen(false);
    } else {
      setPanelOpen((o) => !o);
    }
    lastClick.current = now;
    wake();
  };

  const switchCompanion = (id: CompanionId) => {
    setCompanionId(id);
    setPanelOpen(true);
  };

  const theme = COMPANIONS.find((c) => c.id === companionId)!;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "transparent",
        pointerEvents: "none",
      }}
    >
      {/* Ask panel — positioned above the companion */}
      <div
        style={{
          position: "absolute",
          right: 6,
          bottom: 100,
          pointerEvents: "none",
        }}
      >
        <AnimatePresence>
          {panelOpen && (
            <div style={{ pointerEvents: "auto" }}>
              <AskPanel
                open={panelOpen}
                companionId={companionId}
                onCompanionChange={switchCompanion}
                messages={messages}
                busy={busy}
                error={error}
                onSend={send}
                onClear={clear}
              />
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* Companion sprite — bottom-right, small, draggable */}
      <div
        style={{
          position: "absolute",
          right: 14,
          bottom: 12,
          width: 72,
          height: 88,
          pointerEvents: "auto",
          cursor: "grab",
          transition: "filter 200ms",
        }}
        onPointerEnter={() => {
          setHovering(true);
          (document.activeElement as HTMLElement)?.blur?.();
        }}
        onPointerLeave={() => setHovering(false)}
        onPointerDown={drag.onPointerDown}
        onPointerMove={drag.onPointerMove}
        onPointerUp={(e) => {
          drag.onPointerUp(e);
          handleCompanionClick();
        }}
      >
        <Companion id={companionId} state={pixState} size={64} />

        {/* Status pill */}
        <AnimatePresence>
          {busy && (
            <div
              style={{
                position: "absolute",
                bottom: -4,
                left: "50%",
                transform: "translateX(-50%)",
                whiteSpace: "nowrap",
                fontSize: 10,
                fontWeight: 500,
                color: theme.primary,
                background: "rgba(255,255,255,0.88)",
                padding: "2px 8px",
                borderRadius: 10,
                boxShadow: `0 2px 8px ${theme.primary}18`,
                backdropFilter: "blur(6px)",
                border: `1px solid ${theme.primary}20`,
              }}
            >
              {isResponding ? "typing…" : "thinking…"}
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* Future: Kai, Ren evolution, memory engine, voice, toolbar, notifications */}
    </div>
  );
}
