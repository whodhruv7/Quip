// Quip V2 — Chat message list.
//
// Full-width scrollable message list with smooth auto-scroll.
// Messages fade in; auto-scrolls to bottom unless the user has scrolled up.
//
// Polish:
//   - Time separators: if >5 min gap between messages, show a subtle timestamp
//   - Stagger: passes index to ChatMessage for delay-based entry animation
//   - Smart auto-scroll: only scrolls if user is already at bottom
//   - UX-009: Ctrl+F / Meta+F floating chat search (ChatSearch overlay)
//   - UX-010: drag & drop files onto the chat → floating action bar
//   - UX-013: per-companion typing row while the reply's first chunks cook
//   - UX-021: jump-to-bottom pill with a new-output count when scrolled away
//   - UX-012: forwards pinned/onTogglePin through to every message bubble
//   - UX-041: aria-live="polite" + aria-busy on the message list

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import type { ChatMessage, CompanionId } from "@/types";
import { getCompanion } from "@/lib/companion-config";
import { ChatMessageView } from "./ChatMessage";
import { ChatSearch } from "./ChatSearch";
import { dispatchQuickTask, prefersReducedMotion, useUxStyles } from "./chat-ux";

interface ChatLayoutProps {
  messages: ChatMessage[];
  busy: boolean;
  /** Re-sends the last user message after a failed reply ("Try again"). */
  onRetry?: () => void;
  /** UX-012 (A1 contract): ids of pinned messages — App (A2) owns the state. */
  pinnedIds?: string[];
  /** UX-012 (A1 contract): toggling a message's pin reports its id to App. */
  onTogglePin?: (messageId: string) => void;
}

const TIME_SEPARATOR_GAP_MS = 5 * 60 * 1000; // 5 minutes
const MAX_DROPPED_FILES = 5;

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

function dirOf(path: string): string {
  const dir = path.replace(/[\\/][^\\/]*$/, "");
  return dir || path;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

// ─── UX-013: one distinct typing pattern per companion ──────────────────────
type TypingPattern = "dots" | "fade" | "bars" | "ripple" | "breath" | "wave";

const TYPING_PATTERN: Record<CompanionId, TypingPattern> = {
  pix: "dots", // playful bouncing dots
  kai: "fade", // wise, slow fading dots
  ren: "bars", // bold zigzag bars
  bubbles: "ripple", // joyful expanding bubbles
  capy: "breath", // calm breathing blob
  skales: "wave", // quick gecko wave
};

function TypingPatternView({ id, color }: { id: CompanionId; color: string }) {
  const reduced = prefersReducedMotion();
  const pattern = TYPING_PATTERN[id] ?? "dots";

  if (reduced) {
    // Static, non-animated marker.
    return (
      <span className="inline-flex items-center gap-1" aria-hidden>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: color, opacity: 0.6 }} />
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: color, opacity: 0.4 }} />
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: color, opacity: 0.25 }} />
      </span>
    );
  }

  if (pattern === "dots") {
    return (
      <span className="inline-flex items-center gap-1" aria-hidden>
        {[0, 0.15, 0.3].map((d) => (
          <span
            key={d}
            style={{
              width: 5, height: 5, borderRadius: "50%", background: color,
              animation: `quipTypingBounce 1.2s ease-in-out ${d}s infinite`,
            }}
          />
        ))}
      </span>
    );
  }
  if (pattern === "fade") {
    return (
      <span className="inline-flex items-center gap-1" aria-hidden>
        {[0, 0.25, 0.5].map((d) => (
          <span
            key={d}
            style={{
              width: 5, height: 5, borderRadius: "50%", background: color,
              animation: `quipTypingFade 1.4s ease-in-out ${d}s infinite`,
            }}
          />
        ))}
      </span>
    );
  }
  if (pattern === "bars") {
    return (
      <span className="inline-flex items-end gap-0.5" aria-hidden>
        {[0, 0.12, 0.24].map((d) => (
          <span
            key={d}
            style={{
              width: 3, height: 11, borderRadius: 2, background: color,
              transformOrigin: "bottom",
              animation: `quipTypingBar 0.9s ease-in-out ${d}s infinite`,
            }}
          />
        ))}
      </span>
    );
  }
  if (pattern === "ripple") {
    return (
      <span className="relative inline-flex h-3.5 w-3.5 items-center justify-center" aria-hidden>
        {[0, 0.55].map((d) => (
          <span
            key={d}
            style={{
              position: "absolute", width: 9, height: 9, borderRadius: "50%",
              border: `1.5px solid ${color}`,
              animation: `quipTypingRipple 1.6s ease-out ${d}s infinite`,
            }}
          />
        ))}
      </span>
    );
  }
  if (pattern === "breath") {
    return (
      <span aria-hidden style={{ display: "inline-flex" }}>
        <span
          style={{
            width: 9, height: 9, borderRadius: "50%", background: color,
            animation: "quipTypingBreath 1.8s ease-in-out infinite",
          }}
        />
      </span>
    );
  }
  // wave
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      {[0, 0.12, 0.24].map((d) => (
        <span
          key={d}
          style={{
            width: 3, height: 8, borderRadius: 2, background: color,
            animation: `quipTypingWave 1s ease-in-out ${d}s infinite`,
          }}
        />
      ))}
    </span>
  );
}

