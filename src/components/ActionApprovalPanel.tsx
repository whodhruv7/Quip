// Quip — ActionApprovalPanel
// ─────────────────────────────────────────────────────────────────────────────
// Compact inline permission panel that sits directly ABOVE the chat input.
// Shows WHAT Quip wants to do + Allow/Cancel. Part of the conversation —
// not a giant modal. Used for every medium/dangerous action confirmation.
//
// UX-037: full keyboard path — the panel grabs focus when it mounts, Enter
// approves, Esc declines. Keys are handled ON the panel (local to it), so it
// can never auto-fire while another modal owns the keyboard, and buttons
// keep their natural Enter/Space behavior when tabbed to.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import type { ApprovalRequestUI } from "@/types/api";

interface ActionApprovalPanelProps {
  request: ApprovalRequestUI;
  companionColor: string;
  onResolve: (id: string, approved: boolean) => void;
}

const RISK_STYLES: Record<string, { bg: string; border: string; label: string }> = {
  safe: { bg: "rgba(34,197,94,0.07)", border: "rgba(34,197,94,0.25)", label: "Safe" },
  medium: { bg: "rgba(245,158,11,0.07)", border: "rgba(245,158,11,0.3)", label: "Needs your OK" },
  dangerous: { bg: "rgba(239,68,68,0.07)", border: "rgba(239,68,68,0.3)", label: "Sensitive" },
};

export function ActionApprovalPanel({ request, companionColor, onResolve }: ActionApprovalPanelProps) {
  const risk = RISK_STYLES[request.risk ?? "medium"] ?? RISK_STYLES.medium;
  const panelRef = useRef<HTMLDivElement>(null);

  // Autofocus the panel itself (not a button) when it mounts — so Enter=Allow
  // works immediately and Tab moves Cancel → Allow in a sensible order.
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onResolve(request.id, false);
      return;
    }
    if (e.key === "Enter") {
      // If a specific button has focus, let the browser's native click run.
      const target = e.target as HTMLElement | null;
      if (target && target.tagName === "BUTTON") return;
      e.preventDefault();
      onResolve(request.id, true);
    }
  };

  return (
    <motion.div
      data-ux="approval-card"
      ref={panelRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 420, damping: 30 }}
      style={{
        margin: "0 12px 8px",
        padding: "10px 12px",
        borderRadius: 14,
        background: `rgb(var(--quip-bg))`,
        border: `1px solid ${risk.border}`,
        boxShadow: `0 8px 24px rgba(0,0,0,0.14), 0 0 0 3px ${risk.bg}`,
        outline: "none",
      }}
      role="alertdialog"
      aria-label="Quip wants to do something"
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 11 }}>✋</span>
        <span style={{ fontSize: 10, fontWeight: 600, color: "rgb(var(--chrome-soft))", textTransform: "uppercase", letterSpacing: 0.4 }}>
          Action request · {risk.label}
        </span>
      </div>

      <div style={{ fontSize: 12.5, fontWeight: 600, color: "rgb(var(--quip-text))", lineHeight: 1.4, marginBottom: 4 }}>
        Quip wants to: {request.title}
      </div>

      {request.steps.length > 1 && (
        <div style={{ fontSize: 11, color: "rgb(var(--quip-text-soft))", lineHeight: 1.5, marginBottom: 6 }}>
          {request.steps.slice(0, 4).map((s, i) => (
            <div key={i} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {s}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center", marginTop: 8 }}>
        <span aria-hidden style={{ fontSize: 9, color: "rgba(var(--quip-text-soft), 0.6)", marginRight: "auto" }}>
          ↵ Allow · Esc Cancel
        </span>
        <button
          type="button"
          onClick={() => onResolve(request.id, false)}
          aria-label="Cancel — do not allow this action (Escape)"
          className="quip-focusable"
          style={{
            border: "1px solid rgba(var(--quip-line), 0.12)",
            borderRadius: 10,
            padding: "6px 14px",
            fontSize: 11.5,
            fontWeight: 500,
            color: "rgb(var(--quip-text-soft))",
            background: "rgba(var(--quip-line), 0.04)",
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onResolve(request.id, true)}
          aria-label="Allow this action (Enter)"
          className="quip-focusable"
          style={{
            border: "none",
            borderRadius: 10,
            padding: "6px 16px",
            fontSize: 11.5,
            fontWeight: 600,
            color: "#fff",
            background: `linear-gradient(135deg, ${companionColor}, #7B61FF)`,
            boxShadow: `0 3px 10px ${companionColor}33`,
            cursor: "pointer",
          }}
        >
          Allow
        </button>
      </div>
    </motion.div>
  );
}
