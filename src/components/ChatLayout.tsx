// Quip V2 — Chat message list.
//
// Full-width scrollable message list with smooth auto-scroll.
// Messages fade in; auto-scrolls to bottom unless the user has scrolled up.

import { useRef, useEffect, useCallback } from "react";
import { AnimatePresence } from "framer-motion";
import type { ChatMessage } from "@/types";
import { ChatMessageView } from "./ChatMessage";

interface ChatLayoutProps {
  messages: ChatMessage[];
  busy: boolean;
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

  return (
    <div
      ref={containerRef}
      onScroll={checkIfAtBottom}
      className="flex-1 overflow-y-auto px-4 py-3"
      style={{
        // Hide scrollbar for clean look.
        scrollbarWidth: "thin",
        scrollbarColor: "rgba(0,0,0,0.08) transparent",
      }}
    >
      <div className="flex flex-col gap-3">
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <ChatMessageView key={msg.id} message={msg} />
          ))}
        </AnimatePresence>

        {/* Invisible scroll target */}
        <div ref={bottomRef} className="h-1" />
      </div>
    </div>
  );
}
