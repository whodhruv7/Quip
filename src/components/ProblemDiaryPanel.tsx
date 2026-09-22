// Quip — Problem Diary panel (Settings → Problems)
// ─────────────────────────────────────────────────────────────────────────────
// "Har problem yaad rakhi jaaye" — every failure Quip recorded, listed here
// with severity, source, occurrence counts and evidence. The user can:
//   • filter open/resolved/all
//   • mark a problem resolved (it reopens automatically if it returns)
//   • EXPORT the diary as a readable Markdown file to the Desktop — the file
//     to hand back so every line can be fixed against real data
// Live-updates via the PROBLEM_DIARY_CHANGED broadcast.
import { useEffect, useState } from "react";
import type { CompanionId } from "@/types";

type Entry = {
  id: string;
  source: string;
  kind: string;
  severity: "low" | "medium" | "high";
  title: string;
  detail: string;
  evidence?: string[];
  status: "open" | "resolved";
  firstSeen: number;
  lastSeen: number;
  occurrences: number;
  reopenCount: number;
};

type Stats = { open: number; resolved: number; high: number; total: number };

const SEVERITY_COLORS: Record<Entry["severity"], string> = {
  high: "rgb(var(--quip-bad))",
  medium: "rgb(var(--quip-warn, 234, 179, 8))",
  low: "rgb(var(--quip-ok))",
};

