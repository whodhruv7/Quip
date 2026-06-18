// Quip V0.1 — single chat bubble.
//
// User messages: right-aligned, gradient. Assistant: left-aligned with theme color.

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, CompanionId } from "@/types";
import { COMPANIONS } from "./Companion";

function MessageBase({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const empty = message.content.length === 0 && message.streaming;
  const theme = COMPANIONS.find((c) => c.id === message.companionId) || COMPANIONS[0];

  if (isUser) {
    return (
      <div className="flex justify-end animate-fade-in">
        <div
          className="max-w-[82%] rounded-2xl rounded-br-xl px-4 py-2.5 text-[14px] leading-relaxed text-white shadow-soft"
          style={{
            background: `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})`,
          }}
        >
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start gap-2 animate-fade-in">
      {/* Companion dot */}
      <div
        className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-white/60"
        style={{
          background: `linear-gradient(135deg, ${theme.primary}25, ${theme.secondary}20)`,
        }}
      >
        <span className="h-2 w-2 rounded-full" style={{ background: theme.primary }} />
      </div>

      <div
        className="max-w-[82%] rounded-2xl rounded-bl-xl px-4 py-2.5 text-[14px] leading-relaxed shadow-soft"
        style={
          message.error
            ? {
                background: "rgba(254,235,235,0.85)",
                color: "#c0392b",
                border: "1px solid rgba(200,50,50,0.12)",
              }
            : {
                background: "rgba(255,255,255,0.82)",
                color: "#111111",
                border: "1px solid rgba(0,0,0,0.03)",
              }
        }
      >
        {empty ? (
          <span className="inline-flex items-center gap-1 text-quip-gray">
            <Dot /> <Dot delay={0.15} /> <Dot delay={0.3} />
          </span>
        ) : (
          <div className="quip-md break-words">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
            {message.streaming && (
              <span
                className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse"
                style={{ background: theme.primary }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Dot({ delay = 0 }: { delay?: number }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-bounce rounded-full"
      style={{
        background: "#6FD6FF",
        animationDelay: `${delay}s`,
        animationDuration: "1s",
      }}
    />
  );
}

export const ChatMessageView = memo(MessageBase);