export function ChatLayout({ messages, busy, onRetry, pinnedIds, onTogglePin }: ChatLayoutProps) {
  useUxStyles();
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isAtBottom = useRef(true);
  const prevLenRef = useRef(messages.length);
  const newCountRef = useRef(0);

  const [searchOpen, setSearchOpen] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [droppedPaths, setDroppedPaths] = useState<string[]>([]);

  const pinnedSet = useMemo(() => new Set(pinnedIds ?? []), [pinnedIds]);

  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({
      behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto",
    });
  }, []);

  // UX-009: Ctrl+F / Meta+F opens search — never while typing in an input
  // (same guard App uses for its global keys).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f")) return;
      const t = e.target as HTMLElement | null;
      const typing =
        t?.tagName === "INPUT" || t?.tagName === "TEXTAREA" || t?.isContentEditable === true;
      if (typing) return;
      e.preventDefault();
      setSearchOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Scroll handler: track bottom-ness, drive the jump pill, reset the
  // new-output counter when the user catches up.
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottom.current = dist < 60;
    if (isAtBottom.current && newCountRef.current !== 0) {
      newCountRef.current = 0;
      setNewCount(0);
    }
    setShowJump(dist > 400);
  }, []);

  // Auto-scroll when messages change — smart version:
  //   new USER message  → always jump down (it's the user's own message)
  //   at bottom         → follow the output
  //   scrolled away     → stay put, count what the user is missing (UX-021)
  useEffect(() => {
    const grew = messages.length > prevLenRef.current;
    const last = messages[messages.length - 1];
    if (grew && last?.role === "user") {
      isAtBottom.current = true;
      newCountRef.current = 0;
      setNewCount(0);
      scrollToBottom();
    } else if (isAtBottom.current) {
      scrollToBottom();
    } else if (grew) {
      const add = messages.length - prevLenRef.current;
      newCountRef.current += add;
      setNewCount(newCountRef.current);
    } else if (last?.role === "assistant" && last.streaming && newCountRef.current === 0) {
      // Output grew inside an existing bubble (streaming chunk).
      newCountRef.current = 1;
      setNewCount(1);
    }
    prevLenRef.current = messages.length;
  }, [messages, scrollToBottom]);

  // Re-check scroll position during streaming (only follows when at bottom).
  useEffect(() => {
    if (!busy) return;
    const interval = setInterval(() => {
      if (isAtBottom.current) scrollToBottom(false);
    }, 150);
    return () => clearInterval(interval);
  }, [busy, scrollToBottom]);

  // UX-021: click → back to the latest.
  const jumpToBottom = useCallback(() => {
    isAtBottom.current = true;
    newCountRef.current = 0;
    setNewCount(0);
    setShowJump(false);
    scrollToBottom(true);
  }, [scrollToBottom]);

  // UX-010: drag & drop onto the messages area.
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragActive(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const files = Array.from(e.dataTransfer?.files ?? []).slice(0, MAX_DROPPED_FILES);
    const paths: string[] = [];
    for (const f of files) {
      let p = "";
      try {
        // preload exposes webUtils.getPathForFile — "" when unavailable.
        p = (window.quip as unknown as { getPathForFile?: (file: File) => string }).getPathForFile?.(f) ?? "";
      } catch {
        p = "";
      }
      if (p) paths.push(p);
    }
    // Hidden entirely when no real paths came through (honesty rule).
    setDroppedPaths(paths);
  }, []);

  const actOnDrop = useCallback(
    (text: string) => {
      dispatchQuickTask(text);
      setDroppedPaths([]);
    },
    []
  );

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

  // UX-013: typing row while the last assistant reply is still empty.
  const lastMsg = messages[messages.length - 1];
  const typingId: CompanionId | null =
    lastMsg && lastMsg.role === "assistant" && lastMsg.streaming && lastMsg.content.length === 0
      ? lastMsg.companionId ?? "pix"
      : null;
  const typingTheme = typingId ? getCompanion(typingId) : null;

  const firstDrop = droppedPaths[0];

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className="flex-1 overflow-y-auto px-4 py-3 quip-scroll"
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: "rgba(var(--quip-line), 0.14) transparent",
        }}
      >
        <div className="flex flex-col gap-3" aria-live="polite" aria-busy={busy}>
          <AnimatePresence initial={false}>
            {items.map((item) => {
              if (item.type === "separator") {
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-center py-2"
                    style={{
                      fontSize: 10,
                      color: "rgb(var(--quip-text-soft))",
                      fontWeight: 500,
                      letterSpacing: 0.3,
                    }}
                  >
                    <span
                      style={{
                        background: "rgba(var(--quip-line), 0.045)",
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
                <div key={item.id} data-message-id={item.message.id}>
                  <ChatMessageView
                    message={item.message}
                    index={item.index}
                    onRetry={onRetry}
                    pinned={pinnedSet.has(item.message.id)}
                    onPin={onTogglePin ? () => onTogglePin(item.message.id) : undefined}
                  />
                </div>
              );
            })}
          </AnimatePresence>

          {/* UX-013: "{Companion} is typing" with their own pattern */}
          {typingId && typingTheme && (
            <div
              className="flex items-center gap-2 px-1 py-0.5"
              role="status"
              aria-label={`${typingTheme.name} is typing`}
            >
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  color: "rgba(var(--quip-text-soft), 0.75)",
                }}
              >
                {typingTheme.name}
              </span>
              <TypingPatternView id={typingId} color={typingTheme.primary} />
            </div>
          )}

          {/* Invisible scroll target */}
          <div ref={bottomRef} className="h-1" />
        </div>
      </div>

      {/* UX-009: floating search bar */}
      {searchOpen && (
        <ChatSearch messages={messages} containerRef={containerRef} onClose={() => setSearchOpen(false)} />
      )}

      {/* UX-010: drag-over hint */}
      {dragActive && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 8,
            zIndex: 54,
            borderRadius: 14,
            border: "2px dashed rgba(var(--quip-accent), 0.5)",
            background: "rgba(var(--quip-accent), 0.05)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, color: "rgb(var(--quip-accent))" }}>
            Drop files to act on them
          </span>
        </div>
      )}

      {/* UX-010: floating action bar for the dropped files */}
      {droppedPaths.length > 0 && (
        <div
          role="toolbar"
          aria-label="Actions for dropped files"
          style={{
            position: "absolute",
            bottom: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 55,
            maxWidth: "94%",
            background: "rgb(var(--quip-bg))",
            border: "1px solid rgba(var(--quip-line), 0.16)",
            borderRadius: 14,
            boxShadow: "0 12px 32px rgba(0,0,0,0.28)",
            padding: "7px 9px",
          }}
        >
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {droppedPaths.slice(0, 3).map((p) => (
              <span
                key={p}
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: "rgb(var(--quip-text-soft))",
                  background: "rgba(var(--quip-line), 0.06)",
                  border: "1px solid rgba(var(--quip-line), 0.12)",
                  borderRadius: 999,
                  padding: "3px 8px",
                  maxWidth: 130,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {baseName(p)}
              </span>
            ))}
            {droppedPaths.length > 3 && (
              <span style={{ fontSize: 10, color: "rgb(var(--quip-text-soft))" }}>
                +{droppedPaths.length - 3}
              </span>
            )}
            <span aria-hidden style={{ width: 1, height: 14, background: "rgba(var(--quip-line), 0.2)" }} />
            <button
              type="button"
              onClick={() => actOnDrop(`organize files in ${dirOf(firstDrop)}`)}
              aria-label={`Organize files in ${dirOf(firstDrop)}`}
              className="quip-focusable"
              style={dropChipStyle}
            >
              Organize this folder
            </button>
            <button
              type="button"
              onClick={() => actOnDrop(`open ${firstDrop}`)}
              aria-label={`Open ${baseName(firstDrop)}`}
              className="quip-focusable"
              style={dropChipStyle}
            >
              Open
            </button>
            <button
              type="button"
              onClick={() => actOnDrop(`find duplicate files in ${dirOf(firstDrop)}`)}
              aria-label={`Find duplicate files in ${dirOf(firstDrop)}`}
              className="quip-focusable"
              style={dropChipStyle}
            >
              Find duplicates
            </button>
            <button
              type="button"
              onClick={() => setDroppedPaths([])}
              aria-label="Dismiss dropped files bar"
              className="quip-focusable"
              style={{ ...dropChipStyle, minWidth: 0, padding: "3px 7px" }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* UX-021: jump-to-bottom pill with the new-output count */}
      {showJump && (
        <button
          type="button"
          onClick={jumpToBottom}
          aria-label={
            newCount > 0
              ? `Jump to latest — ${newCount} new message${newCount > 1 ? "s" : ""}`
              : "Jump to latest"
          }
          className="quip-focusable flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-all hover:scale-[1.04]"
          style={{
            position: "absolute",
            bottom: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 50,
            fontSize: 11,
            fontWeight: 600,
            color: "rgb(var(--quip-accent-deep))",
            background: "rgb(var(--quip-bg))",
            border: "1px solid rgba(var(--quip-accent), 0.45)",
            boxShadow: "0 6px 18px rgba(0,0,0,0.22)",
            cursor: "pointer",
          }}
        >
          <span aria-hidden>↓</span>
          <span>{newCount > 0 ? `${newCount} new` : "Latest"}</span>
        </button>
      )}
    </div>
  );
}

const dropChipStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  color: "rgb(var(--quip-accent-deep))",
  background: "rgba(var(--quip-accent), 0.12)",
  border: "1px solid rgba(var(--quip-accent), 0.4)",
  borderRadius: 999,
  padding: "3px 9px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};
