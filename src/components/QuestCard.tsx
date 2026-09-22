// Quip — Live Quest Card (roadmap UX-003, UX-024)
// ─────────────────────────────────────────────────────────────────────────────
// Renders the quest engine's step events as a live progress card: which step
// is running, what verified, what failed. Anchored bottom-left so it never
// covers the chat. Disappears 10s after the quest reaches a terminal state.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { playSound } from "@/lib/sounds";

interface QuestStep {
  name: string;
  status: "running" | "done" | "failed" | "skipped" | "waiting_permission" | "cancelled";
  detail?: string;
}

interface ActiveQuest {
  questId: string;
  title: string;
  stepTotal: number;
  steps: Map<string, QuestStep>;
  terminalSince?: number;
  ok?: boolean;
}

const STEP_ICON: Record<QuestStep["status"], string> = {
  running: "▸",
  done: "✓",
  failed: "✕",
  skipped: "–",
  waiting_permission: "⏸",
  cancelled: "⏹",
};

const STEP_COLOR: Record<QuestStep["status"], string> = {
  running: "--quip-accent",
  done: "--quip-ok",
  failed: "--quip-bad",
  skipped: "--quip-text-soft",
  waiting_permission: "--quip-warn, 1",
  cancelled: "--quip-text-soft",
};

export function QuestCard() {
  const [quest, setQuest] = useState<ActiveQuest | null>(null);
  const [tick, setTick] = useState(0);
  const lastStatus = useRef<string>("");

  useEffect(() => {
    const off = (window as any).quip?.onQuestEvent?.((e: any) => {
      setQuest((prev) => {
        const base: ActiveQuest =
          prev && prev.questId === e.questId
            ? prev
            : { questId: e.questId, title: e.questTitle, stepTotal: e.stepTotal, steps: new Map() };
        const steps = new Map(base.steps);
        steps.set(e.stepName || `step-${e.stepIndex}`, {
          name: e.stepName || `step ${e.stepIndex + 1}`,
          status: e.status,
          detail: e.detail?.slice(0, 160),
        });
        const terminal = e.status === "done" && e.stepIndex === e.stepTotal - 1;
        const failed = e.status === "failed";
        const cancelled = e.status === "cancelled";
        return {
          ...base,
          steps,
          stepTotal: e.stepTotal,
          terminalSince: terminal || failed || cancelled ? Date.now() : undefined,
          ok: failed ? false : terminal ? true : base.ok,
        };
      });
      if (e.status !== lastStatus.current) {
        lastStatus.current = e.status;
        if (e.status === "failed" || e.status === "cancelled") playSound("error");
        else if (e.status === "done") playSound("quest");
        else playSound("pop");
      }
      setTick((t) => t + 1);
    });
    return () => off?.();
  }, []);

  // Auto-hide 10s after terminal.
  useEffect(() => {
    if (!quest?.terminalSince) return;
    const t = setTimeout(() => setQuest(null), 10_000);
    return () => clearTimeout(t);
  }, [quest?.terminalSince, tick]);

  return (
    <AnimatePresence>
      {quest && (
        <motion.div
          key={quest.questId}
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.97 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          style={{
            position: "fixed",
            bottom: 18,
            left: 18,
            zIndex: 350,
            width: 300,
            background: "rgb(var(--chrome-bg) / 0.97)",
            backdropFilter: "blur(18px)",
            WebkitBackdropFilter: "blur(18px)",
            borderRadius: 14,
            border: "1px solid rgba(var(--quip-line), 0.12)",
            boxShadow: "0 12px 34px rgba(0,0,0,0.20)",
            overflow: "hidden",
          }}
          role="status"
          aria-label={`Quest progress: ${quest.title}`}
        >
          <div
            style={{
              padding: "9px 12px",
              display: "flex",
              alignItems: "center",
              gap: 8,
              borderBottom: "1px solid rgba(var(--quip-line), 0.08)",
            }}
          >
            <span
              className="quip-quest-pulse"
              style={{
                width: 7,
                height: 7,
                borderRadius: 99,
                background: quest.terminalSince
                  ? `rgb(var(${quest.ok ? "--quip-ok" : "--quip-bad"}))`
                  : "rgb(var(--quip-accent))",
              }}
            />
            <span style={{ fontSize: 12, fontWeight: 600, color: "rgb(var(--chrome-text))", flex: 1 }}>
              {quest.title}
            </span>
          </div>
          <div style={{ padding: "6px 12px 10px", display: "flex", flexDirection: "column", gap: 5 }}>
            {[...quest.steps.values()].map((s) => (
              <div key={s.name} style={{ display: "flex", gap: 7, alignItems: "flex-start" }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    width: 12,
                    flexShrink: 0,
                    color: `rgb(var(${STEP_COLOR[s.status]}))`,
                  }}
                >
                  {STEP_ICON[s.status]}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 500, color: "rgb(var(--chrome-text))" }}>
                    {s.name}
                    {s.status === "running" && " …"}
                  </div>
                  {s.detail && (
                    <div
                      style={{
                        fontSize: 10.5,
                        color: "rgb(var(--chrome-soft))",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        maxHeight: 54,
                        overflow: "hidden",
                        marginTop: 1,
                      }}
                    >
                      {s.detail}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
