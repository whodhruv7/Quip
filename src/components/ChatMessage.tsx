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

function MessageBase({ message, index = 0 }: { message: ChatMessageType; index?: number }) {
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
      {/* Companion dot */}
      <div
        className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-white/60"
        style={{
          background: `linear-gradient(135deg, ${theme.primary}22, ${theme.secondary}18)`,
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
                  background: "rgba(254,235,235,0.85)",
                  color: "#c0392b",
                  border: "1px solid rgba(200,50,50,0.12)",
                }
              : {
                  background: "rgba(255,255,255,0.85)",
                  color: "#111111",
                  border: "1px solid rgba(0,0,0,0.04)",
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
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

          {/* Copy button — appears on hover, only for non-streaming assistant messages */}
          {!empty && !message.streaming && !message.error && (
            <button
              onClick={handleCopy}
              aria-label={copied ? "Copied" : "Copy message"}
              className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-md text-quip-gray opacity-0 transition-all hover:bg-black/[0.04] hover:text-quip-text group-hover:opacity-100"
              style={{ fontSize: 11 }}
            >
              {copied ? "✓" : "⧉"}
            </button>
          )}
        </div>

        {/* Trust-layer note — fades in after the message (feels like an afterthought) */}
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

        {/* Action badge */}
        {message.action && (
          <div
            className="inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5"
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: message.action.success ? "#16a34a" : "#dc2626",
              background: message.action.success ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
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

function Dot({ delay = 0, color = "#6FD6FF" }: { delay?: number; color?: string }) {
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
