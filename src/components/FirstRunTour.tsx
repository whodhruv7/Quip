// Quip — First-run tour (UX-031).
//
// A 4-step overlay walkthrough shown ONCE, after the very first device scan
// finishes (App gates it on prefs.tourDone !== true && scanDone). Each step
// is a small themed card parked center-bottom above the composer with step
// dots, Next/Back/Skip. Finishing or skipping sets prefs.tourDone — it never
// nags again. prefers-reduced-motion gets no entrance animation at all.

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

interface FirstRunTourProps {
  open: boolean;
  /** Finish or skip — App persists prefs.tourDone and re-focuses the composer. */
  onFinish: () => void;
}

const STEPS: Array<{ title: string; body: string }> = [
  {
    title: "Talk to Quip 👋",
    body: "Type in the composer below — Quip answers with its AI brain, and can actually run desktop tasks for you (open apps, find files, send mail).",
  },
  {
    title: "Three screen modes 🪟",
    body: "Tap the companion to open the small panel. The square button expands to the full app, and Full Screen takes the whole display — Esc always brings you back.",
  },
  {
    title: "You're in charge 🛡️",
    body: "Permission modes decide what Quip may auto-run. Everyday actions can go hands-free — deleting, sending and buying ALWAYS ask you first.",
  },
  {
    title: "Summon it from anywhere ⌨️",
    body: "Ctrl+Shift+Space shows or hides Quip globally, and the tray icon's \"New task\" jumps straight to this composer. That's everything — enjoy!",
  },
];

export function FirstRunTour({ open, onFinish }: FirstRunTourProps) {
  const [step, setStep] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    try {
      setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch {
      /* default to animated */
    }
  }, []);

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  const last = step === STEPS.length - 1;

  const next = useCallback(() => {
    if (step >= STEPS.length - 1) onFinish();
    else setStep((s) => s + 1);
  }, [step, onFinish]);

  const back = useCallback(() => setStep((s) => Math.max(0, s - 1)), []);

  // Esc skips the tour entirely.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onFinish();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, next, back, onFinish]);

  const current = STEPS[step];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="first-run-tour"
          // Gentle dim — pointer-events none, so Quip stays fully usable
          // underneath and the card is the only interactive element.
          initial={reducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reducedMotion ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.2 }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 450,
            background: "rgba(0,0,0,0.18)",
            pointerEvents: "none",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
          }}
        >
          <motion.div
            role="dialog"
            aria-label={`Welcome tour — step ${step + 1} of ${STEPS.length}: ${current.title}`}
            initial={reducedMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
            transition={{ duration: reducedMotion ? 0 : 0.22, ease: "easeOut" }}
            style={{
              pointerEvents: "auto",
              marginBottom: 96,
              width: 420,
              maxWidth: "92vw",
              background: "rgb(var(--quip-bg))",
              border: "1px solid rgba(var(--quip-accent), 0.4)",
              borderRadius: 18,
              boxShadow: "0 24px 70px rgba(0,0,0,0.35), 0 0 0 4px rgba(var(--quip-accent), 0.08)",
              padding: "14px 16px 12px",
              position: "relative",
            }}
          >
            {/* Skip — always available, always honest */}
            <button
              onClick={onFinish}
              aria-label="Skip the tour"
              style={{
                position: "absolute",
                top: 10,
                right: 12,
                fontSize: 10.5,
                fontWeight: 600,
                color: "rgba(var(--quip-text-soft), 0.95)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: "2px 6px",
                borderRadius: 6,
              }}
            >
              Skip
            </button>

            <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgb(var(--quip-accent-deep))" }}>
              Step {step + 1} of {STEPS.length}
            </div>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: "rgb(var(--quip-text))", marginTop: 3 }}>
              {current.title}
            </div>
            <div style={{ fontSize: 11.5, lineHeight: 1.5, color: "rgba(var(--quip-text-soft), 0.95)", marginTop: 4 }}>
              {current.body}
            </div>

            {/* Step dots + controls */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
              <div style={{ display: "flex", gap: 5, flex: 1 }} aria-hidden>
                {STEPS.map((_, i) => (
                  <span
                    key={i}
                    style={{
                      width: i === step ? 16 : 6,
                      height: 6,
                      borderRadius: 3,
                      background: i === step ? "rgb(var(--quip-accent))" : "rgba(var(--quip-line), 0.18)",
                      transition: "width 0.2s ease, background-color 0.2s ease",
                    }}
                  />
                ))}
              </div>
              {step > 0 && (
                <button
                  onClick={back}
                  aria-label="Previous step"
                  style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: "rgb(var(--quip-text-soft))",
                    background: "rgba(var(--quip-line), 0.06)",
                    border: "none",
                    borderRadius: 8,
                    padding: "5px 12px",
                    cursor: "pointer",
                  }}
                >
                  Back
                </button>
              )}
              <button
                onClick={next}
                aria-label={last ? "Finish the tour" : "Next step"}
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  color: "#fff",
                  background: "linear-gradient(135deg, rgb(var(--quip-accent)), rgb(var(--quip-accent-3)))",
                  border: "none",
                  borderRadius: 8,
                  padding: "5px 14px",
                  cursor: "pointer",
                }}
              >
                {last ? "Finish" : "Next"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
