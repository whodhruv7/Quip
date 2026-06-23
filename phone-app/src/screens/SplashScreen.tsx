'use client'

// Quip Phone App — Splash Screen
// Calm. 2 seconds. No particles. No flashy gradients.

import { motion } from "framer-motion";
import { useEffect } from "react";
import { useStore } from "@/lib/quip-store";
import { colors, typography } from "@/lib/quip-design";

export function SplashScreen() {
  const { dispatch, theme } = useStore();

  useEffect(() => {
    const timer = setTimeout(() => {
      dispatch({ type: "NAVIGATE", screen: "onboarding" });
    }, 2000);
    return () => clearTimeout(timer);
  }, [dispatch]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.24 }}
      style={{
        position: "absolute",
        inset: 0,
        background: colors.bg,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
      }}
    >
      {/* Logo mark — simple, calm */}
      <motion.div
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 28, delay: 0.1 }}
        style={{
          width: 80,
          height: 80,
          borderRadius: 20,
          background: theme.primary,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.95)",
          }}
        />
      </motion.div>

      {/* Wordmark — solid white, no gradient */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        style={{
          fontSize: typography.sizes.display,
          fontWeight: typography.weights.bold,
          color: colors.textPrimary,
          letterSpacing: -0.02,
        }}
      >
        Quip
      </motion.div>

      {/* Tagline */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.24 }}
        style={{
          fontSize: typography.sizes.caption,
          color: colors.textTertiary,
          margin: 0,
        }}
      >
        Your AI Life Companion
      </motion.p>
    </motion.div>
  );
}
