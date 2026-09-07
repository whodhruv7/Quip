import React from "react";
import { motion } from "framer-motion";
import { CompanionSprite } from "@/components/companion/CompanionSprite";
import { space, typography, colors } from "@/lib/quip-design";
import { ANIM_DURATION, SPRING_STIFFNESS, SPRING_DAMPING } from "./constants";

export function HeroSection({ companion }: { companion: any }) {
  return (
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
        transition={{ delay: 0.15, type: "spring", stiffness: SPRING_STIFFNESS, damping: SPRING_DAMPING }}
      >
        <CompanionSprite companion={companion} size={100} state="idle" />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: ANIM_DURATION }}
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
  );
}
