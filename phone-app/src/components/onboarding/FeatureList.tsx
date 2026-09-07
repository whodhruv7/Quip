import React from "react";
import { motion } from "framer-motion";
import { space, radius, typography, colors } from "@/lib/quip-design";
import { ANIM_DURATION, FEATURES } from "./constants";

export function FeatureList({ themePrimary }: { themePrimary: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.45, duration: ANIM_DURATION }}
      style={{ display: "flex", flexDirection: "column", gap: space.sm, marginBottom: space.xl }}
    >
      {FEATURES.map((f) => (
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
              background: `${themePrimary}12`,
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
  );
}
