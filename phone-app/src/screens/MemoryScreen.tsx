'use client'

// Quip Phone App — Memory Screen
// Beautiful memory cards. Pinned + Recent. Searchable.
// No emojis. No technical jargon. Calm.

import { motion } from "framer-motion";
import { useState } from "react";
import { useStore } from "@/lib/quip-store";
import { colors, space, typography, radius } from "@/lib/quip-design";
import { StatusBar } from "@/components/phone/StatusBar";
import { HomeIndicator } from "@/components/phone/HomeIndicator";
import { TabBar } from "@/components/phone/TabBar";

export function MemoryScreen() {
  const { state, dispatch, theme } = useStore();
  const [search, setSearch] = useState("");

  const filtered = state.memories.filter(
    (m) =>
      m.key.toLowerCase().includes(search.toLowerCase()) ||
      m.value.toLowerCase().includes(search.toLowerCase())
  );

  const pinned = filtered.filter((m) => m.pinned);
  const recent = filtered.filter((m) => !m.pinned);

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

      {/* Header */}
      <div style={{ padding: "54px 20px 12px" }}>
        <h1 style={{ fontSize: typography.sizes.title, fontWeight: typography.weights.bold, color: colors.textPrimary, letterSpacing: -0.02, margin: 0 }}>
          Memory
        </h1>
        <p style={{ fontSize: typography.sizes.caption, color: colors.textTertiary, margin: "4px 0 0" }}>
          What Quip knows about you
        </p>
      </div>

      {/* Search */}
      <div style={{ padding: `0 ${space.base}px ${space.md}px` }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: space.sm,
            background: colors.card,
            borderRadius: radius.md,
            padding: `${space.md}px ${space.base}px`,
            border: `0.5px solid ${colors.border}`,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={colors.textTertiary} strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search memories..."
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: colors.textPrimary,
              fontSize: typography.sizes.body,
              fontFamily: "inherit",
            }}
          />
        </div>
      </div>

      {/* Memory list */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: `0 ${space.base}px 100px`,
        }}
      >
        {pinned.length > 0 && (
          <>
            <Label>Pinned</Label>
            <div style={{ display: "flex", flexDirection: "column", gap: space.sm, marginBottom: space.xl }}>
              {pinned.map((m) => (
                <MemoryCard
                  key={m.id}
                  memory={m}
                  onTogglePin={() => dispatch({ type: "TOGGLE_PIN_MEMORY", id: m.id })}
                  onDelete={() => dispatch({ type: "DELETE_MEMORY", id: m.id })}
                  accent={theme.primary}
                />
              ))}
            </div>
          </>
        )}

        {recent.length > 0 && (
          <>
            <Label>Recent</Label>
            <div style={{ display: "flex", flexDirection: "column", gap: space.sm }}>
              {recent.map((m) => (
                <MemoryCard
                  key={m.id}
                  memory={m}
                  onTogglePin={() => dispatch({ type: "TOGGLE_PIN_MEMORY", id: m.id })}
                  onDelete={() => dispatch({ type: "DELETE_MEMORY", id: m.id })}
                  accent={theme.primary}
                />
              ))}
            </div>
          </>
        )}

        {filtered.length === 0 && (
          <EmptyState
            title="No memories yet"
            desc="Quip learns as you chat. Memories appear here automatically."
          />
        )}
      </div>

      <TabBar />
      <HomeIndicator />
    </motion.div>
  );
}

function MemoryCard({
  memory,
  onTogglePin,
  onDelete,
  accent,
}: {
  memory: { id: string; key: string; value: string; kind: string; importance: string; pinned: boolean };
  onTogglePin: () => void;
  onDelete: () => void;
  accent: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
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
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: space.sm, marginBottom: 2 }}>
          <span style={{ fontSize: typography.sizes.caption, fontWeight: typography.weights.semibold, color: colors.textPrimary }}>{memory.key}</span>
          <span
            style={{
              fontSize: typography.sizes.small,
              fontWeight: 500,
              color: accent,
              background: `${accent}12`,
              padding: "2px 8px",
              borderRadius: radius.sm,
              textTransform: "capitalize",
            }}
          >
            {memory.kind}
          </span>
          {memory.importance === "high" && (
            <span style={{ fontSize: typography.sizes.small, color: colors.textTertiary }}>High</span>
          )}
        </div>
        <p style={{ fontSize: typography.sizes.caption, color: colors.textSecondary, margin: 0, lineHeight: 1.4, wordBreak: "break-word" }}>
          {memory.value}
        </p>
      </div>

      <div style={{ display: "flex", gap: space.xs }}>
        <motion.button
          whileTap={{ scale: 0.88 }}
          transition={{ duration: 0.12 }}
          onClick={onTogglePin}
          style={{
            width: 28,
            height: 28,
            borderRadius: radius.sm,
            border: "none",
            cursor: "pointer",
            background: memory.pinned ? `${accent}12` : "transparent",
            color: memory.pinned ? accent : colors.textTertiary,
            fontSize: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          aria-label={memory.pinned ? "Unpin" : "Pin"}
        >
          {memory.pinned ? "Pinned" : "Pin"}
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.88 }}
          transition={{ duration: 0.12 }}
          onClick={onDelete}
          style={{
            width: 28,
            height: 28,
            borderRadius: radius.sm,
            border: "none",
            cursor: "pointer",
            background: "transparent",
            color: colors.textTertiary,
            fontSize: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          aria-label="Delete"
        >
          ×
        </motion.button>
      </div>
    </motion.div>
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
        marginBottom: space.sm,
      }}
    >
      {children}
    </label>
  );
}

function EmptyState({ title, desc }: { title: string; desc: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "60px 20px",
        textAlign: "center",
      }}
    >
      <h3 style={{ fontSize: typography.sizes.section, fontWeight: typography.weights.semibold, color: colors.textPrimary, margin: 0 }}>{title}</h3>
      <p style={{ fontSize: typography.sizes.caption, color: colors.textTertiary, margin: "8px 0 0", lineHeight: 1.4, maxWidth: 240 }}>{desc}</p>
    </div>
  );
}
