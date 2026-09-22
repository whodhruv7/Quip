// Quip V2 — Unified input bar.
//
// NO ask/act toggle. Single input. The task brain auto-detects if the user
// wants to chat or execute an action. Seamless experience.
//
// Polish:
//   - Command history: up/down arrows cycle through previous inputs
//   - Smart placeholder: changes based on companion + time of day
//   - Paste detection: if clipboard has URL, show "Open this URL?" chip
//   - Focus ring: aqua glow on focus
//   - Send button: animate on press

import { useEffect, useRef, useState, useCallback } from "react";
import { getCompanion } from "@/lib/companion-config";
import { playSound } from "@/lib/sounds";
import type { CompanionId } from "@/types";
import { loadQuickReplies } from "./chat-ux";

interface ChatInputProps {
  onSend: (text: string) => void;
  busy: boolean;
  companionId?: CompanionId;
}

const HISTORY_KEY = "quip:input-history";
const MAX_HISTORY = 50;

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(history: string[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
  } catch {
    /* ignore */
  }
}

function getSmartPlaceholder(companionId?: CompanionId): string {
  const hour = new Date().getHours();
  const name = companionId ? getCompanion(companionId)?.name : null;

  if (hour < 5) return `Late night with ${name ?? "Quip"}… what's on your mind?`;
  if (hour < 12) return `Good morning! Ask ${name ?? "Quip"} anything…`;
  if (hour < 17) return `Ask ${name ?? "Quip"} anything or say what to do…`;
  if (hour < 21) return `Good evening! How can ${name ?? "Quip"} help?`;
  return `Winding down? ${name ?? "Quip"} is here…`;
}

export function ChatInput({ onSend, busy, companionId }: ChatInputProps) {
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [urlChip, setUrlChip] = useState<string | null>(null);
  // Custom quick replies from Settings (localStorage "quip.quickReplies").
  // Re-read when the input empties so edits in Settings show up live.
  const [quickReplies, setQuickReplies] = useState<string[]>(() => loadQuickReplies());
  const ref = useRef<HTMLTextAreaElement>(null);

  const theme = companionId ? getCompanion(companionId) : null;
  const themeColor = theme?.primary ?? "#6FD6FF";

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 110) + "px";
  }, [value]);

  useEffect(() => {
    if (value === "") setQuickReplies(loadQuickReplies());
  }, [value]);

  const checkClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.length < 500) {
        const trimmed = text.trim();
        if (/^https?:\/\/\S+$/i.test(trimmed)) {
          setUrlChip(trimmed);
          return;
        }
      }
    } catch {
      /* silent */
    }
  }, []);

  const submit = (overrideText?: string) => {
    const text = (overrideText ?? value).trim();
    if (!text || busy) return;
    playSound("send", companionId);
    onSend(text);
    const newHistory = [...history, text];
    setHistory(newHistory);
    saveHistory(newHistory);
    setHistoryIndex(-1);
    setValue("");
    setUrlChip(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
      return;
    }

    if (e.key === "ArrowUp" && history.length > 0) {
      const el = e.currentTarget;
      if (el.selectionStart === 0 || value === "") {
        e.preventDefault();
        const newIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(newIndex);
        setValue(history[newIndex]);
        setTimeout(() => {
          const e2 = ref.current;
          if (e2) {
            e2.selectionStart = e2.selectionEnd = e2.value.length;
          }
        }, 0);
      }
    }

    if (e.key === "ArrowDown" && historyIndex !== -1) {
      e.preventDefault();
      const newIndex = historyIndex + 1;
      if (newIndex >= history.length) {
        setHistoryIndex(-1);
        setValue("");
      } else {
        setHistoryIndex(newIndex);
        setValue(history[newIndex]);
      }
    }

    if (e.key === "Escape" && value) {
      e.preventDefault();
      setValue("");
      setHistoryIndex(-1);
    }
  };

  return (
    <div
      className="flex flex-col px-3 py-2.5"
      style={{
        borderTop: "1px solid rgba(var(--quip-line), 0.08)",
        // OPAQUE themed composer bar — no desktop show-through.
        background: "rgb(var(--quip-bg))",
      }}
    >
      {urlChip && (
        <button
          onClick={() => submit(urlChip)}
          className="mb-2 flex items-center gap-2 rounded-lg px-3 py-1.5 text-left transition-all"
          style={{
            background: "rgba(var(--quip-accent), 0.10)",
            border: `1px solid ${themeColor}33`,
          }}
        >
          <span style={{ fontSize: 11, color: themeColor }}>🔗</span>
          <div className="flex flex-col" style={{ minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 10, color: "rgb(var(--quip-text-soft))", fontWeight: 500 }}>
              Open this URL?
            </span>
            <span
              style={{
                fontSize: 11,
                color: "rgb(var(--quip-text))",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {urlChip}
            </span>
          </div>
          <span style={{ fontSize: 14, color: "rgb(var(--quip-text-soft))" }}>↵</span>
        </button>
      )}

      {quickReplies.length > 0 && !value && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5" aria-label="Your quick replies">
          {quickReplies.map((qr) => (
            <button
              key={qr}
              type="button"
              onClick={() => submit(qr)}
              aria-label={`Send quick reply: ${qr}`}
              className="quip-focusable"
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                color: "rgb(var(--quip-accent-deep))",
                background: "rgba(var(--quip-accent), 0.10)",
                border: "1px solid rgba(var(--quip-accent), 0.35)",
                borderRadius: 999,
                padding: "3px 10px",
                cursor: "pointer",
                maxWidth: 220,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {qr}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <textarea
            ref={ref}
            rows={1}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setHistoryIndex(-1);
            }}
            onKeyDown={handleKeyDown}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = themeColor + "55";
              e.currentTarget.style.boxShadow = `0 0 0 3px ${themeColor}15`;
              checkClipboard();
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "";
              e.currentTarget.style.boxShadow = "";
            }}
            placeholder={getSmartPlaceholder(companionId)}
            aria-label="Message Quip"
            className="quip-composer-input w-full resize-none rounded-2xl px-4 py-2.5 text-[14px] focus:outline-none"
            style={{
              transition: "border-color 200ms, box-shadow 200ms",
            }}
          />
        </div>

        {/* UX-027: purely informational length counter near the send button */}
        {value.length > 200 && (
          <span
            aria-hidden
            style={{
              fontSize: 10,
              color: "rgba(var(--quip-text-soft), 0.6)",
              paddingBottom: 12,
              whiteSpace: "nowrap",
            }}
          >
            {value.length} chars
          </span>
        )}

        <button
          onClick={() => submit()}
          disabled={busy || !value.trim()}
          aria-label="Send message"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-white transition-all active:scale-90"
          style={
            busy || !value.trim()
              ? { background: "rgb(var(--chrome-line) / 0.08)", cursor: "not-allowed" }
              : {
                  background: `linear-gradient(135deg, ${themeColor}, ${themeColor}cc)`,
                  boxShadow: `0 4px 14px ${themeColor}33`,
                }
          }
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 12h14M13 6l6 6-6 6"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
