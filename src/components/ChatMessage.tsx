// Quip V2 — single chat bubble.
//
// Premium styling with CSS vars. Trust-layer notes shown beneath assistant
// messages ("Opening Edge because it's your default browser"). Action results
// get a distinct badge so the user knows Quip did something, not just said it.
//
// Polish:
//   - Copy button on assistant messages (appears on hover)
//   - Copy button on code blocks (roadmap UX-008)
//   - Trust layer note fades in with 100ms delay (feels like an afterthought)
//   - Stagger animation on entry (50ms delay per message in batch)
//   - UX-005: contact cards under replies that contain email addresses
//   - UX-012: optional pin toggle (App owns the state — purely presentational)
//   - UX-015: contextual quick-reply chips after a task result
//   - UX-026: tiny provider · latency badge (honesty about which brain + how fast)
//   - UX-028: skeleton shimmer while the first chunks are still in flight
//   - UX-041: semantic <article role="article"> roots

import { memo, useCallback, useMemo, useState } from "react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage as ChatMessageType } from "@/types";
import { getCompanion } from "@/lib/companion-config";
import { ContactCards } from "./ContactCards";
import { dispatchQuickTask, ensureQuipUxStyles, prefersReducedMotion } from "./chat-ux";

/** Code block with a hover copy button (UX-008). */
function CodeBlock({ children }: { children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = extractText(children);
  const onCopy = useCallback(() => {
    try {
      void navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }, [text]);
  return (
    <div className="quip-codeblock" style={{ position: "relative" }}>
      <pre>{children}</pre>
      <button
        onClick={onCopy}
        aria-label={copied ? "Copied code" : "Copy code"}
        className="quip-copy-btn quip-focusable"
        style={{
          position: "absolute",
          top: 6,
          right: 6,
          height: 22,
          minWidth: 22,
          padding: "0 5px",
          borderRadius: 6,
          fontSize: 11,
          opacity: 0,
          color: "rgb(var(--quip-text-soft))",
          background: "rgba(var(--quip-line), 0.12)",
          border: "1px solid rgba(var(--quip-line), 0.16)",
          cursor: "pointer",
        }}
      >
        {copied ? "✓" : "⧉"}
      </button>
    </div>
  );
}

function extractText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  const el = node as { props?: { children?: React.ReactNode } };
  return el.props?.children !== undefined ? extractText(el.props.children) : "";
}

// ─── UX-028: skeleton shimmer — the reply is forming ────────────────────────
function SkeletonLines() {
  ensureQuipUxStyles();
  const reduced = prefersReducedMotion();
  const line = (width: string): React.CSSProperties => ({
    width,
    height: 9,
    borderRadius: 5,
    background:
      "linear-gradient(90deg, rgba(var(--quip-line), 0.08) 25%, rgba(var(--quip-line), 0.18) 50%, rgba(var(--quip-line), 0.08) 75%)",
    backgroundSize: "160px 100%",
    // Reduced motion → static blocks (the global CSS clamp also disarms this).
    animation: reduced ? undefined : "quipSkeletonShimmer 1.3s linear infinite",
  });
  return (
    <div className="flex flex-col gap-2 py-0.5" role="status" aria-label="Quip is writing a reply">
      <div style={line("85%")} />
      <div style={line("68%")} />
      <div style={line("42%")} />
    </div>
  );
}

interface MessageBaseProps {
  message: ChatMessageType;
  index?: number;
  /** Re-sends the last user message after a failed reply ("Try again"). */
  onRetry?: () => void;
  /** UX-012: pin state lives in App (A2) — this is purely presentational. */
  pinned?: boolean;
  /** UX-012: provided → the pin toggle renders; absent → no button. */
  onPin?: () => void;
}

// ─── UX-006: what→where move tables (organize plans, watch reports) ─────────
function parseMoveLines(content: string): { from: string; to: string }[] {
  const lines = content.split(/\r?\n/);
  const rows: { from: string; to: string }[] = [];
  for (const l of lines) {
    const m = l.match(/^\s*[•\-*]?\s*(.{1,64}?)\s*(?:→|->)\s*(.{1,80})\s*$/);
    if (m && rows.length < 12) rows.push({ from: m[1].trim(), to: m[2].trim() });
  }
  return rows.length >= 3 ? rows : [];
}

function MoveTable({ rows }: { rows: { from: string; to: string }[] }) {
  return (
    <div
      className="quip-move-table"
      role="table"
      aria-label="File moves"
      style={{
        marginTop: 6,
        borderRadius: 10,
        border: "1px solid rgba(var(--quip-line), 0.12)",
        background: "rgba(var(--quip-line), 0.03)",
        overflow: "hidden",
        maxWidth: "100%",
      }}
    >
      {rows.map((r, i) => (
        <div
          key={i}
          role="row"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 9px",
            borderTop: i === 0 ? "none" : "1px solid rgba(var(--quip-line), 0.07)",
            fontSize: 10,
          }}
        >
          <span role="cell" style={{ flex: "0 0 42%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgb(var(--quip-text))", direction: "rtl", textAlign: "left" }} title={r.from}>
            {r.from}
          </span>
          <span aria-hidden style={{ color: "rgb(var(--quip-accent-deep))", flexShrink: 0 }}>→</span>
          <span role="cell" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(var(--quip-text-soft), 0.95)" }} title={r.to}>
            {r.to}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── UX-004: structured email draft card (To/Subject/Body + real actions) ───
function parseEmailDraft(content: string): { to: string; subject: string; body: string } | null {
  if (!/draft ready/i.test(content)) return null;
  const to = content.match(/^To:\s*(.+)$/m)?.[1]?.trim();
  const subject = content.match(/^Subject:\s*(.+)$/m)?.[1]?.trim();
  const body = content.split(/^---$/m)[1]?.trim();
  if (!to || !subject || !body) return null;
  return { to, subject, body: body.slice(0, 700) };
}

function EmailPreviewCard({ draft }: { draft: { to: string; subject: string; body: string } }) {
  return (
    <div
      role="group"
      aria-label="Email draft preview"
      style={{
        marginTop: 7,
        borderRadius: 11,
        border: "1px solid rgba(var(--quip-accent), 0.3)",
        background: "rgba(var(--quip-accent), 0.06)",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "7px 10px 4px", fontSize: 10, fontWeight: 700, color: "rgb(var(--quip-accent-deep))", display: "flex", alignItems: "center", gap: 6 }}>
        <span aria-hidden>✉</span> Email draft — nothing sends until you approve
      </div>
      <div style={{ padding: "0 10px 8px" }}>
        <div style={{ fontSize: 10.5, color: "rgb(var(--quip-text))" }}>
          <b>To:</b> <span style={{ wordBreak: "break-all" }}>{draft.to}</span>
        </div>
        <div style={{ fontSize: 10.5, color: "rgb(var(--quip-text))", marginTop: 2 }}>
          <b>Subject:</b> {draft.subject}
        </div>
        <div
          style={{
            marginTop: 5,
            fontSize: 10.5,
            lineHeight: 1.55,
            color: "rgba(var(--quip-text-soft), 0.95)",
            whiteSpace: "pre-wrap",
            maxHeight: 120,
            overflowY: "auto",
          }}
        >
          {draft.body}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 7 }}>
          <button
            onClick={() => dispatchQuickTask("send it")}
            aria-label="Approve and send this email"
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "4px 11px",
              borderRadius: 7,
              cursor: "pointer",
              color: "#fff",
              background: "linear-gradient(135deg, rgb(var(--quip-accent)), rgb(var(--quip-accent-3)))",
              border: "none",
            }}
          >
            Send it
          </button>
          <button
            onClick={() => {
              try {
                void navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`);
              } catch {
                /* clipboard unavailable */
              }
            }}
            aria-label="Copy the email body"
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "4px 10px",
              borderRadius: 7,
              cursor: "pointer",
              color: "rgb(var(--quip-text-soft))",
              background: "rgba(var(--quip-line), 0.06)",
              border: "1px solid rgba(var(--quip-line), 0.12)",
            }}
          >
            Copy
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBase({ message, index = 0, onRetry, pinned, onPin }: MessageBaseProps) {
  const isUser = message.role === "user";
  const empty = message.content.length === 0 && message.streaming;
  const theme = getCompanion(message.companionId ?? "pix");
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available */
    }
  };

  // UX-015: honest quick replies after a task result. (Hook lives above the
  // user/assistant branches — hooks must run unconditionally.)
  const quickReplies = useMemo(() => {
    if (isUser || !message.action || message.streaming) return [];
    const chips: Array<{ label: string; task: string }> = [];
    if (!message.action.success) {
      chips.push({ label: "What failed?", task: "problems dikhao" });
    } else if (/organiz|moved/i.test(message.content)) {
      chips.push({ label: "Undo organize", task: "undo last organize" });
    }
    chips.push({ label: "Next…", task: "what should I do next?" });
    return chips;
  }, [isUser, message.action, message.streaming, message.content]);

  if (isUser) {
    return (
      <motion.article
        role="article"
        aria-label="Your message"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut", delay: Math.min(index * 0.03, 0.2) }}
        className="flex justify-end group"
      >
        <div
          className="max-w-[82%] rounded-2xl rounded-br-md px-4 py-2.5 text-[14px] leading-relaxed text-white"
          style={{
            background: `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})`,
            boxShadow: `0 2px 12px ${theme.primary}25`,
          }}
        >
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      </motion.article>
    );
  }

  const latencyBadge =
    !message.error && message.provider && message.latencyMs
      ? `${message.provider} · ${(message.latencyMs / 1000).toFixed(1)}s`
      : null;

  return (
    <motion.article
      role="article"
      aria-label={`Message from ${theme.name}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut", delay: Math.min(index * 0.03, 0.2) }}
      className="flex justify-start gap-2 group"
    >
      <div
        className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
        style={{
          background: `linear-gradient(135deg, ${theme.primary}22, ${theme.secondary}18)`,
          boxShadow: "inset 0 0 0 1px rgba(var(--quip-line), 0.10)",
        }}
      >
        <span className="h-2 w-2 rounded-full" style={{ background: theme.primary }} />
      </div>

      <div className="flex max-w-[82%] flex-col gap-1">
        <div
          className="relative rounded-2xl rounded-bl-md px-4 py-2.5 text-[14px] leading-relaxed"
          style={
            message.error
              ? {
                  background: "rgba(var(--quip-bad), 0.10)",
                  color: "rgb(var(--quip-bad))",
                  border: "1px solid rgba(var(--quip-bad), 0.22)",
                }
              : {
                  // OPAQUE theme surface — readable ink in every palette.
                  background: "rgba(var(--quip-line), 0.05)",
                  color: "rgb(var(--quip-text))",
                  border: "1px solid rgba(var(--quip-line), 0.09)",
                }
          }
        >
          {empty ? (
            <SkeletonLines />
          ) : (
            <div className="quip-md break-words">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: CodeBlock }}>
                {message.content}
              </ReactMarkdown>
              {message.streaming && (
                <span
                  className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse"
                  style={{ background: theme.primary }}
                />
              )}
            </div>
          )}

          {!empty && !message.streaming && !message.error && (
            <div className="absolute top-1 right-1 flex items-center gap-1 opacity-0 transition-all group-hover:opacity-100 focus-within:opacity-100">
              {onPin && (
                <button
                  onClick={onPin}
                  aria-label={pinned ? "Unpin message" : "Pin message"}
                  className="quip-copy-btn quip-focusable"
                  style={{
                    height: 20,
                    padding: "0 6px",
                    borderRadius: 6,
                    fontSize: 10,
                    fontWeight: 600,
                    color: pinned ? "rgb(var(--quip-accent-deep))" : "rgb(var(--quip-text-soft))",
                    background: pinned ? "rgba(var(--quip-accent), 0.14)" : undefined,
                  }}
                >
                  {pinned ? "Unpin" : "Pin"}
                </button>
              )}
              <button
                onClick={handleCopy}
                aria-label={copied ? "Copied" : "Copy message"}
                className="quip-copy-btn quip-focusable flex h-6 w-6 items-center justify-center rounded-md"
                style={{ fontSize: 11, color: "rgb(var(--quip-text-soft))" }}
              >
                {copied ? "✓" : "⧉"}
              </button>
            </div>
          )}
        </div>

        {/* UX-005: person chips for emails the reply surfaced */}
        {!message.error && <ContactCards content={message.content} />}

        {/* UX-006: what→where rows when the reply reports file moves */}
        {!message.error && message.role === "assistant" && (() => {
          const rows = parseMoveLines(message.content);
          return rows.length >= 3 ? <MoveTable rows={rows} /> : null;
        })()}

        {/* UX-004: structured draft card with real approve/copy actions */}
        {!message.error && message.role === "assistant" && (() => {
          const draft = parseEmailDraft(message.content);
          return draft ? <EmailPreviewCard draft={draft} /> : null;
        })()}

        {message.contextNote && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.15 }}
            className="trust-note"
          >
            <span className="trust-note-dot" style={{ background: theme.primary }} />
            <span>{message.contextNote}</span>
          </motion.div>
        )}

        {/* Failed reply → one-tap retry (the failure trail is in the bubble) */}
        {message.error && onRetry && (
          <button
            onClick={onRetry}
            className="mt-0.5 flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 transition-all hover:scale-[1.04]"
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "rgb(var(--quip-accent-deep))",
              background: "rgba(var(--quip-accent), 0.12)",
              border: "1px solid rgba(var(--quip-accent), 0.4)",
              cursor: "pointer",
            }}
          >
            ↻ Try again
          </button>
        )}

        {message.action && (
          <div
            className="inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5"
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: `rgb(var(--quip-${message.action.success ? "ok" : "bad"}))`,
              background: `rgba(var(--quip-${message.action.success ? "ok" : "bad"}),0.08)`,
            }}
          >
            <span>{message.action.success ? "✓" : "✕"}</span>
            <span>{message.action.success ? "Done" : "Failed"}</span>
          </div>
        )}

        {/* UX-026: which brain answered + how fast (purely informational) */}
        {latencyBadge && (
          <span aria-hidden style={{ fontSize: 9, color: "rgba(var(--quip-text-soft), 0.55)", paddingLeft: 2 }}>
            {latencyBadge}
          </span>
        )}

        {/* UX-012: persistent (not hover-only) pinned marker */}
        {pinned && (
          <span style={{ fontSize: 10, color: "rgba(var(--quip-text-soft), 0.8)" }}>📌 Pinned</span>
        )}

        {/* UX-015: contextual chips — every one goes through the real pipeline */}
        {quickReplies.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Quick replies">
            {quickReplies.map((chip) => (
              <button
                key={chip.label}
                onClick={() => dispatchQuickTask(chip.task)}
                aria-label={`${chip.label} — ask Quip: ${chip.task}`}
                className="flex w-fit items-center gap-1 rounded-full px-2.5 py-1 transition-all hover:scale-[1.04]"
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: "rgb(var(--quip-accent-deep))",
                  background: "rgba(var(--quip-accent), 0.12)",
                  border: "1px solid rgba(var(--quip-accent), 0.4)",
                  cursor: "pointer",
                }}
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </motion.article>
  );
}

export const ChatMessageView = memo(MessageBase);
