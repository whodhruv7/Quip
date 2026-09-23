// Quip ErrorBar — the honest little strip that remembers every failure
// ─────────────────────────────────────────────────────────────────────────────
// Sits on EVERY screen (companion, panel, full, fullscreen). When anything
// fails — a task step, a tool, mail, a quest — the Problem Diary records it
// and this bar lights up: severity dot, open count, newest failure. Expand
// it to see the list, download the Markdown report for the developer, or
// jump to Settings → Problems.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { pushToast } from "@/components/Toaster";
import type { ProblemDiaryEntry, ProblemDiaryStats } from "../../electron/shared";

const SEVERITY_COLOR: Record<ProblemDiaryEntry["severity"], string> = {
  high: "rgb(var(--quip-bad))",
  medium: "rgb(var(--quip-warn, 234 179 8))",
  low: "rgb(var(--chrome-soft))",
};

function relTime(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

interface ErrorBarProps {
  /** Which window mode we're in — companion mode has no TopBar, so the bar hugs the top edge. */
  mode: "companion" | "panel" | "full" | "fullscreen";
  onOpenProblems: () => void;
}

export function ErrorBar({ mode, onOpenProblems }: ErrorBarProps) {
  const [stats, setStats] = useState<ProblemDiaryStats | null>(null);
  const [entries, setEntries] = useState<ProblemDiaryEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  async function refresh() {
    try {
      const res = await window.quip.problemDiaryGet({ status: "open", limit: 8 });
      setStats(res.stats);
      setEntries(res.entries);
    } catch {
      /* the bar never fights the app for attention */
    }
  }

  useEffect(() => {
    void refresh();
    const off = window.quip.onProblemDiaryChanged(() => void refresh());
    return off;
  }, []);

  const openCount = stats?.open ?? 0;
  if (openCount === 0) return null;

  async function download() {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await window.quip.problemDiaryExport();
      if (res.ok && res.path) {
        pushToast({
          title: "Report saved 📄",
          body: res.path,
          kind: "success",
          ttl: 7000,
        });
      } else {
        pushToast({ title: "Couldn't save the report", body: res.error ?? "unknown reason", kind: "error", ttl: 6000 });
      }
    } catch (e: any) {
      pushToast({ title: "Couldn't save the report", body: String(e?.message ?? e).slice(0, 140), kind: "error", ttl: 6000 });
    } finally {
      setExporting(false);
    }
  }

  const newest = entries[0];

  return (
    <div
      style={{
        position: "fixed",
        left: 10,
        right: 10,
        top: mode === "companion" ? 0 : 42,
        zIndex: 350,
        pointerEvents: "none",
      }}
    >
      <motion.div
        layout
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          pointerEvents: "auto",
          maxWidth: 460,
          margin: "0 auto",
          background: "rgb(var(--chrome-bg) / 0.94)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          border: "1px solid rgba(var(--quip-bad), 0.28)",
          borderBottom: "none",
          borderRadius: open ? "12px 12px 0 0" : 12,
          boxShadow: "0 8px 26px rgba(0,0,0,0.22)",
          overflow: "hidden",
        }}
        role="status"
      >
        {/* collapsed strip */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={`${openCount} open problems — click to expand`}
          className="quip-focusable"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            padding: "5px 10px",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: "rgb(var(--quip-bad))",
              boxShadow: "0 0 8px rgba(var(--quip-bad), 0.8)",
              animation: "quipPulse 1.6s ease-in-out infinite",
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "rgb(var(--chrome-text))", whiteSpace: "nowrap" }}>
            {openCount} problem{openCount === 1 ? "" : "s"}
          </span>
          {newest && (
            <span
              style={{
                fontSize: 11,
                color: "rgb(var(--chrome-soft))",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
                minWidth: 0,
              }}
            >
              {newest.title}
            </span>
          )}
          <span style={{ fontSize: 10, color: "rgb(var(--chrome-soft))", flexShrink: 0 }}>
            {open ? "hide ▲" : "show ▼"}
          </span>
        </button>

        {/* expanded list */}
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="list"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              style={{ overflow: "hidden" }}
            >
              <div style={{ maxHeight: 210, overflowY: "auto", padding: "4px 8px 8px", display: "flex", flexDirection: "column", gap: 6 }}>
                {entries.length === 0 && (
                  <div style={{ fontSize: 11, color: "rgb(var(--chrome-soft))", padding: "6px 4px" }}>
                    No open problems right now.
                  </div>
                )}
                {entries.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      borderRadius: 9,
                      border: "1px solid rgba(var(--quip-line), 0.14)",
                      background: "rgba(var(--quip-line), 0.05)",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedId((cur) => (cur === p.id ? null : p.id))}
                      className="quip-focusable"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        width: "100%",
                        padding: "6px 8px",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 999,
                          background: SEVERITY_COLOR[p.severity],
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          fontSize: 11.5,
                          fontWeight: 600,
                          color: "rgb(var(--chrome-text))",
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {p.title}
                      </span>
                      <span style={{ fontSize: 10, color: "rgb(var(--chrome-soft))", flexShrink: 0 }}>
                        {p.occurrences}× · {relTime(p.lastSeen)}
                      </span>
                    </button>
                    {expandedId === p.id && (
                      <div style={{ padding: "0 10px 8px", fontSize: 11, color: "rgb(var(--chrome-soft))", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {p.detail || "No extra detail was recorded for this one."}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6, padding: "0 8px 9px" }}>
                <button
                  type="button"
                  onClick={download}
                  disabled={exporting}
                  className="quip-focusable"
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: "rgb(var(--quip-accent-deep))",
                    background: "rgba(var(--quip-accent), 0.12)",
                    border: "1px solid rgba(var(--quip-accent), 0.35)",
                    borderRadius: 8,
                    padding: "4px 10px",
                    cursor: exporting ? "wait" : "pointer",
                    opacity: exporting ? 0.6 : 1,
                  }}
                >
                  {exporting ? "Saving…" : "Download report"}
                </button>
                <button
                  type="button"
                  onClick={onOpenProblems}
                  className="quip-focusable"
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: "rgb(var(--chrome-soft))",
                    background: "transparent",
                    border: "1px solid rgba(var(--quip-line), 0.25)",
                    borderRadius: 8,
                    padding: "4px 10px",
                    cursor: "pointer",
                  }}
                >
                  Open Problems
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
