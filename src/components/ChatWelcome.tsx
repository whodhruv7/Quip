// Quip V2 — Welcome screen.
//
// Shows when there are no messages yet. Companion greeting + brain status +
// quick suggestions. Premium, minimal, Apple × Arc × Linear style.

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { CompanionId } from "@/types";
import type { ModelRouterStatus } from "@/types/models";
import { getCompanion } from "@/lib/companion-config";
import { CHAT_SUGGESTIONS } from "@/lib/constants";

interface ChatWelcomeProps {
  companionId: CompanionId;
  onSuggestionClick: (text: string) => void;
  /** Opens Settings on the AI tab when the brain isn't connected. */
  onOpenKeySetup?: () => void;
}

export function ChatWelcome({ companionId, onSuggestionClick, onOpenKeySetup }: ChatWelcomeProps) {
  const theme = getCompanion(companionId);
  const [modelStatus, setModelStatus] = useState<ModelRouterStatus | null>(null);
  // 30-second inline setup: paste the Groq key right here — no settings dig.
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardKey, setWizardKey] = useState("");
  const [wizardState, setWizardState] = useState<"idle" | "saving" | "ok" | "fail">("idle");
  const [wizardNote, setWizardNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    window.quip
      .getModelStatus()
      .then((s) => {
        if (alive) setModelStatus(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const connected = !!modelStatus?.healthy;

  /** Save the key from the inline wizard → real probe → live status. */
  const handleWizardSave = async () => {
    const key = wizardKey.trim();
    if (!key) return;
    setWizardState("saving");
    setWizardNote(null);
    try {
      const save = await window.quip.saveModelKeys({ provider: "groq", apiKey: key });
      if (!save.ok) {
        setWizardState("fail");
        setWizardNote(save.message);
        return;
      }
      const probe = await window.quip.testModelConnection({ provider: "groq" });
      if (probe.ok) {
        setWizardState("ok");
        setWizardNote(`Connected! (${Math.round(probe.latencyMs)}ms) — say something and I'll answer.`);
        const s = await window.quip.getModelStatus();
        setModelStatus(s);
      } else {
        setWizardState("fail");
        setWizardNote(probe.message);
      }
    } catch {
      setWizardState("fail");
      setWizardNote("The setup couldn't run — try again.");
    }
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-8">
      {/* Companion glow */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="mb-4"
        style={{
          width: 56,
          height: 56,
          borderRadius: 16,
          background: `linear-gradient(135deg, ${theme.primary}20, ${theme.secondary}15)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: `0 8px 32px ${theme.primary}15`,
          border: `1px solid ${theme.primary}18`,
        }}
      >
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})`,
          }}
        />
      </motion.div>

      {/* Greeting */}
      <motion.h2
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: "rgb(var(--chrome-text))",
          marginBottom: 4,
          textAlign: "center",
        }}
      >
        Hey, I'm {theme.name}
      </motion.h2>

      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.25 }}
        style={{
          fontSize: 13,
          color: "#9ca3af",
          marginBottom: 16,
          textAlign: "center",
          lineHeight: 1.5,
        }}
      >
        {theme.subtitle}. Ask me anything or tell me what to do.
      </motion.p>

      {/* Brain status — CONNECTED or NOT CONNECTED, never vague (Phase 9) */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3 }}
        className="mb-6"
      >
        {connected ? (
          <div
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5"
            style={{
              fontSize: 10.5,
              fontWeight: 500,
              color: "#15803d",
              background: "rgba(34,197,94,0.08)",
              border: "1px solid rgba(34,197,94,0.18)",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#22c55e",
              }}
            />
            Brain connected{modelStatus?.active?.label ? ` · ${modelStatus.active.label}` : ""}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={() => (wizardOpen ? setWizardOpen(false) : setWizardOpen(true))}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-all hover:scale-[1.03]"
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                color: "#b45309",
                background: "rgba(245,158,11,0.09)",
                border: "1px solid rgba(245,158,11,0.28)",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#f59e0b",
                }}
              />
              Not connected — connect in 30 seconds →
            </button>
            {wizardOpen && (
              <div
                className="flex w-full max-w-[280px] flex-col gap-2 rounded-xl px-3 py-3"
                style={{ border: "1px solid rgba(245,158,11,0.3)", background: "rgb(var(--chrome-bg) / 0.9)" }}
              >
                <span style={{ fontSize: 10.5, color: "#374151" }}>
                  1. Get a free key at <b>console.groq.com/keys</b> (30s) · 2. Paste it below:
                </span>
                <input
                  type="password"
                  value={wizardKey}
                  onChange={(e) => setWizardKey(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleWizardSave()}
                  placeholder="gsk_…"
                  spellCheck={false}
                  autoComplete="off"
                  className="w-full rounded-lg px-2.5 py-2 outline-none"
                  style={{ fontSize: 11.5, border: "1px solid rgb(var(--chrome-line) / 0.12)", color: "rgb(var(--chrome-text))" }}
                />
                <button
                  onClick={handleWizardSave}
                  disabled={wizardState === "saving" || !wizardKey.trim()}
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#fff",
                    background: wizardState === "saving" ? "rgba(0,0,0,0.25)" : "#0c6b8f",
                    border: "none",
                    borderRadius: 8,
                    padding: "6px 0",
                    cursor: wizardState === "saving" || !wizardKey.trim() ? "default" : "pointer",
                  }}
                >
                  {wizardState === "saving" ? "Connecting…" : "Connect my companion"}
                </button>
                {wizardNote && (
                  <span style={{ fontSize: 9.5, color: wizardState === "ok" ? "#15803d" : "#b45309" }}>{wizardNote}</span>
                )}
                <button
                  onClick={onOpenKeySetup}
                  style={{ fontSize: 9.5, color: "rgb(var(--chrome-soft))", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
                >
                  More providers (Gemini, NVIDIA…) in Settings
                </button>
              </div>
            )}
          </div>
        )}
      </motion.div>

      {/* Quick suggestions */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.35 }}
        className="grid grid-cols-2 gap-2 w-full max-w-[280px]"
      >
        {CHAT_SUGGESTIONS.map((s) => (
          <button
            key={s.text}
            onClick={() => onSuggestionClick(s.text)}
            className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: "#374151",
              background: "rgb(var(--chrome-bg) / 0.70)",
              border: "1px solid rgb(var(--chrome-line) / 0.07)",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            <span style={{ fontSize: 14 }}>{s.icon}</span>
            <span>{s.label}</span>
          </button>
        ))}
      </motion.div>
    </div>
  );
}
