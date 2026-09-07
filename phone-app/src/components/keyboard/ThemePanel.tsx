'use client'

// Quip Phone App — Theme Panel
// Bottom sheet. Calm. No rainbow gradients on previews.

import { motion } from "framer-motion";
import { themes, styles, type QuipTheme, type QuipStyle, space, radius, typography, colors } from "@/lib/quip-design";

interface ThemePanelProps {
  currentTheme: QuipTheme;
  currentStyle: QuipStyle;
  onThemeChange: (theme: QuipTheme) => void;
  onStyleChange: (style: QuipStyle) => void;
  onClose: () => void;
}

export function ThemePanel({
  currentTheme,
  currentStyle,
  onThemeChange,
  onStyleChange,
  onClose,
}: ThemePanelProps) {
  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.40)",
          zIndex: 90,
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
        }}
      />

      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 400, damping: 32 }}
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          background: "rgba(17, 17, 19, 0.92)",
          backdropFilter: "blur(30px)",
          WebkitBackdropFilter: "blur(30px)",
          borderRadius: "24px 24px 0 0",
          paddingBottom: 50,
          zIndex: 91,
          maxHeight: "80%",
          overflowY: "auto",
          borderTop: `0.5px solid ${colors.border}`,
        }}
      >
        {/* Grabber */}
        <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 4px" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.15)" }} />
        </div>

        {/* Header */}
        <div style={{ padding: `${space.sm}px ${space.xl}px ${space.lg}px` }}>
          <h2 style={{ fontSize: typography.sizes.title, fontWeight: typography.weights.bold, color: colors.textPrimary, letterSpacing: typography.letterSpacing.tight, margin: 0 }}>
            Customize
          </h2>
          <p style={{ fontSize: typography.sizes.caption, color: colors.textTertiary, margin: "4px 0 0" }}>
            Make Quip yours
          </p>
        </div>

        {/* Themes */}
        <div style={{ padding: `0 ${space.xl}px ${space.xl}px` }}>
          <Label>Theme</Label>
          <div style={{ display: "flex", gap: space.md }}>
            {themes.map((theme) => {
              const isActive = theme.id === currentTheme.id;
              return (
                <motion.button
                  key={theme.id}
                  onClick={() => onThemeChange(theme)}
                  whileTap={{ scale: 0.95 }}
                  transition={{ duration: 0.12 }}
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
                      background: theme.primary,
                      marginBottom: space.sm,
                      border: isActive ? `2px solid ${theme.primary}` : "2px solid transparent",
                      transition: "border-color 0.18s ease",
                      opacity: isActive ? 1 : 0.5,
                    }}
                  />
                  <div style={{ fontSize: typography.sizes.caption, fontWeight: typography.weights.medium, color: isActive ? colors.textPrimary : colors.textTertiary, transition: "color 0.18s" }}>
                    {theme.name}
                  </div>
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Styles */}
        <div style={{ padding: `0 ${space.xl}px` }}>
          <Label>Style</Label>
          <div style={{ display: "flex", flexDirection: "column", gap: space.sm }}>
            {styles.map((style) => {
              const isActive = style.id === currentStyle.id;
              return (
                <motion.button
                  key={style.id}
                  onClick={() => onStyleChange(style)}
                  whileTap={{ scale: 0.98 }}
                  transition={{ duration: 0.12 }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: `${space.md}px ${space.base}px`,
                    borderRadius: radius.md,
                    border: "none",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    background: isActive ? `${currentTheme.primary}10` : colors.glassLight,
                    transition: "background 0.18s ease",
                  }}
                >
                  <span style={{ fontSize: typography.sizes.body, fontWeight: typography.weights.medium, color: colors.textPrimary }}>
                    {style.name}
                  </span>
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      border: isActive ? `5px solid ${currentTheme.primary}` : `2px solid ${colors.borderStrong}`,
                      transition: "all 0.18s",
                      flexShrink: 0,
                    }}
                  />
                </motion.button>
              );
            })}
          </div>
        </div>
      </motion.div>
    </>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label
      style={{
        display: "block",
        fontSize: typography.sizes.small,
        fontWeight: typography.weights.semibold,
        color: colors.textTertiary,
        letterSpacing: 0.01,
        textTransform: "uppercase",
        marginBottom: space.md,
      }}
    >
      {children}
    </label>
  );
}
