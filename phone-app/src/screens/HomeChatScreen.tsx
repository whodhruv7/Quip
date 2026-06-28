'use client'

// Quip Phone App — Home Chat Screen
// Apple Messages quality. Calm bubbles. Beautiful streaming.
// Input bar grows naturally. Keyboard integrates seamlessly.

import { motion, AnimatePresence } from "framer-motion";
import { useRef, useEffect, useCallback } from "react";
import { useStore, uid } from "@/lib/quip-store";
import { getStyle, colors, space, typography, radius } from "@/lib/quip-design";
import { getCompanion } from "@/lib/companion-config";
import { CompanionSprite } from "@/components/companion/CompanionSprite";
import { StatusBar } from "@/components/phone/StatusBar";
import { HomeIndicator } from "@/components/phone/HomeIndicator";
import { TabBar } from "@/components/phone/TabBar";
import { QuipKeyboard } from "@/components/keyboard/QuipKeyboard";

export function HomeChatScreen() {
  const { state, dispatch, theme, style } = useStore();
  const companion = getCompanion(state.companionId);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [state.messages]);

  const handleSend = useCallback(() => {
    const text = state.typedText.trim();
    if (!text) return;

    const userMsg = {
      id: uid(),
      role: "user" as const,
      content: text,
      ts: Date.now(),
      tone: state.activeTone ?? undefined,
    };
    dispatch({ type: "ADD_MESSAGE", message: userMsg });
    dispatch({ type: "SET_TYPED", text: "" });

    // Simulate AI response
    const aiId = uid();
    setTimeout(() => {
      dispatch({
        type: "ADD_MESSAGE",
        message: {
          id: aiId,
          role: "assistant",
          content: "",
          ts: Date.now(),
          streaming: true,
        },
      });

      const response = generateResponse(text, state.activeTone, companion.name);
      let idx = 0;
      const interval = setInterval(() => {
        idx += 2;
        const partial = response.slice(0, idx);
        dispatch({ type: "UPDATE_MESSAGE", id: aiId, content: partial });
        if (idx >= response.length) {
          clearInterval(interval);
          dispatch({ type: "FINISH_STREAM", id: aiId });
        }
      }, 20);
    }, 400);
  }, [state.typedText, state.activeTone, companion.name, dispatch]);

  const handleKeyPress = useCallback(
    (char: string) => {
      dispatch({
        type: "SET_TYPED",
        text:
          char === "delete"
            ? state.typedText.slice(0, -1)
            : char === "return"
              ? state.typedText + "\n"
              : state.typedText + char,
      });
    },
    [state.typedText, dispatch]
  );

  const handleToneSelect = useCallback(
    (toneId: string) => {
      dispatch({
        type: "SET_TONE",
        tone: state.activeTone === toneId ? null : toneId,
      });
    },
    [state.activeTone, dispatch]
  );

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
      }}
    >
      <StatusBar />

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "54px 20px 12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: space.sm }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: companion.primary,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <CompanionSprite companion={companion} size={24} animated={false} />
          </div>
          <div>
            <div style={{ fontSize: typography.sizes.body, fontWeight: typography.weights.semibold, color: colors.textPrimary }}>
              {companion.name}
            </div>
            <div style={{ fontSize: typography.sizes.small, color: colors.textTertiary }}>
              {state.activeTone ? `${state.activeTone}` : "Online"}
            </div>
          </div>
        </div>

        {/* New chat */}
        <motion.button
          whileTap={{ scale: 0.92 }}
          transition={{ duration: 0.12 }}
          onClick={() => dispatch({ type: "CLEAR_MESSAGES" })}
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            border: "none",
            cursor: "pointer",
            background: colors.glassLight,
            color: colors.textSecondary,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          aria-label="New chat"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </motion.button>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: `${space.sm}px ${space.base}px`,
          display: "flex",
          flexDirection: "column",
          gap: space.md,
        }}
      >
        {state.messages.length === 0 ? (
          <WelcomeState companion={companion} onSuggestion={(s) => dispatch({ type: "SET_TYPED", text: s })} />
        ) : (
          <AnimatePresence initial={false}>
            {state.messages.map((msg) => (
              <ChatBubble key={msg.id} message={msg} companion={companion} />
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* Input bar */}
      <div
        style={{
          padding: `${space.sm}px ${space.base}px`,
          borderTop: `0.5px solid ${colors.border}`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: space.sm,
            background: colors.card,
            borderRadius: radius.lg,
            padding: `${space.sm}px ${space.sm}px ${space.sm}px ${space.base}px`,
            minHeight: 44,
            border: `0.5px solid ${colors.border}`,
          }}
        >
          <textarea
            value={state.typedText}
            onChange={(e) => dispatch({ type: "SET_TYPED", text: e.target.value })}
            onFocus={() => dispatch({ type: "SET_KEYBOARD", show: true })}
            placeholder="Ask anything..."
            rows={1}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              resize: "none",
              color: colors.textPrimary,
              fontSize: typography.sizes.body,
              fontFamily: "inherit",
              lineHeight: 1.4,
              maxHeight: 100,
            }}
          />
          <motion.button
            whileTap={{ scale: 0.9 }}
            transition={{ duration: 0.12 }}
            onClick={handleSend}
            disabled={!state.typedText.trim()}
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              border: "none",
              cursor: state.typedText.trim() ? "pointer" : "default",
              background: state.typedText.trim() ? theme.primary : colors.glassLight,
              color: "#FFFFFF",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              opacity: state.typedText.trim() ? 1 : 0.4,
              transition: "opacity 0.18s, background 0.18s",
            }}
            aria-label="Send"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </motion.button>
        </div>
      </div>

      {/* Keyboard — FIX: use actual style from store, not hardcoded */}
      {state.showKeyboard && (
        <QuipKeyboard
          theme={theme}
          style={style}
          activeTone={state.activeTone}
          onKeyPress={handleKeyPress}
          onToneSelect={handleToneSelect}
          onAIRequest={() => dispatch({ type: "SET_TYPED", text: state.typedText + " ✨" })}
        />
      )}

      {!state.showKeyboard && <TabBar />}
      <HomeIndicator />
    </motion.div>
  );
}

