// Quip V0.1 — input bar with theme-aware accent.

import { useEffect, useRef, useState } from "react";
import { COMPANIONS } from "./Companion";
import type { CompanionId } from "@/types";

interface ChatInputProps {
  onSend: (text: string) => void;
  busy: boolean;
  themeColor?: string;
}

export function ChatInput({ onSend, busy, themeColor = "#6FD6FF" }: ChatInputProps) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 110) + "px";
  }, [value]);

  const submit = () => {
    const text = value.trim();
    if (!text || busy) return;
    onSend(text);
    setValue("");
  };

  return (
    <div
      className="flex items-end gap-2 px-3 py-2.5"
      style={{
        borderTop: "1px solid rgba(0,0,0,0.05)",
        background: "rgba(255,255,255,0.55)",
        backdropFilter: "blur(20px)",
      }}
    >
      <div className="relative flex-1">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask anything…"
          className="w-full resize-none rounded-2xl border border-black/[0.07] bg-white/80 px-4 py-2.5 text-[14px] text-quip-ink placeholder:text-quip-gray/60 focus:outline-none"
          style={{
            transition: "border-color 200ms, box-shadow 200ms",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = themeColor + "55";
            e.currentTarget.style.boxShadow = `0 0 0 3px ${themeColor}15`;
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "rgba(0,0,0,0.07)";
            e.currentTarget.style.boxShadow = "none";
          }}
        />
      </div>

      <button
        onClick={submit}
        disabled={busy || !value.trim()}
        aria-label="Send"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-white transition-all"
        style={
          busy || !value.trim()
            ? { background: "rgba(0,0,0,0.08)", cursor: "not-allowed" }
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
  );
}
