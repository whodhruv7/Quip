// Quip — Command Palette (Ctrl+K) + Shortcuts overlay (?) — roadmap UX-016, UX-017
// ─────────────────────────────────────────────────────────────────────────────
// One fuzzy-searchable surface for every power action: one-tap tasks go
// through the normal chat pipeline (they dispatch a quick-task event the App
// listens for), settings/navigation are direct callbacks. Full keyboard path.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { THEMES } from "@/lib/theme";

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  group: "Tasks" | "Device" | "Settings" | "Themes";
  task?: string; // sent through the chat pipeline as a normal user message
  run?: () => void;
}

export function buildPaletteActions(opts: {
  setTheme: (t: any) => void;
  cyclePermissionMode: () => void;
  openSettings: () => void;
  clearChat: () => void;
}): PaletteAction[] {
  const task = (id: string, label: string, message: string, group: PaletteAction["group"], hint?: string): PaletteAction =>
    ({ id, label, hint, group, task: message });
  return [
    task("organize-downloads", "Organize my Downloads", "organize my downloads", "Tasks", "plan → approve → move, undoable"),
    task("organize-date", "Organize Downloads by month", "organize my downloads by date", "Tasks"),
    task("duplicates", "Find duplicate files", "find duplicates in downloads", "Tasks", "size + SHA-256 confirmed"),
    task("storage", "Storage report", "downloads ki storage report", "Tasks"),
    task("contacts-csv", "Export contacts to CSV", "export contacts", "Tasks"),
    task("morning-brief", "Morning brief", "run the morning-brief quest", "Tasks", "battery + weather, spoken"),
    task("outbox", "Show MailWing outbox", "show my mail outbox", "Tasks"),
    task("self-check", "Run device self-check", "run a device self check", "Device", "honest health table"),
    task("battery", "Battery status", "battery kaisi hai", "Device"),
    task("screenshot", "Screenshot → Pictures", "screenshot and save it", "Device"),
    task("clipboard", "Clipboard history", "show clipboard history", "Device"),
    task("sys-info", "System status", "show system status", "Device"),
    {
      id: "permission-mode",
      label: "Cycle permission mode",
      hint: "ask every time → approve task → full access",
      group: "Settings",
      run: opts.cyclePermissionMode,
    },
    { id: "settings", label: "Open Settings", group: "Settings", run: opts.openSettings },
    { id: "clear", label: "Clear this conversation", group: "Settings", run: opts.clearChat },
    ...THEMES.map((t): PaletteAction => ({
      id: `theme-${t.id}`,
      label: `Theme: ${t.label}`,
      group: "Themes",
      run: () => opts.setTheme(t.id),
    })),
  ];
}

function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 1;
  if (t.includes(q)) return 100 - t.indexOf(q);
  // subsequence match
  let ti = 0;
  let hits = 0;
  for (const ch of q) {
    const idx = t.indexOf(ch, ti);
    if (idx === -1) return 0;
    hits += 1;
    ti = idx + 1;
  }
  return hits / q.length;
}

export function CommandPalette({
  open,
  onClose,
  actions,
  onTask,
}: {
  open: boolean;
  onClose: () => void;
  actions: PaletteAction[];
  onTask: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const scored = actions
      .map((a) => ({ a, s: Math.max(fuzzyScore(query, a.label), fuzzyScore(query, `${a.group} ${a.hint ?? ""}`) * 0.4) }))
      .filter((x) => x.s > 0)
      .sort((x, y) => y.s - x.s)
      .slice(0, 12);
    return scored.map((x) => x.a);
  }, [actions, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => setSelected(0), [query]);

  const execute = (a: PaletteAction) => {
    onClose();
    if (a.task) onTask(a.task);
    else a.run?.();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[selected]) execute(results[selected]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onMouseDown={onClose}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 500,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: "14vh",
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onMouseDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Command palette"
            style={{
              width: 440,
              maxWidth: "92vw",
              background: "rgb(var(--chrome-bg) / 0.98)",
              borderRadius: 14,
              border: "1px solid rgba(var(--quip-line), 0.14)",
              boxShadow: "0 24px 70px rgba(0,0,0,0.35)",
              overflow: "hidden",
            }}
          >
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Type a command or task…"
              aria-label="Search commands"
              className="quip-focusable"
              style={{
                width: "100%",
                border: "none",
                outline: "none",
                background: "transparent",
                padding: "13px 16px",
                fontSize: 14,
                color: "rgb(var(--chrome-text))",
                borderBottom: "1px solid rgba(var(--quip-line), 0.08)",
              }}
            />
            <div ref={listRef} style={{ maxHeight: 320, overflowY: "auto", padding: 6 }}>
              {results.length === 0 && (
                <div style={{ padding: "14px 12px", fontSize: 12.5, color: "rgb(var(--chrome-soft))" }}>
                  Nothing matches "{query}" — try "organize", "battery", "theme"…
                </div>
              )}
              {results.map((a, i) => (
                <button
                  key={a.id}
                  data-selected={i === selected}
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => execute(a)}
                  className="quip-focusable quip-palette-row"
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 10px",
                    borderRadius: 9,
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                    background: i === selected ? "rgba(var(--quip-accent), 0.12)" : "transparent",
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: 0.4,
                      textTransform: "uppercase",
                      color: "rgb(var(--quip-accent-deep))",
                      background: "rgba(var(--quip-accent), 0.10)",
                      borderRadius: 6,
                      padding: "2px 6px",
                      flexShrink: 0,
                    }}
                  >
                    {a.group}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "rgb(var(--chrome-text))" }}>
                      {a.label}
                    </span>
                    {a.hint && (
                      <span style={{ display: "block", fontSize: 10.5, color: "rgb(var(--chrome-soft))" }}>
                        {a.hint}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
            <div
              style={{
                padding: "7px 14px",
                borderTop: "1px solid rgba(var(--quip-line), 0.08)",
                fontSize: 10.5,
                color: "rgb(var(--chrome-soft))",
                display: "flex",
                gap: 14,
              }}
            >
              <span>↑↓ navigate</span>
              <span>↵ run</span>
              <span>esc close</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ShortcutsOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const ROWS: [string, string][] = [
    ["Ctrl + K", "Command palette — every action, one search away"],
    ["?", "This shortcuts overlay"],
    ["Esc", "Close overlays · exit fullscreen · hide panel (mascot stays)"],
    ["↑ / ↓", "Move through palette results"],
    ["Enter", "Run the selected command"],
  ];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onMouseDown={onClose}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 500,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.18 }}
            onMouseDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Keyboard shortcuts"
            style={{
              width: 380,
              maxWidth: "92vw",
              background: "rgb(var(--chrome-bg) / 0.98)",
              borderRadius: 14,
              border: "1px solid rgba(var(--quip-line), 0.14)",
              boxShadow: "0 24px 70px rgba(0,0,0,0.35)",
              padding: 16,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: "rgb(var(--chrome-text))", marginBottom: 10 }}>
              Keyboard shortcuts
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {ROWS.map(([k, d]) => (
                <div key={k} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      fontFamily: "ui-monospace, monospace",
                      color: "rgb(var(--chrome-text))",
                      background: "rgba(var(--quip-line), 0.10)",
                      borderRadius: 6,
                      padding: "3px 7px",
                      flexShrink: 0,
                      minWidth: 64,
                      textAlign: "center",
                    }}
                  >
                    {k}
                  </span>
                  <span style={{ fontSize: 11.5, color: "rgb(var(--chrome-soft))" }}>{d}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