// ─── Welcome State ────────────────────────────────────────────────────────────
function WelcomeState({
  companion,
  onSuggestion,
}: {
  companion: ReturnType<typeof getCompanion>;
  onSuggestion: (text: string) => void;
}) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : hour < 21 ? "Good evening" : "Hey there";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.24 }}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: space.lg,
        padding: `${space.xl}px 0`,
      }}
    >
      <CompanionSprite companion={companion} size={72} state="idle" />

      <div style={{ textAlign: "center" }}>
        <h2 style={{ fontSize: typography.sizes.section, fontWeight: typography.weights.bold, color: colors.textPrimary, margin: 0, letterSpacing: -0.02 }}>
          {greeting}. I'm {companion.name}
        </h2>
        <p style={{ fontSize: typography.sizes.body, color: colors.textSecondary, margin: `${space.xs}px 0 0`, lineHeight: 1.4 }}>
          {companion.tagline}. How can I help?
        </p>
      </div>

      {/* Suggestions — clean, no clutter */}
      <div style={{ display: "flex", flexDirection: "column", gap: space.sm, width: "100%", maxWidth: 280 }}>
        {[
          "What can you do?",
          "Help me write a message",
          "Tell me about yourself",
        ].map((s) => (
          <motion.button
            key={s}
            whileTap={{ scale: 0.97 }}
            transition={{ duration: 0.12 }}
            onClick={() => onSuggestion(s)}
            style={{
              padding: `${space.md}px ${space.base}px`,
              borderRadius: radius.md,
              border: `0.5px solid ${colors.border}`,
              background: colors.card,
              color: colors.textSecondary,
              fontSize: typography.sizes.caption,
              cursor: "pointer",
              fontFamily: "inherit",
              textAlign: "left",
            }}
          >
            {s}
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}

// ─── Chat Bubble ──────────────────────────────────────────────────────────────
function ChatBubble({
  message,
  companion,
}: {
  message: ReturnType<typeof useStore>["state"]["messages"][0];
  companion: ReturnType<typeof getCompanion>;
}) {
  const isUser = message.role === "user";
  const empty = message.content.length === 0 && message.streaming;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
      }}
    >
      <div
        style={{
          maxWidth: "78%",
          padding: `${space.md}px ${space.base}px`,
          borderRadius: isUser ? `${radius.md} ${radius.md} ${radius.sm} ${radius.md}` : `${radius.md} ${radius.md} ${radius.md} ${radius.sm}`,
          background: isUser ? companion.primary : colors.card,
          color: colors.textPrimary,
          fontSize: typography.sizes.body,
          lineHeight: 1.45,
        }}
      >
        {empty ? (
          <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
            {[0, 0.2, 0.4].map((d) => (
              <motion.span
                key={d}
                animate={{ opacity: [0.3, 0.8, 0.3] }}
                transition={{ duration: 1, repeat: Infinity, delay: d }}
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: companion.primary,
                  display: "inline-block",
                }}
              />
            ))}
          </span>
        ) : (
          <>
            <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{message.content}</span>
            {message.streaming && (
              <motion.span
                animate={{ opacity: [1, 0, 1] }}
                transition={{ duration: 0.8, repeat: Infinity }}
                style={{
                  display: "inline-block",
                  width: 2,
                  height: 14,
                  background: colors.textPrimary,
                  marginLeft: 2,
                  verticalAlign: "text-bottom",
                  opacity: 0.5,
                }}
              />
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}

// ─── Response generator ────────────────────────────────────────────────────────
function generateResponse(text: string, tone: string | null, companionName: string): string {
  const lower = text.toLowerCase();

  if (lower.includes("what can you do")) {
    return `I'm ${companionName}, your AI companion. I can:\n\n- Answer questions and explain things\n- Help you write messages in different tones\n- Remember things about you\n- Adapt to your communication style\n\nJust ask me anything.`;
  }

  if (lower.includes("write") && lower.includes("message")) {
    const toneNote = tone ? ` in a ${tone} tone` : "";
    return `Sure! I'd love to help you write that message${toneNote}. What's it for — a text, email, or social post? And who's it for?`;
  }

  if (lower.includes("about you") || lower.includes("who are you")) {
    return `I'm ${companionName} — your AI companion. I'm here to help you communicate better, remember what matters, and grow alongside you. Think of me as a friend who actually gets you.`;
  }

  const tonePrefix = tone ? `[${tone}] ` : "";
  return `${tonePrefix}That's a great question. I'm ${companionName} and I'm here to help. Let me think about "${text}"...\n\nCould you tell me a bit more about what you're looking for?`;
}
