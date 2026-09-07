// Quip — ActionApprovalPanel
// ─────────────────────────────────────────────────────────────────────────────
// Compact inline permission panel that sits directly ABOVE the chat input.
// Shows WHAT Quip wants to do + Allow/Cancel. Part of the conversation —
// not a giant modal. Used for every medium/dangerous action confirmation.
// ─────────────────────────────────────────────────────────────────────────────

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

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 420, damping: 30 }}
      style={{
        margin: "0 12px 8px",
        padding: "10px 12px",
        borderRadius: 14,
        background: `rgba(255,255,255,0.92)`,
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: `1px solid ${risk.border}`,
        boxShadow: `0 8px 24px rgba(0,0,0,0.08), 0 0 0 3px ${risk.bg}`,
      }}
      role="alertdialog"
      aria-label="Quip wants to do something"
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 11 }}>✋</span>
        <span style={{ fontSize: 10, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4 }}>
          Action request · {risk.label}
        </span>
      </div>

      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#10131f", lineHeight: 1.4, marginBottom: 4 }}>
        Quip wants to: {request.title}
      </div>

      {request.steps.length > 1 && (
        <div style={{ fontSize: 11, color: "#6b7280", lineHeight: 1.5, marginBottom: 6 }}>
          {request.steps.slice(0, 4).map((s, i) => (
            <div key={i} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {s}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
        <button
          onClick={() => onResolve(request.id, false)}
          style={{
            border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: 10,
            padding: "6px 14px",
            fontSize: 11.5,
            fontWeight: 500,
            color: "#374151",
            background: "white",
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          onClick={() => onResolve(request.id, true)}
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
