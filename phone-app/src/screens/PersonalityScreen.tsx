'use client'

// Quip Phone App — Personality Dashboard
// Communication DNA. Stats. Insights. No emojis. Calm.

import { motion } from "framer-motion";
import { useStore } from "@/lib/quip-store";
import { getCompanion, colors, space, typography, radius } from "@/lib/quip-design";
import { CompanionSprite } from "@/components/companion/CompanionSprite";
import { StatusBar } from "@/components/phone/StatusBar";
import { HomeIndicator } from "@/components/phone/HomeIndicator";
import { TabBar } from "@/components/phone/TabBar";

export function PersonalityScreen() {
  const { state, theme } = useStore();
  const { profile } = state;
  const companion = getCompanion(state.companionId);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.24 }}
      style={{
        position: "absolute",
        inset: 0,
        background: colors.bg,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <StatusBar />

      <div style={{ padding: "54px 20px 16px" }}>
        <h1 style={{ fontSize: typography.sizes.title, fontWeight: typography.weights.bold, color: colors.textPrimary, letterSpacing: -0.02, margin: 0 }}>
          You
        </h1>
        <p style={{ fontSize: typography.sizes.caption, color: colors.textTertiary, margin: "4px 0 0" }}>
          Your Communication DNA
        </p>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: `0 ${space.base}px 100px`,
        }}
      >
        {/* Companion card */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24 }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: space.base,
            padding: space.base,
            borderRadius: radius.lg,
            background: colors.card,
            border: `0.5px solid ${colors.border}`,
            marginBottom: space.xl,
          }}
        >
          <CompanionSprite companion={companion} size={48} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: typography.sizes.body, fontWeight: typography.weights.bold, color: colors.textPrimary }}>{companion.name}</div>
            <div style={{ fontSize: typography.sizes.caption, color: colors.textTertiary }}>{companion.personality}</div>
          </div>
        </motion.div>

        {/* DNA bars */}
        <Label>Communication DNA</Label>
        <div style={{ display: "flex", flexDirection: "column", gap: space.lg, marginBottom: space.xl }}>
          <DNABar label="Response length" value={profile.preferredLength} max={300} display={`${Math.round(profile.preferredLength)} words`} color={theme.primary} />
          <DNABar label="Formality" value={profile.formality * 100} max={100} display={profile.formality < 0.3 ? "Casual" : profile.formality < 0.7 ? "Balanced" : "Formal"} color={theme.primary} />
          <DNABar label="Emoji usage" value={profile.emojiUsage * 100} max={100} display={profile.emojiUsage < 0.3 ? "Rarely" : profile.emojiUsage < 0.6 ? "Sometimes" : "Often"} color={theme.primary} />
          <DNABar label="Humor" value={profile.humorLevel * 100} max={100} display={profile.humorLevel < 0.3 ? "Serious" : profile.humorLevel < 0.6 ? "Light" : "Playful"} color={theme.primary} />
        </div>

        {/* Stats */}
        <Label>Stats</Label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: space.sm, marginBottom: space.xl }}>
          <StatCard label="Interactions" value={profile.totalInteractions} />
          <StatCard label="Memories" value={state.memories.length} />
        </div>

        {/* Top topics */}
        {profile.topTopics.length > 0 && (
          <>
            <Label>Top topics</Label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: space.sm, marginBottom: space.xl }}>
              {profile.topTopics.map((t) => (
                <div
                  key={t.topic}
                  style={{
                    padding: `${space.sm}px ${space.md}px`,
                    borderRadius: radius.full,
                    background: `${theme.primary}10`,
                    border: `0.5px solid ${theme.primary}20`,
                    fontSize: typography.sizes.caption,
                    fontWeight: typography.weights.medium,
                    color: theme.primary,
                  }}
                >
                  {t.topic} · {t.count}
                </div>
              ))}
            </div>
          </>
        )}

        {/* Insights — no emojis, clean text */}
        <Label>Insights</Label>
        <div style={{ display: "flex", flexDirection: "column", gap: space.sm }}>
          {[
            "You prefer shorter, direct responses",
            "You use emojis frequently in your messages",
            "You're most active in the evenings",
            "Coding is your top topic — 23 conversations",
          ].map((insight, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06, duration: 0.18 }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: space.md,
                padding: `${space.md}px ${space.base}px`,
                borderRadius: radius.md,
                background: colors.card,
                border: `0.5px solid ${colors.border}`,
              }}
            >
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: theme.primary, flexShrink: 0 }} />
              <span style={{ fontSize: typography.sizes.caption, color: colors.textSecondary, lineHeight: 1.4 }}>{insight}</span>
            </motion.div>
          ))}
        </div>
      </div>

      <TabBar />
      <HomeIndicator />
    </motion.div>
  );
}

function DNABar({ label, value, max, display, color }: { label: string; value: number; max: number; display: string; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
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

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        padding: `${space.md}px ${space.base}px`,
        borderRadius: radius.md,
        background: colors.card,
        border: `0.5px solid ${colors.border}`,
      }}
    >
      <div style={{ fontSize: typography.sizes.small, fontWeight: typography.weights.semibold, color: colors.textTertiary, letterSpacing: 0.01, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: typography.sizes.title, fontWeight: typography.weights.bold, color: colors.textPrimary, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label style={{ display: "block", fontSize: typography.sizes.small, fontWeight: typography.weights.semibold, color: colors.textTertiary, letterSpacing: 0.01, textTransform: "uppercase", marginBottom: space.sm }}>
      {children}
    </label>
  );
}
