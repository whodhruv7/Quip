// Quip V1 — application root.
//
// Layout: Full-screen chat with top bar, companion floating bottom-right.
// Click companion to open chat panel. Settings in top bar.

import { useRef, useState, useCallback } from "react";
import { AnimatePresence } from "framer-motion";
import { Companion, COMPANIONS } from "@/components/Companion";
import { AskPanel } from "@/components/AskPanel";
import { useChat } from "@/hooks/useChat";
import { usePixState } from "@/hooks/usePixState";
import { useWindowDrag } from "@/hooks/useWindowDrag";
import type { CompanionId } from "@/types";

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

export default function App() {
  const [companionId, setCompanionId] = useState<CompanionId>("pix");
  const [panelOpen, setPanelOpen] = useState(false);
  const { messages, busy, error, send, clear } = useChat(companionId);
  const { state, setHovering, wake } = usePixState(busy, panelOpen);
  
  const [actBusy, setActBusy] = useState(false);

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

  // Handle ACT mode command
  const handleAct = useCallback(async (command: string) => {
    if (actBusy) return;
    
    setActBusy(true);
    wake();

    try {
      const result = await window.quip.actExecute({ requestId: uid(), command });
      
      // Add to main chat messages too for context
      if (result.success) {
        send(`[ACT: ${command}] - ${result.output}`);
      } else {
        send(`[ACT Error]: ${result.output}`);
      }
    } catch (err: any) {
      send(`[ACT Error]: ${err?.message || String(err)}`);
    } finally {
      setActBusy(false);
    }
  }, [actBusy, send, wake]);

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
      {/* Chat panel */}
      <div
        style={{
          position: "absolute",
          right: 20,
          bottom: 20,
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
                busy={busy || actBusy}
                error={error}
                onSend={send}
                onAct={handleAct}
                onClear={clear}
                onClose={() => setPanelOpen(false)}
              />
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* Companion sprite — bottom-right, draggable */}
      <div
        style={{
          position: "absolute",
          right: 30,
          bottom: 20,
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
          {(busy || actBusy) && (
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
                background: "rgba(255,255,255,0.95)",
                padding: "2px 8px",
                borderRadius: 10,
                boxShadow: `0 2px 8px ${theme.primary}18`,
                border: `1px solid ${theme.primary}20`,
              }}
            >
              {isResponding ? "typing…" : actBusy ? "executing…" : "thinking…"}
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
