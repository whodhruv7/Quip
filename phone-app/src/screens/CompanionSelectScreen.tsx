'use client'

// Quip Phone App — Companion Selection Screen
// Three calm cards. Tap to select. Premium. No gaming style.

import { motion } from "framer-motion";
import { useStore } from "@/lib/quip-store";
import { colors, space, typography, radius } from "@/lib/quip-design";
import { companions } from "@/lib/companion-config";
import { CompanionSprite } from "@/components/companion/CompanionSprite";
import { StatusBar } from "@/components/phone/StatusBar";
import { HomeIndicator } from "@/components/phone/HomeIndicator";
import { hostBridge } from "@/lib/host-bridge";

export function CompanionSelectScreen() {
  const { state, dispatch, theme } = useStore();

  const handleSelect = (id: "pix" | "kai" | "ren") => {
    dispatch({ type: "SET_COMPANION", id });
  };

  const handleContinue = () => {
    dispatch({ type: "SET_ONBOARDED", value: true });
    dispatch({ type: "NAVIGATE", screen: "home" });
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
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

      {/* Header */}
      <div style={{ marginBottom: space.xl }}>
        <h1
          style={{
            fontSize: typography.sizes.title,
            fontWeight: typography.weights.bold,
            color: colors.textPrimary,
            letterSpacing: -0.02,
            margin: 0,
          }}
        >
          Choose your companion
        </h1>
        <p
          style={{
            fontSize: typography.sizes.body,
            color: colors.textSecondary,
            margin: `${space.xs}px 0 0`,
            lineHeight: 1.4,
          }}
        >
          Each has a unique personality. Switch anytime.
        </p>
      </div>

      {/* Companion cards */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: space.md }}>
        {companions.map((companion, idx) => {
          const isSelected = state.companionId === companion.id;
          return (
            <motion.div
              key={companion.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + idx * 0.06, duration: 0.24 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleSelect(companion.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  handleSelect(companion.id);
                }
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: space.base,
                padding: space.lg,
                borderRadius: radius.lg,
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                background: isSelected ? `${companion.primary}0D` : colors.card,
                boxShadow: isSelected
                  ? `inset 0 0 0 1.5px ${companion.primary}40`
                  : `inset 0 0 0 1.5px ${colors.border}`,
                transition: "all 0.18s ease",
                textAlign: "left",
              }}
            >
              {/* Sprite */}
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: radius.md,
                  background: `${companion.primary}10`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <CompanionSprite companion={companion} size={40} animated={false} />
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: space.sm }}>
                  <span style={{ fontSize: typography.sizes.section, fontWeight: typography.weights.bold, color: colors.textPrimary }}>
                    {companion.name}
                  </span>
                  <span style={{ fontSize: typography.sizes.small, color: companion.primary, fontWeight: typography.weights.medium }}>
                    {companion.tagline}
                  </span>
                </div>
                <p
                  style={{
                    fontSize: typography.sizes.caption,
                    color: colors.textTertiary,
                    margin: "4px 0 0",
                    lineHeight: 1.4,
                  }}
                >
                  {companion.description}
                </p>
              </div>

              {/* Selection indicator & Spawn */}
              <div style={{ display: "flex", flexDirection: "column", gap: space.sm, alignItems: "flex-end" }}>
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    border: isSelected
                      ? `6px solid ${companion.primary}`
                      : `2px solid ${colors.borderStrong}`,
                    flexShrink: 0,
                    transition: "all 0.18s ease",
                  }}
                />
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    hostBridge.spawnCompanion(companion.id);
                  }}
                  style={{
                    padding: "4px 8px",
                    borderRadius: radius.sm,
                    background: `${companion.primary}22`,
                    color: companion.primary,
                    border: "none",
                    fontSize: typography.sizes.caption,
                    fontWeight: typography.weights.bold,
                    cursor: "pointer",
                  }}
                >
                  Spawn
                </motion.button>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Continue */}
      <motion.button
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.24 }}
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
          marginTop: space.lg,
        }}
      >
        Continue with {companions.find((c) => c.id === state.companionId)?.name}
      </motion.button>

      <HomeIndicator />
    </motion.div>
  );
}