function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function ProblemDiaryPanel({ onOpenAI }: { companionId?: CompanionId; onOpenAI?: () => void }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("open");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = (f = filter) => {
    window.quip
      .problemDiaryGet({ status: f, limit: 300 })
      .then((r) => {
        setEntries(r.entries as Entry[]);
        setStats(r.stats);
      })
      .catch(() => {});
  };

  useEffect(() => {
    load();
    // Live refresh — a problem recorded while the panel is open appears at once.
    const off = window.quip.onProblemDiaryChanged?.(() => load());
    return () => off?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const resolve = async (id: string) => {
    setBusy(true);
    try {
      await window.quip.problemDiaryResolve(id);
      load();
    } finally {
      setBusy(false);
    }
  };

  const exportDiary = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await window.quip.problemDiaryExport();
      setNote(r.ok ? `Saved: ${r.path}` : `Export failed — ${r.error ?? "unknown"}`);
    } finally {
      setBusy(false);
    }
  };

  const clearResolved = async () => {
    setBusy(true);
    try {
      const r = await window.quip.problemDiaryClear("resolved");
      setNote(r.ok ? `Cleared ${r.removed} resolved entr${r.removed === 1 ? "y" : "ies"}.` : "Couldn't clear.");
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Header + stats */}
      <div
        className="rounded-xl px-3 py-3"
        style={{ background: "rgba(var(--quip-line), 0.03)", border: "1px solid rgba(var(--quip-line), 0.09)" }}
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "rgb(var(--quip-text))" }}>Problem Diary</div>
            <div style={{ fontSize: 10.5, color: "rgba(var(--quip-text-soft), 0.9)", marginTop: 2 }}>
              Every task that failed is remembered here — automatically, with evidence.
            </div>
          </div>
        </div>
        {stats && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {(
              [
                ["open", stats.open, stats.open > 0 ? "rgb(var(--quip-bad))" : "rgb(var(--quip-ok))"],
                ["high", stats.high, "rgb(var(--quip-bad))"],
                ["resolved", stats.resolved, "rgb(var(--quip-ok))"],
                ["total", stats.total, "rgba(var(--quip-text-soft), 0.95)"],
              ] as [string, number, string][]
            ).map(([label, n, color]) => (
              <span
                key={label}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color,
                  background: "rgba(var(--quip-line), 0.05)",
                  border: "1px solid rgba(var(--quip-line), 0.1)",
                  borderRadius: 999,
                  padding: "2px 9px",
                }}
              >
                {n} {label}
              </span>
            ))}
          </div>
        )}
        {stats && stats.open > 0 && (
          <div style={{ fontSize: 10.5, color: "rgba(var(--quip-text-soft), 0.9)", marginTop: 7 }}>
            Ask Quip “<b>problems dikhao</b>”, or export the report below and share it — every line
            can then be fixed against real data.
            {stats.high > 0 && onOpenAI && (
              <>
                {" "}
                <button
                  onClick={onOpenAI}
                  style={{ fontSize: 10.5, fontWeight: 600, color: "rgb(var(--quip-accent-deep))", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
                >
                  Check the AI Brain →
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Filter + actions */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1">
          {(["open", "resolved", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                textTransform: "capitalize",
                padding: "4px 11px",
                borderRadius: 8,
                cursor: "pointer",
                color: filter === f ? "#fff" : "rgba(var(--quip-text-soft), 0.95)",
                background: filter === f ? "linear-gradient(135deg, rgb(var(--quip-accent)), rgb(var(--quip-accent-3)))" : "rgba(var(--quip-line), 0.05)",
                border: "none",
              }}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={exportDiary}
            disabled={busy}
            aria-label="Export problem report as Markdown"
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              padding: "5px 12px",
              borderRadius: 8,
              cursor: "pointer",
              color: "#fff",
              background: "linear-gradient(135deg, rgb(var(--quip-accent)), rgb(var(--quip-accent-3)))",
              border: "none",
              opacity: busy ? 0.6 : 1,
            }}
          >
            Export report ↓
          </button>
          {filter !== "open" && (
            <button
              onClick={clearResolved}
              disabled={busy}
              aria-label="Clear resolved problems"
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                padding: "5px 10px",
                borderRadius: 8,
                cursor: "pointer",
                color: "rgba(var(--quip-text-soft), 0.95)",
                background: "rgba(var(--quip-line), 0.05)",
                border: "1px solid rgba(var(--quip-line), 0.12)",
              }}
            >
              Clear resolved
            </button>
          )}
        </div>
      </div>

      {note && (
        <div
          style={{
            fontSize: 10.5,
            color: "rgb(var(--quip-accent-deep))",
            background: "rgba(var(--quip-accent), 0.08)",
            border: "1px solid rgba(var(--quip-accent), 0.25)",
            borderRadius: 9,
            padding: "6px 10px",
            wordBreak: "break-all",
          }}
        >
          {note}
        </div>
      )}

      {/* Entries */}
      {entries.length === 0 ? (
        <div
          className="rounded-xl px-3 py-6 text-center"
          style={{ background: "rgba(var(--quip-ok), 0.05)", border: "1px solid rgba(var(--quip-ok), 0.2)" }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: "rgb(var(--quip-ok))" }}>
            {filter === "open" ? "No open problems — sab kuch theek hai ✨" : "Nothing here yet."}
          </div>
          <div style={{ fontSize: 10.5, color: "rgba(var(--quip-text-soft), 0.85)", marginTop: 3 }}>
            {filter === "open"
              ? "Every verified success stays verified; anything that fails will show up here."
              : `Switch the filter to see ${filter === "resolved" ? "resolved" : "all"} entries.`}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {entries.map((e) => {
            const open = expanded === e.id;
            return (
              <div
                key={e.id}
                style={{
                  borderRadius: 11,
                  border: `1px solid ${e.status === "open" ? "rgba(var(--quip-line), 0.12)" : "rgba(var(--quip-ok), 0.25)"}`,
                  background: e.status === "open" ? "rgba(var(--quip-line), 0.03)" : "rgba(var(--quip-ok), 0.04)",
                  overflow: "hidden",
                }}
              >
                <button
                  onClick={() => setExpanded(open ? null : e.id)}
                  aria-expanded={open}
                  className="w-full text-left"
                  style={{ padding: "8px 11px", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "flex-start", gap: 8 }}
                >
                  <span
                    aria-label={`severity ${e.severity}`}
                    style={{
                      flexShrink: 0,
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      marginTop: 4,
                      background: SEVERITY_COLORS[e.severity],
                      opacity: e.status === "resolved" ? 0.4 : 1,
                    }}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: "block",
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: e.status === "resolved" ? "rgba(var(--quip-text-soft), 0.75)" : "rgb(var(--quip-text))",
                        textDecoration: e.status === "resolved" ? "line-through" : "none",
                        wordBreak: "break-word",
                      }}
                    >
                      {e.title}
                    </span>
                    <span style={{ display: "block", fontSize: 9.5, color: "rgba(var(--quip-text-soft), 0.8)", marginTop: 2 }}>
                      {e.source} · {e.kind} · {e.occurrences}× · {timeAgo(e.lastSeen)}
                      {e.reopenCount > 0 ? ` · reopened ${e.reopenCount}×` : ""}
                    </span>
                  </span>
                  {e.status === "open" && e.severity === "high" && (
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: 8.5,
                        fontWeight: 800,
                        letterSpacing: 0.4,
                        color: "rgb(var(--quip-bad))",
                        border: "1px solid rgba(var(--quip-bad), 0.4)",
                        borderRadius: 999,
                        padding: "1px 6px",
                      }}
                    >
                      HIGH
                    </span>
                  )}
                </button>
                {open && (
                  <div style={{ padding: "0 11px 10px", borderTop: "1px solid rgba(var(--quip-line), 0.07)" }}>
                    {e.detail && (
                      <pre
                        style={{
                          margin: "8px 0 0",
                          fontSize: 10,
                          lineHeight: 1.5,
                          color: "rgba(var(--quip-text-soft), 0.95)",
                          background: "rgba(var(--quip-line), 0.04)",
                          borderRadius: 8,
                          padding: "7px 9px",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          fontFamily: "inherit",
                        }}
                      >
                        {e.detail}
                      </pre>
                    )}
                    {e.evidence && e.evidence.length > 0 && (
                      <div style={{ marginTop: 6 }}>
                        {e.evidence.map((ev, i) => (
                          <div key={i} style={{ fontSize: 9.5, color: "rgba(var(--quip-text-soft), 0.8)" }}>
                            • {ev}
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                      {e.status === "open" ? (
                        <button
                          onClick={() => resolve(e.id)}
                          disabled={busy}
                          aria-label="Mark problem resolved"
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "4px 11px",
                            borderRadius: 7,
                            cursor: "pointer",
                            color: "rgb(var(--quip-ok))",
                            background: "rgba(var(--quip-ok), 0.1)",
                            border: "1px solid rgba(var(--quip-ok), 0.3)",
                          }}
                        >
                          Mark resolved
                        </button>
                      ) : (
                        <span style={{ fontSize: 9.5, color: "rgba(var(--quip-text-soft), 0.7)", alignSelf: "center" }}>
                          Resolved — if it happens again it reopens automatically.
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
