// Quip V2 — Chat message list.
//
// Full-width scrollable message list with smooth auto-scroll.
// Messages fade in; auto-scrolls to bottom unless the user has scrolled up.
//
// Polish:
//   - Time separators: if >5 min gap between messages, show a subtle timestamp
//   - Stagger: passes index to ChatMessage for delay-based entry animation
//   - Smart auto-scroll: only scrolls if user is already at bottom

import { useRef, useEffect, useCallback } from "react";
import { AnimatePresence } from "framer-motion";
import type { ChatMessage } from "@/types";
import { ChatMessageView } from "./ChatMessage";

interface ChatLayoutProps {
  messages: ChatMessage[];
  busy: boolean;
}

const TIME_SEPARATOR_GAP_MS = 5 * 60 * 1000; // 5 minutes

function formatTimeSeparator(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (isToday) return time;
  if (isYesterday) return `Yesterday, ${time}`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" }) + `, ${time}`;
}

function shouldShowSeparator(prev: ChatMessage, curr: ChatMessage): boolean {
  return curr.ts - prev.ts > TIME_SEPARATOR_GAP_MS;
}

export function ChatLayout({ messages, busy }: ChatLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isAtBottom = useRef(true);

  const checkIfAtBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    isAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  }, []);

  const scrollToBottom = useCallback(() => {
    if (!isAtBottom.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Auto-scroll when messages change.
  useEffect(() => {
    // Reset to bottom when new user message arrives.
    isAtBottom.current = true;
    scrollToBottom();
  }, [messages.length, scrollToBottom]);

  // Re-check scroll position during streaming.
  useEffect(() => {
    if (!busy) return;
    const interval = setInterval(() => {
      scrollToBottom();
    }, 150);
    return () => clearInterval(interval);
  }, [busy, scrollToBottom]);

  if (messages.length === 0) return null;

  // Build list with time separators interspersed
  const items: Array<
    | { type: "separator"; id: string; label: string }
    | { type: "message"; id: string; message: ChatMessage; index: number }
  > = [];

  let msgIndex = 0;
  messages.forEach((msg, i) => {
    if (i === 0 || shouldShowSeparator(messages[i - 1], msg)) {
      items.push({
        type: "separator",
        id: `sep-${msg.id}`,
        label: formatTimeSeparator(msg.ts),
      });
    }
    items.push({ type: "message", id: msg.id, message: msg, index: msgIndex });
    msgIndex++;
  });

  return (
    <div
      ref={containerRef}
      onScroll={checkIfAtBottom}
      className="flex-1 overflow-y-auto px-4 py-3 quip-scroll"
      style={{
        scrollbarWidth: "thin",
        scrollbarColor: "rgba(0,0,0,0.08) transparent",
      }}
    >
      <div className="flex flex-col gap-3">
        <AnimatePresence initial={false}>
          {items.map((item) => {
            if (item.type === "separator") {
              return (
                <div
                  key={item.id}
                  className="flex items-center justify-center py-2"
                  style={{
                    fontSize: 10,
                    color: "rgba(0,0,0,0.35)",
                    fontWeight: 500,
                    letterSpacing: 0.3,
                  }}
                >
                  <span
                    style={{
                      background: "rgba(0,0,0,0.03)",
                      padding: "2px 8px",
                      borderRadius: 8,
                    }}
                  >
                    {item.label}
                  </span>
                </div>
              );
            }
            return (
              <ChatMessageView
                key={item.id}
                message={item.message}
                index={item.index}
              />
            );
          })}
        </AnimatePresence>

        {/* Invisible scroll target */}
        <div ref={bottomRef} className="h-1" />
      </div>
    </div>
  );
}
