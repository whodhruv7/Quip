'use client'

// Quip Phone App — Onboarding Screen
// Calm welcome. Companion preview. Feature list. Continue button.

import { motion } from "framer-motion";
import { useStore } from "@/lib/quip-store";
import { getCompanion, colors, space, typography, radius } from "@/lib/quip-design";
import { StatusBar } from "@/components/phone/StatusBar";
import { HomeIndicator } from "@/components/phone/HomeIndicator";
import React from "react";
import { HeroSection } from "@/components/onboarding/HeroSection";
import { FeatureList } from "@/components/onboarding/FeatureList";
import { ANIM_DURATION, ANIM_EASE } from "@/components/onboarding/constants";

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
      transition={{ duration: ANIM_DURATION, ease: ANIM_EASE }}
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
      <HeroSection companion={companion} />

      {/* Feature list */}
      <FeatureList themePrimary={theme.primary} />

      {/* Continue button */}
      <motion.button
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: ANIM_DURATION }}
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
