// Quip — ChatSearch (roadmap UX-009)
// ─────────────────────────────────────────────────────────────────────────────
// Floating search bar over the chat area (Ctrl+F / Meta+F opens it from
// ChatLayout — never while the user is typing in an input). Shows the match
// count, prev/next navigation, Esc closes. Matches scroll into view via the
// data-message-id attributes on message rows and pulse briefly.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "@/types";
import { prefersReducedMotion } from "./chat-ux";

interface ChatSearchProps {
  messages: ChatMessage[];
  /** The scrollable messages container (rows live inside it). */
  containerRef: React.RefObject<HTMLDivElement>;
  onClose: () => void;
}

const HIT_MS = 1700;

function revealMatch(container: HTMLDivElement | null, id: string): (() => void) | undefined {
  if (!container) return undefined;
  let el: Element | null = null;
  try {
    el = container.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
  } catch {
    el = container.querySelector(`[data-message-id="${id.replace(/"/g, "")}"]`);
  }
  if (!el) return undefined;
  el.scrollIntoView({
    behavior: prefersReducedMotion() ? "auto" : "smooth",
    block: "center",
  });
  el.classList.add("quip-search-hit");
  const t = setTimeout(() => el?.classList.remove("quip-search-hit"), HIT_MS);
  return () => {
    clearTimeout(t);
    el?.classList.remove("quip-search-hit");
  };
}

export function ChatSearch({ messages, containerRef, onClose }: ChatSearchProps) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const q = query.trim().toLowerCase();

  const matches = useMemo(
    () => (q ? messages.filter((m) => m.content.toLowerCase().includes(q)).map((m) => m.id) : []),
    [messages, q]
  );

  // Autofocus when the bar opens.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // A new query always starts at the first match.
  useEffect(() => {
    setIndex(0);
  }, [q]);

  // Scroll to + pulse-highlight the active match.
  useEffect(() => {
    if (matches.length === 0) return undefined;
    const id = matches[Math.min(index, matches.length - 1)];
    return revealMatch(containerRef.current, id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, matches, containerRef]);

  const step = (dir: 1 | -1) => {
    if (matches.length === 0) return;
    setIndex((i) => (i + dir + matches.length) % matches.length);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    }
  };

  const miniBtn: React.CSSProperties = {
    height: 22,
    minWidth: 22,
    padding: "0 4px",
    borderRadius: 6,
    fontSize: 11,
    lineHeight: 1,
    color: "rgb(var(--quip-text-soft))",
    background: "rgba(var(--quip-line), 0.06)",
    border: "1px solid rgba(var(--quip-line), 0.12)",
    cursor: "pointer",
  };

  return (
    <div
      role="search"
      aria-label="Search chat messages"
      style={{
        position: "absolute",
        top: 8,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 60,
        maxWidth: "92%",
      }}
    >
      <div
        className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5"
        style={{
          background: "rgb(var(--quip-bg))",
          border: "1px solid rgba(var(--quip-line), 0.16)",
          boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
        }}
      >
        <span aria-hidden style={{ fontSize: 12, color: "rgb(var(--quip-text-soft))" }}>
          🔍
        </span>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search messages…"
          aria-label="Search messages"
          spellCheck={false}
          className="quip-focusable"
          style={{
            fontSize: 12,
            color: "rgb(var(--quip-text))",
            background: "transparent",
            border: "none",
            outline: "none",
            width: 170,
          }}
        />
        <span
          aria-live="polite"
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            color: "rgb(var(--quip-text-soft))",
            minWidth: q ? 34 : 0,
            textAlign: "center",
          }}
        >
          {q ? (matches.length > 0 ? `${Math.min(index + 1, matches.length)}/${matches.length}` : "0/0") : ""}
        </span>
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={matches.length === 0}
          aria-label="Previous match"
          className="quip-focusable"
          style={{ ...miniBtn, opacity: matches.length === 0 ? 0.4 : 1 }}
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={matches.length === 0}
          aria-label="Next match"
          className="quip-focusable"
          style={{ ...miniBtn, opacity: matches.length === 0 ? 0.4 : 1 }}
        >
          ↓
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close search"
          className="quip-focusable"
          style={miniBtn}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
