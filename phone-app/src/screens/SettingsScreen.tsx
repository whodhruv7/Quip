'use client'

// Quip Phone App — Settings Screen
// Apple-style grouped settings. Every toggle works. Calm.

import { motion } from "framer-motion";
import { useState } from "react";
import { useStore } from "@/lib/quip-store";
import { themes, styles, colors, space, typography, radius } from "@/lib/quip-design";
import { getCompanion, companions } from "@/lib/companion-config";
import { StatusBar } from "@/components/phone/StatusBar";
import { HomeIndicator } from "@/components/phone/HomeIndicator";
import { TabBar } from "@/components/phone/TabBar";

export function SettingsScreen() {
  const { state, dispatch, theme } = useStore();
  const [haptics, setHaptics] = useState(true);
  const [sounds, setSounds] = useState(false);
  const [autoMemory, setAutoMemory] = useState(true);

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
          Settings
        </h1>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: `0 ${space.base}px 100px`,
        }}
      >
        {/* Theme picker */}
        <Section title="Appearance">
          <Label>Theme</Label>
          <div style={{ display: "flex", gap: space.md, marginBottom: space.lg }}>
            {themes.map((t) => {
              const isActive = t.id === state.themeId;
              return (
                <motion.button
                  key={t.id}
                  whileTap={{ scale: 0.95 }}
                  transition={{ duration: 0.12 }}
                  onClick={() => dispatch({ type: "SET_THEME", id: t.id })}
                  style={{
                    flex: 1,
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                    fontFamily: "inherit",
                    background: "transparent",
                  }}
                >
                  <div
                    style={{
                      aspectRatio: "1",
                      borderRadius: radius.md,
                      background: t.primary,
                      marginBottom: 6,
                      border: isActive ? `2px solid ${t.primary}` : "2px solid transparent",
                      opacity: isActive ? 1 : 0.4,
                      transition: "all 0.18s",
                    }}
                  />
                  <div style={{ fontSize: typography.sizes.caption, fontWeight: typography.weights.medium, color: isActive ? colors.textPrimary : colors.textTertiary }}>{t.name}</div>
                </motion.button>
              );
            })}
          </div>

          <Label>Keyboard style</Label>
          <div style={{ display: "flex", flexDirection: "column", gap: space.xs }}>
            {styles.map((s) => {
              const isActive = s.id === state.styleId;
              return (
                <button
                  key={s.id}
                  onClick={() => dispatch({ type: "SET_STYLE", id: s.id })}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: `${space.md}px ${space.base}px`,
                    borderRadius: radius.sm,
                    border: "none",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    background: isActive ? `${theme.primary}0D` : "transparent",
                    color: colors.textPrimary,
                    fontSize: typography.sizes.body,
                    textAlign: "left",
                    transition: "background 0.18s",
                  }}
                >
                  <span>{s.name}</span>
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      border: isActive ? `5px solid ${theme.primary}` : `2px solid ${colors.borderStrong}`,
                      transition: "all 0.18s",
                    }}
                  />
                </button>
              );
            })}
          </div>
        </Section>

        {/* Companion */}
        <Section title="Companion">
          <div style={{ display: "flex", flexDirection: "column", gap: space.xs }}>
            {(["pix", "kai", "ren"] as const).map((id) => {
              const c = getCompanion(id);
              const isActive = state.companionId === id;
              return (
                <button
                  key={id}
                  onClick={() => dispatch({ type: "SET_COMPANION", id })}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: space.md,
                    padding: `${space.md}px ${space.base}px`,
                    borderRadius: radius.sm,
                    border: "none",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    background: isActive ? `${c.primary}0D` : "transparent",
                    color: colors.textPrimary,
                    textAlign: "left",
                    transition: "background 0.18s",
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      background: c.primary,
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: typography.sizes.body, fontWeight: typography.weights.medium }}>{c.name}</div>
                    <div style={{ fontSize: typography.sizes.small, color: colors.textTertiary }}>{c.personality}</div>
                  </div>
                  {isActive && <span style={{ color: c.primary, fontSize: typography.sizes.body }}>✓</span>}
                </button>
              );
            })}
          </div>
        </Section>

        {/* Preferences */}
        <Section title="Preferences">
          <Toggle label="Haptic feedback" desc="Vibrate on key press" value={haptics} onChange={setHaptics} />
          <Toggle label="Sound effects" desc="Subtle sounds on send" value={sounds} onChange={setSounds} />
          <Toggle label="Auto memory" desc="Learn from conversations" value={autoMemory} onChange={setAutoMemory} />
        </Section>

        {/* About */}
        <Section title="About">
          <Row label="Version" value="2.0.0" />
          <Row label="Made by" value="Dhruv Sharma" />
          <Row label="Companion" value={getCompanion(state.companionId).name} />
        </Section>

        {/* Reset */}
        <button
          onClick={() => {
            dispatch({ type: "CLEAR_MESSAGES" });
            dispatch({ type: "NAVIGATE", screen: "splash" });
          }}
          style={{
            width: "100%",
            padding: space.base,
            borderRadius: radius.md,
            border: "none",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: typography.sizes.body,
            fontWeight: typography.weights.medium,
            color: colors.danger,
            background: `${colors.danger}0D`,
            marginTop: space.sm,
          }}
        >
          Reset App
        </button>
      </div>

      <TabBar />
      <HomeIndicator />
    </motion.div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: space.xl }}>
      <label style={{ display: "block", fontSize: typography.sizes.small, fontWeight: typography.weights.semibold, color: colors.textTertiary, letterSpacing: 0.01, textTransform: "uppercase", marginBottom: space.sm, marginLeft: 4 }}>
        {title}
      </label>
      <div
        style={{
          background: colors.card,
          borderRadius: radius.md,
          border: `0.5px solid ${colors.border}`,
          padding: space.sm,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label style={{ display: "block", fontSize: typography.sizes.small, fontWeight: typography.weights.medium, color: colors.textTertiary, letterSpacing: 0.01, textTransform: "uppercase", marginBottom: space.sm, marginLeft: 4 }}>
      {children}
    </label>
  );
}

function Toggle({ label, desc, value, onChange }: { label: string; desc: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: `${space.md}px ${space.base}px` }}>
      <div>
        <div style={{ fontSize: typography.sizes.body, color: colors.textPrimary }}>{label}</div>
        <div style={{ fontSize: typography.sizes.small, color: colors.textTertiary, marginTop: 2 }}>{desc}</div>
      </div>
      <motion.button
        whileTap={{ scale: 0.92 }}
        transition={{ duration: 0.12 }}
        onClick={() => onChange(!value)}
        style={{
          width: 44,
          height: 26,
          borderRadius: 13,
          border: "none",
          cursor: "pointer",
          background: value ? colors.success : colors.glassLight,
          position: "relative",
          transition: "background 0.18s",
        }}
        aria-label={label}
      >
        <motion.div
          animate={{ x: value ? 18 : 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          style={{
            position: "absolute",
            top: 2,
            left: 2,
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: "#FFFFFF",
          }}
        />
      </motion.button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: `${space.md}px ${space.base}px` }}>
      <span style={{ fontSize: typography.sizes.body, color: colors.textPrimary }}>{label}</span>
      <span style={{ fontSize: typography.sizes.body, color: colors.textTertiary }}>{value}</span>
    </div>
  );
}
