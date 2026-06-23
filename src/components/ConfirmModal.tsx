// Quip V2 — Confirmation modal for destructive actions.
//
// Used by Settings: "Clear all memories", "Reset Communication DNA", etc.
// Requires explicit confirmation with a clear explanation of consequences.

import { motion, AnimatePresence } from "framer-motion";
import { useEffect } from "react";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  // Esc to cancel
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-50 flex items-center justify-center"
          style={{
            background: "rgba(0,0,0,0.3)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
          onClick={onCancel}
        >
          <motion.div
            initial={{ scale: 0.92, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 10 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="mx-4 w-full max-w-xs rounded-2xl p-4"
            style={{
              background: "rgba(255,255,255,0.98)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
              border: "1px solid rgba(0,0,0,0.05)",
            }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <h3
              id="confirm-title"
              style={{ fontSize: 14, fontWeight: 600, color: "#111", marginBottom: 6 }}
            >
              {title}
            </h3>
            <p style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.5, marginBottom: 16 }}>
              {message}
            </p>
            <div className="flex gap-2">
              <button
                onClick={onCancel}
                className="flex-1 rounded-lg px-3 py-2 text-[12px] font-medium transition-all hover:bg-black/[0.04]"
                style={{ color: "#6b7280", background: "rgba(0,0,0,0.03)" }}
              >
                {cancelLabel}
              </button>
              <button
                onClick={onConfirm}
                className="flex-1 rounded-lg px-3 py-2 text-[12px] font-medium text-white transition-all active:scale-95"
                style={{
                  background: "linear-gradient(135deg, #ef4444, #dc2626)",
                  boxShadow: "0 4px 12px rgba(239,68,68,0.3)",
                }}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
