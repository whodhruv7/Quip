// Quip V2 — single chat bubble.
//
// Premium styling with CSS vars. Trust-layer notes shown beneath assistant
// messages ("Opening Edge because it's your default browser"). Action results
// get a distinct badge so the user knows Quip did something, not just said it.
//
// Polish:
//   - Copy button on assistant messages (appears on hover)
//   - Trust layer note fades in with 100ms delay (feels like an afterthought)
//   - Stagger animation on entry (50ms delay per message in batch)

import { memo, useState } from "react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage as ChatMessageType } from "@/types";
import { getCompanion } from "@/lib/companion-config";

function MessageBase({ message, index = 0, onRetry }: { message: ChatMessageType; index?: number; onRetry?: () => void }) {
  const isUser = message.role === "user";
  const empty = message.content.length === 0 && message.streaming;
  const theme = getCompanion(message.companionId ?? "pix");
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available */
    }
  };

  if (isUser) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut", delay: Math.min(index * 0.03, 0.2) }}
        className="flex justify-end group"
      >
        <div
          className="max-w-[82%] rounded-2xl rounded-br-md px-4 py-2.5 text-[14px] leading-relaxed text-white"
          style={{
            background: `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})`,
            boxShadow: `0 2px 12px ${theme.primary}25`,
          }}
        >
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut", delay: Math.min(index * 0.03, 0.2) }}
      className="flex justify-start gap-2 group"
    >
      <div
        className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
        style={{
          background: `linear-gradient(135deg, ${theme.primary}22, ${theme.secondary}18)`,
          boxShadow: "inset 0 0 0 1px rgba(var(--quip-line), 0.10)",
        }}
      >
        <span className="h-2 w-2 rounded-full" style={{ background: theme.primary }} />
      </div>

      <div className="flex max-w-[82%] flex-col gap-1">
        <div
          className="relative rounded-2xl rounded-bl-md px-4 py-2.5 text-[14px] leading-relaxed"
          style={
            message.error
              ? {
                  background: "rgba(var(--quip-bad), 0.10)",
                  color: "rgb(var(--quip-bad))",
                  border: "1px solid rgba(var(--quip-bad), 0.22)",
                }
              : {
                  // OPAQUE theme surface — readable ink in every palette.
                  background: "rgba(var(--quip-line), 0.05)",
                  color: "rgb(var(--quip-text))",
                  border: "1px solid rgba(var(--quip-line), 0.09)",
                }
          }
        >
          {empty ? (
            <span className="inline-flex items-center gap-1 text-quip-gray">
              <Dot delay={0} color={theme.primary} /> <Dot delay={0.15} color={theme.primary} />{" "}
              <Dot delay={0.3} color={theme.primary} />
            </span>
          ) : (
            <div className="quip-md break-words">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
              {message.streaming && (
                <span
                  className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse"
                  style={{ background: theme.primary }}
                />
              )}
            </div>
          )}

          {!empty && !message.streaming && !message.error && (
            <button
              onClick={handleCopy}
              aria-label={copied ? "Copied" : "Copy message"}
              className="quip-copy-btn absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-md opacity-0 transition-all group-hover:opacity-100"
              style={{ fontSize: 11, color: "rgb(var(--quip-text-soft))" }}
            >
              {copied ? "✓" : "⧉"}
            </button>
          )}
        </div>

        {message.contextNote && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.15 }}
            className="trust-note"
          >
            <span className="trust-note-dot" style={{ background: theme.primary }} />
            <span>{message.contextNote}</span>
          </motion.div>
        )}

        {/* Failed reply → one-tap retry (the failure trail is in the bubble) */}
        {message.error && onRetry && (
          <button
            onClick={onRetry}
            className="mt-0.5 flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 transition-all hover:scale-[1.04]"
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "rgb(var(--quip-accent-deep))",
              background: "rgba(var(--quip-accent), 0.12)",
              border: "1px solid rgba(var(--quip-accent), 0.4)",
              cursor: "pointer",
            }}
          >
            ↻ Try again
          </button>
        )}

        {message.action && (
          <div
            className="inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5"
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: `rgb(var(--quip-${message.action.success ? "ok" : "bad"}))`,
              background: `rgba(var(--quip-${message.action.success ? "ok" : "bad"}),0.08)`,
            }}
          >
            <span>{message.action.success ? "✓" : "✕"}</span>
            <span>{message.action.success ? "Done" : "Failed"}</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function Dot({ delay = 0, color = "rgb(var(--quip-accent))" }: { delay?: number; color?: string }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-bounce rounded-full"
      style={{
        background: color,
        animationDelay: `${delay}s`,
        animationDuration: "1s",
      }}
    />
  );
}

export const ChatMessageView = memo(MessageBase);
