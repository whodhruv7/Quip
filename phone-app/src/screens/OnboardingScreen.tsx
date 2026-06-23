'use client'

// Quip Phone App — Onboarding Screen
// Calm welcome. Companion preview. Feature list. Continue button.

import { motion } from "framer-motion";
import { useStore } from "@/lib/quip-store";
import { getCompanion, colors, space, typography, radius } from "@/lib/quip-design";
import { CompanionSprite } from "@/components/companion/CompanionSprite";
import { StatusBar } from "@/components/phone/StatusBar";
import { HomeIndicator } from "@/components/phone/HomeIndicator";

export function OnboardingScreen() {
  const { state, dispatch, theme } = useStore();
  const companion = getCompanion(state.companionId);

  const handleContinue = () => {
    dispatch({ type: "NAVIGATE", screen: "companion-select" });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      style={{
        position: "absolute",
        inset: 0,
        background: colors.bg,
        display: "flex",
        flexDirection: "column",
        padding: "54px 24px 50px",
      }}
    >
      <StatusBar />

      {/* Companion hero */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: space.xl,
        }}
      >
        <motion.div
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.15, type: "spring", stiffness: 300, damping: 28 }}
        >
          <CompanionSprite companion={companion} size={100} state="idle" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.24 }}
          style={{ textAlign: "center" }}
        >
          <h1
            style={{
              fontSize: typography.sizes.display,
              fontWeight: typography.weights.bold,
              color: colors.textPrimary,
              letterSpacing: -0.02,
              margin: 0,
              lineHeight: 1.2,
            }}
          >
            Welcome to Quip
          </h1>
          <p
            style={{
              fontSize: typography.sizes.body,
              color: colors.textSecondary,
              margin: `${space.sm}px 0 0`,
              lineHeight: 1.5,
              maxWidth: 280,
            }}
          >
            Your AI companion that understands you, remembers you, and grows with you.
          </p>
        </motion.div>
      </div>

      {/* Feature list — no emojis, clean text */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45, duration: 0.24 }}
        style={{ display: "flex", flexDirection: "column", gap: space.sm, marginBottom: space.xl }}
      >
        {[
          { title: "Learns your style", desc: "Adapts to how you communicate" },
          { title: "Remembers what matters", desc: "Context that grows over time" },
          { title: "Three companions", desc: "Pix, Kai, and Ren — switch anytime" },
        ].map((f) => (
          <div
            key={f.title}
            style={{
              display: "flex",
              alignItems: "center",
              gap: space.base,
              padding: space.base,
              borderRadius: radius.md,
              background: colors.card,
              border: `0.5px solid ${colors.border}`,
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: radius.sm,
                background: `${theme.primary}12`,
                flexShrink: 0,
              }}
            />
            <div>
              <div style={{ fontSize: typography.sizes.body, fontWeight: typography.weights.semibold, color: colors.textPrimary }}>{f.title}</div>
              <div style={{ fontSize: typography.sizes.caption, color: colors.textTertiary, marginTop: 2 }}>{f.desc}</div>
            </div>
          </div>
        ))}
      </motion.div>

      {/* Continue button */}
      <motion.button
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.24 }}
        whileTap={{ scale: 0.97 }}
        onClick={handleContinue}
        style={{
          width: "100%",
          padding: space.base,
          borderRadius: radius.md,
          border: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: typography.sizes.body,
          fontWeight: typography.weights.semibold,
          color: "#FFFFFF",
          background: theme.primary,
        }}
      >
        Get Started
      </motion.button>

      <HomeIndicator />
    </motion.div>
  );
}
