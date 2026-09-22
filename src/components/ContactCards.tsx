// Quip — ContactCards (roadmap UX-005)
// ─────────────────────────────────────────────────────────────────────────────
// Detects email addresses inside an assistant reply and renders themed person
// chips with honest, working actions:
//   Copy  → navigator.clipboard
//   Save  → window.quip.contactsSave({ email, name, source: "chat-card" })
//           → toast "Saved" on success / honest error toast on failure
//   Email → dispatches "quip:quick-task" with `draft an email to <email>
//           about ` (the trailing space invites the user to finish the
//           sentence — App routes it through the normal chat pipeline).
// No emails in the content → renders nothing. Max 6, deduped.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import { pushToast } from "./Toaster";
import { dispatchQuickTask } from "./chat-ux";

interface DetectedContact {
  email: string;
  /** Derived from nearby text ("Priya Sharma <priya@…>"); undefined → show email. */
  name?: string;
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const MAX_CONTACTS = 6;

/**
 * Extract + dedupe emails and try to derive a display name from the text
 * right before each one ("Priya Sharma <priya@acme.com>", "Priya (priya@…)",
 * "Priya — priya@…", "Priya: priya@…"). Conservative: no match → no name.
 */
export function extractContacts(content: string): DetectedContact[] {
  if (!content) return [];
  const seen = new Set<string>();
  const out: DetectedContact[] = [];
  for (const match of content.matchAll(EMAIL_RE)) {
    const email = match[0];
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const at = match.index ?? 0;
    const before = content.slice(Math.max(0, at - 80), at);
    const nameMatch = before.match(
      /([A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){0,2})\s*[<(—–:]\s*$/
    );
    out.push({
      email,
      ...(nameMatch?.[1] ? { name: nameMatch[1].trim() } : {}),
    });
    if (out.length >= MAX_CONTACTS) break;
  }
  return out;
}

function initialsOf(label: string): string {
  const clean = label.replace(/@.*/, "").trim();
  const parts = clean.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const smallBtn: React.CSSProperties = {
  height: 24,
  minWidth: 24,
  padding: "0 5px",
  borderRadius: 7,
  fontSize: 11,
  color: "rgb(var(--quip-text-soft))",
  background: "rgba(var(--quip-line), 0.07)",
  border: "1px solid rgba(var(--quip-line), 0.14)",
  cursor: "pointer",
  lineHeight: 1,
};

function ContactChip({ contact }: { contact: DetectedContact }) {
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const label = contact.name ?? contact.email;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(contact.email);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const api = window.quip as unknown as {
        contactsSave?: (input: {
          email?: string;
          name?: string;
          source?: string;
        }) => Promise<{ ok: boolean; error?: string }>;
      };
      const res = await api.contactsSave?.({
        email: contact.email,
        ...(contact.name ? { name: contact.name } : {}),
        source: "chat-card",
      });
      if (res?.ok) {
        pushToast({ title: "Saved", body: `${label} → contacts book`, kind: "success", ttl: 3500 });
      } else {
        pushToast({
          title: "Couldn't save the contact",
          body: res?.error || "The contacts book didn't accept it.",
          kind: "error",
          ttl: 5000,
        });
      }
    } catch {
      pushToast({ title: "Couldn't save the contact", body: "Contacts book unavailable.", kind: "error", ttl: 5000 });
    } finally {
      setSaving(false);
    }
  };

  const handleEmail = () => {
    // Trailing space on purpose — the user finishes the sentence.
    dispatchQuickTask(`draft an email to ${contact.email} about `);
  };

  return (
    <div
      className="flex items-center gap-1.5 rounded-full py-1 pl-1.5 pr-1.5"
      style={{
        background: "rgba(var(--quip-line), 0.05)",
        border: "1px solid rgba(var(--quip-line), 0.12)",
      }}
    >
      <span
        aria-hidden
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
        style={{
          fontSize: 8.5,
          fontWeight: 700,
          color: "rgb(var(--quip-accent-deep))",
          background: "rgba(var(--quip-accent), 0.16)",
        }}
      >
        {initialsOf(label)}
      </span>
      <span className="flex min-w-0 flex-col" style={{ maxWidth: 170 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "rgb(var(--quip-text))",
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {label}
        </span>
        {contact.name && (
          <span
            style={{
              fontSize: 9,
              color: "rgba(var(--quip-text-soft), 0.75)",
              lineHeight: 1.2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {contact.email}
          </span>
        )}
      </span>
      <span style={{ display: "inline-flex", gap: 3 }}>
        <button type="button" onClick={handleCopy} aria-label={`Copy email address of ${label}`} className="quip-focusable" style={smallBtn}>
          {copied ? "✓" : "⧉"}
        </button>
        <button
          type="button"
          onClick={handleSave}
          aria-label={`Save ${label} to contacts`}
          disabled={saving}
          className="quip-focusable"
          style={{ ...smallBtn, opacity: saving ? 0.5 : 1 }}
        >
          {saving ? "…" : "💾"}
        </button>
        <button type="button" onClick={handleEmail} aria-label={`Draft an email to ${label}`} className="quip-focusable" style={smallBtn}>
          ✉️
        </button>
      </span>
    </div>
  );
}

/** Rendered under assistant messages whose content contains emails. */
export function ContactCards({ content }: { content: string }) {
  const contacts = useMemo(() => extractContacts(content), [content]);
  if (contacts.length === 0) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      role="group"
      aria-label="People detected in this message"
    >
      {contacts.map((c) => (
        <ContactChip key={c.email.toLowerCase()} contact={c} />
      ))}
    </div>
  );
}
