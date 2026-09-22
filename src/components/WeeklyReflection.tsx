import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { CompanionId } from "@/types";
import { getCompanion } from "@/lib/companion-config";

// Weekly Reflection — built from REAL data (timeline events, memories,
// relationship profile) through the live getWeeklyDigest IPC. The previous
// version fabricated statistics after a 1.5s timer, which violated Quip's
// core honesty contract: a companion never invents its own accomplishments.
// With no activity, it now says an honest, calm "quiet week" — no fake
// numbers, ever.

interface WeeklyDigestData {
  conversationCount: number;
  taskCount: number;
  memoriesFormed: number;
  topTopics: string[];
  highlights: string[];
  naturalSummary: string;
  askFeedback: string;
}

interface WeeklyReflectionProps {
  companionId: CompanionId;
  onClose: () => void;
}

export function WeeklyReflection({ companionId, onClose }: WeeklyReflectionProps) {
  const [digest, setDigest] = useState<WeeklyDigestData | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState<string | null>(null);
  const theme = getCompanion(companionId);

  useEffect(() => {
    let cancelled = false;
    window.quip
      .getWeeklyDigest()
      .then((d) => {
        if (!cancelled) setDigest(d as WeeklyDigestData);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sendFeedback = (feedback: string) => {
    setFeedbackSent(feedback);
    window.quip.recordReflectionFeedback(feedback).catch(() => {});
  };

  const recordFeedback = (label: string) => {
    sendFeedback(label);
    // A acknowledged reflection closes naturally — feedback is recorded.
    setTimeout(onClose, 900);
  };

  const hasActivity =
    digest && (digest.conversationCount > 0 || digest.taskCount > 0 || digest.memoriesFormed > 0);

  return (
    <div
      className="absolute inset-0 z-[200] flex flex-col p-6"
      style={{
        background: "rgb(var(--quip-bg))",
        color: "rgb(var(--quip-text))",
      }}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight">Weekly Reflection</h2>
        <button
          onClick={onClose}
          aria-label="Close weekly reflection"
          className="rounded-full p-2 transition-colors"
          style={{ color: "rgb(var(--quip-text-soft))" }}
        >
          ✕
        </button>
      </div>

      <div className="mt-8 flex flex-col items-center justify-center text-center">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", bounce: 0.5 }}
          className="mb-6 flex h-24 w-24 items-center justify-center rounded-full"
          style={{ background: `linear-gradient(135deg, ${theme.primary}22, ${theme.primary}55)` }}
        >
          <span className="text-4xl" aria-hidden>
            {hasActivity ? "📈" : "🌙"}
          </span>
        </motion.div>

        {loadFailed && (
          <p className="text-sm leading-relaxed" style={{ color: "rgb(var(--quip-text-soft))", maxWidth: 280 }}>
            Quip couldn't read this week's timeline right now. Nothing is wrong with your data —
            try again in a bit.
          </p>
        )}

        {!loadFailed && !digest && (
          <p className="text-sm leading-relaxed" style={{ color: "rgb(var(--quip-text-soft))", maxWidth: 280 }}>
            Reading this week's timeline…
          </p>
        )}

        {!loadFailed && digest && !hasActivity && (
          <p className="text-sm leading-relaxed" style={{ color: "rgb(var(--quip-text-soft))", maxWidth: 280 }}>
            A quiet week — no conversations, tasks or new memories yet. {theme.name} is here
            whenever you want to start something.
          </p>
        )}

        {!loadFailed && digest && hasActivity && (
          <>
            <div className="mt-2 flex gap-4 text-center">
              <div>
                <div className="text-2xl font-bold" style={{ color: "rgb(var(--quip-text))" }}>
                  {digest.taskCount}
                </div>
                <div className="text-[11px]" style={{ color: "rgb(var(--quip-text-soft))" }}>
                  tasks
                </div>
              </div>
              <div>
                <div className="text-2xl font-bold" style={{ color: "rgb(var(--quip-text))" }}>
                  {digest.conversationCount}
                </div>
                <div className="text-[11px]" style={{ color: "rgb(var(--quip-text-soft))" }}>
                  chats
                </div>
              </div>
              <div>
                <div className="text-2xl font-bold" style={{ color: "rgb(var(--quip-text))" }}>
                  {digest.memoriesFormed}
                </div>
                <div className="text-[11px]" style={{ color: "rgb(var(--quip-text-soft))" }}>
                  memories
                </div>
              </div>
            </div>
            <p
              className="mt-5 whitespace-pre-line text-sm font-medium leading-relaxed"
              style={{ maxWidth: 280, color: "rgb(var(--quip-text))" }}
            >
              {digest.naturalSummary}
            </p>
          </>
        )}

        <div className="mt-10 flex w-full flex-col gap-3">
          {feedbackSent ? (
            <p className="text-sm font-medium" style={{ color: "rgb(var(--quip-ok))" }}>
              Noted — thank you.
            </p>
          ) : (
            <>
              <button
                className="w-full rounded-xl px-4 py-3 text-sm font-bold text-white transition-transform active:scale-95"
                style={{ background: theme.primary }}
                onClick={() => recordFeedback("positive")}
                disabled={!digest}
              >
                Awesome, let's keep going!
              </button>
              <button
                className="w-full rounded-xl px-4 py-3 text-sm font-bold transition-transform active:scale-95"
                style={{
                  background: "rgb(var(--quip-line))",
                  color: "rgb(var(--quip-text))",
                }}
                onClick={() => recordFeedback("needs-break")}
                disabled={!digest}
              >
                I need a break soon.
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
