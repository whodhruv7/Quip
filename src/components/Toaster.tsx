// Quip — Toast system (roadmap UX-001, UX-029, UX-030)
// ─────────────────────────────────────────────────────────────────────────────
// Themed bottom-right stack: auto-dismiss, optional action buttons, kind
// colors from theme vars, reduced-motion aware (CSS). A tiny module store —
// any file can `pushToast(...)` without prop drilling.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: number;
  title: string;
  body?: string;
  kind: "info" | "success" | "error" | "quest";
  /** UX-029: single optional action (e.g. a retry). Keep it honest — only
   *  pass one when the click actually does the thing it names. */
  action?: ToastAction;
  actions?: ToastAction[];
  /** ms; 0 = stay until dismissed */
  ttl: number;
}

let nextId = 1;
let items: ToastItem[] = [];
const listeners = new Set<(items: ToastItem[]) => void>();

function emit(): void {
  for (const l of listeners) l([...items]);
}

export function pushToast(t: Omit<ToastItem, "id" | "ttl"> & { ttl?: number }): number {
  const item: ToastItem = { id: nextId++, ttl: t.ttl ?? 6000, ...t };
  items = [item, ...items].slice(0, 5);
  emit();
  if (item.ttl > 0) {
    setTimeout(() => dismissToast(item.id), item.ttl);
  }
  return item.id;
}

export function dismissToast(id: number): void {
  items = items.filter((x) => x.id !== id);
  emit();
}

const KIND_COLOR: Record<ToastItem["kind"], string> = {
  info: "--quip-accent",
  success: "--quip-ok",
  error: "--quip-bad",
  quest: "--quip-accent",
};

const ACTION_BTN_STYLE: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  color: "rgb(var(--quip-accent-deep))",
  background: "rgba(var(--quip-accent), 0.12)",
  border: "1px solid rgba(var(--quip-accent), 0.35)",
  borderRadius: 8,
  padding: "3px 9px",
  cursor: "pointer",
};

export function Toaster() {
  const [list, setList] = useState<ToastItem[]>(items);

  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);

  return (
    <div
      className="quip-toaster"
      style={{
        position: "fixed",
        bottom: 18,
        right: 18,
        zIndex: 400,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxWidth: 340,
        pointerEvents: "none",
      }}
      role="status"
      aria-live="polite"
    >
      <AnimatePresence>
        {list.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, x: 24, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: 0.97 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="quip-toast"
            style={{
              pointerEvents: "auto",
              background: "rgb(var(--chrome-bg) / 0.96)",
              backdropFilter: "blur(18px)",
              WebkitBackdropFilter: "blur(18px)",
              borderRadius: 12,
              padding: "10px 12px",
              border: "1px solid rgba(var(--quip-line), 0.12)",
              borderLeft: `3px solid rgb(var(${KIND_COLOR[t.kind]}))`,
              boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "rgb(var(--chrome-text))" }}>
                  {t.title}
                </div>
                {t.body && (
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "rgb(var(--chrome-soft))",
                      marginTop: 2,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      maxHeight: 120,
                      overflow: "hidden",
                    }}
                  >
                    {t.body}
                  </div>
                )}
                {t.action && (
                  <div style={{ marginTop: 7 }}>
                    <button
                      type="button"
                      onClick={() => {
                        t.action!.onClick();
                        dismissToast(t.id);
                      }}
                      aria-label={t.action.label}
                      className="quip-focusable"
                      style={ACTION_BTN_STYLE}
                    >
                      {t.action.label}
                    </button>
                  </div>
                )}
                {t.actions && t.actions.length > 0 && (
                  <div style={{ display: "flex", gap: 6, marginTop: 7 }}>
                    {t.actions.map((a) => (
                      <button
                        key={a.label}
                        onClick={() => {
                          a.onClick();
                          dismissToast(t.id);
                        }}
                        aria-label={a.label}
                        className="quip-focusable"
                        style={ACTION_BTN_STYLE}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => dismissToast(t.id)}
                aria-label="Dismiss notification"
                className="quip-focusable"
                style={{
                  fontSize: 12,
                  lineHeight: 1,
                  color: "rgb(var(--chrome-soft))",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 2,
                }}
              >
                ✕
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
