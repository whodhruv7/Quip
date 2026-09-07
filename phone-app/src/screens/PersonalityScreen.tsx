'use client'

// Quip Phone App — Personality Dashboard
// Communication DNA. Stats. Insights. No emojis. Calm.

import { motion } from "framer-motion";
import { useStore } from "@/lib/quip-store";
import { colors, space, typography, radius } from "@/lib/quip-design";
import { getCompanion } from "@/lib/companion-config";
import { CompanionSprite } from "@/components/companion/CompanionSprite";
import { StatusBar } from "@/components/phone/StatusBar";
import { HomeIndicator } from "@/components/phone/HomeIndicator";
import { TabBar } from "@/components/phone/TabBar";
import React from "react";
import { DNA_THRESHOLDS, generateInsights, UserProfile, Topic } from "@/lib/personality/insights";
import { Card, DNABar, StatCard, SectionTitle } from "@/components/personality/PersonalityComponents";

export function PersonalityScreen() {
  const { state, theme } = useStore();
  
  if (!state || !state.profile) {
    return <div style={{ background: colors.bg, position: "absolute", inset: 0 }}>Loading...</div>;
  }

  const profile = state.profile as UserProfile;
  const companion = getCompanion(state.companionId);

  if (!companion) {
    return <div style={{ background: colors.bg, position: "absolute", inset: 0 }}>Invalid Companion</div>;
  }

  const insights = generateInsights(profile);

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

      <div style={{ padding: `${space.xl}px ${space.base}px ${space.md}px` }}>
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
          style={{ marginBottom: space.xl }}
        >
          <Card style={{ display: "flex", alignItems: "center", gap: space.base }}>
            <CompanionSprite companion={companion} size={48} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: typography.sizes.body, fontWeight: typography.weights.bold, color: colors.textPrimary }}>{companion.name}</div>
              <div style={{ fontSize: typography.sizes.caption, color: colors.textTertiary }}>{companion.personality}</div>
            </div>
          </Card>
        </motion.div>

        {/* DNA bars */}
        <SectionTitle>Communication DNA</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: space.lg, marginBottom: space.xl }}>
          <DNABar label="Response length" value={profile.preferredLength} max={DNA_THRESHOLDS.maxWords} display={`${Math.round(profile.preferredLength)} words`} color={theme.primary} />
          <DNABar label="Formality" value={profile.formality * 100} max={100} display={profile.formality < DNA_THRESHOLDS.formality.low ? "Casual" : profile.formality < DNA_THRESHOLDS.formality.high ? "Balanced" : "Formal"} color={theme.primary} />
          <DNABar label="Emoji usage" value={profile.emojiUsage * 100} max={100} display={profile.emojiUsage < DNA_THRESHOLDS.emoji.low ? "Rarely" : profile.emojiUsage < DNA_THRESHOLDS.emoji.high ? "Sometimes" : "Often"} color={theme.primary} />
          <DNABar label="Humor" value={profile.humorLevel * 100} max={100} display={profile.humorLevel < DNA_THRESHOLDS.humor.low ? "Serious" : profile.humorLevel < DNA_THRESHOLDS.humor.high ? "Light" : "Playful"} color={theme.primary} />
        </div>

        {/* Stats */}
        <SectionTitle>Stats</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: space.sm, marginBottom: space.xl }}>
          <StatCard label="Interactions" value={profile.totalInteractions} />
          <StatCard label="Memories" value={state.memories?.length ?? 0} />
        </div>

        {/* Top topics */}
        {profile.topTopics && profile.topTopics.length > 0 && (
          <>
            <SectionTitle>Top topics</SectionTitle>
            <div style={{ display: "flex", flexWrap: "wrap", gap: space.sm, marginBottom: space.xl }}>
              {profile.topTopics.map((t: Topic) => (
                <div
                  key={t.topic}
                  style={{
                    padding: `${space.sm}px ${space.md}px`,
                    borderRadius: radius.full,
                    background: `${theme.primary}22`,
                    border: `0.5px solid ${theme.primary}44`,
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

        {/* Insights */}
        <SectionTitle>Insights</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: space.sm }}>
          {insights.map((insight, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06, duration: 0.18 }}
            >
              <Card style={{ display: "flex", alignItems: "center", gap: space.md }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: theme.primary, flexShrink: 0 }} />
                <span style={{ fontSize: typography.sizes.caption, color: colors.textSecondary, lineHeight: 1.4 }}>{insight}</span>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>

      <TabBar />
      <HomeIndicator />
    </motion.div>
  );
}
