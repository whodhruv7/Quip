import React from "react";
import { motion } from "framer-motion";
import { colors, space, typography, radius } from "@/lib/quip-design";

export function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        padding: `${space.md}px ${space.base}px`,
        borderRadius: radius.md,
        background: colors.card,
        border: `0.5px solid ${colors.border}`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function DNABar({ label, value, max, display, color }: { label: string; value: number; max: number; display: string; color: string }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: typography.sizes.caption, color: colors.textSecondary }}>{label}</span>
        <span style={{ fontSize: typography.sizes.caption, fontWeight: typography.weights.medium, color: colors.textPrimary }}>{display}</span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: colors.glassLight, overflow: "hidden" }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          style={{ height: "100%", borderRadius: 2, background: color }}
        />
      </div>
    </div>
  );
}

export function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card style={{ padding: `${space.md}px ${space.base}px` }}>
      <div style={{ fontSize: typography.sizes.small, fontWeight: typography.weights.semibold, color: colors.textTertiary, letterSpacing: 0.01, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: typography.sizes.title, fontWeight: typography.weights.bold, color: colors.textPrimary, marginTop: 2 }}>{value}</div>
    </Card>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ display: "block", fontSize: typography.sizes.small, fontWeight: typography.weights.semibold, color: colors.textTertiary, letterSpacing: 0.01, textTransform: "uppercase", marginBottom: space.sm, marginTop: 0 }}>
      {children}
    </h2>
  );
}
