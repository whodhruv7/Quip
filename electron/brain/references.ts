// Quip Head Brain — Reference Resolution (Phase 1 STEP 1 + Phase 3 of spec)
// ─────────────────────────────────────────────────────────────────────────────
// "Open that" / "close it" / "play another one" / "do it again" must resolve
// using the conversation — never ask what "it" is when memory already knows.
//
// This module is PURE and SYNCHRONOUS (sub-millisecond): it substitutes
// references with concrete targets from the conversation memory + execution
// context. When a reference exists but memory is empty, it reports
// `unresolved` so the understanding layer can ask ONE short clarification
// instead of guessing (spec: never guess, never fake).
// ─────────────────────────────────────────────────────────────────────────────

export interface ReferenceInput {
  /** Last remembered interaction (from conversation memory), if any. */
  last?: {
    command?: string;
    goal?: string;
    primaryIntent?: string;
    objects?: Array<{ name: string; type: string; confidence: number }>;
    actedTarget?: string;
    actedTargetType?: string;
  } | null;
  /** Execution context carry-overs (context-store). */
  lastOpenedPath?: string;
  lastMediaQuery?: string;
  activeApp?: string;
  activeWebsite?: string;
}

export interface ResolutionResult {
  /** Text after substituting references (same as input when nothing matched). */
  resolved: string;
  /** Human-readable trace of what was substituted (spec: explain why). */
  notes: string[];
  /** Set when a reference was detected but memory could not resolve it. */
  unresolved: string | null;
  confidence: number;
}

const PRONOUN = String.raw`(it|that|this|wahi|usko|usse|us\s+wale|the\s+same\s+one|same\s+one)`;
/** Command-shaped endings where a trailing pronoun is a TARGET, not filler.
 *  A trailing "again" is allowed after the pronoun ("play it again"). */
const PRONOUN_TARGET = new RegExp(
  String.raw`^(open|close|launch|start|run|kill|focus|quit|play|pause|find|show|reveal|goto|go\s+to|minimize|maximize|restore|kholo|khol\s+do|band\s+karo|chalao|bajao|dekho|dikhao|dhundo|dhoondo)\b[^.!?;]{0,32}?` +
    String.raw`\b` +
    PRONOUN +
    String.raw`(\s+(again|phir\s+se))?\s*[.!?]?\s*$`,
  "i"
);

/** "play another one" / "ek aur" — same intent, a NEW item of the same type. */
const ANOTHER = /^(play|open|find|show|search)\s+(another\s+one|one\s+more|ek\s+aur|next\s+one)\b[.!?]?\s*$/i;
/** "do it again" / "phir se karo" — replay the previous plan verbatim. */
const AGAIN = /^(do\s+it\s+again|again|phir\s+se|phir\s+se\s+karo|fir\s+se|repeat)\b[.!?]?\s*$/i;
/** "the file I just opened" / "jo file khole thi". */
const LAST_FILE = /\b(the\s+)?(file|document|pdf|image|photo|video)\s+(i\s+)?(just\s+)?(opened|used|downloaded|khola|khole)\b/i;

const TYPE_NOUN: Record<string, string> = {
  app: "app",
  website: "website",
  song: "song",
  file: "file",
  folder: "folder",
  person: "contact",
};

function pronounReplacement(mem: ReferenceInput): { name: string; type: string; via: string } | null {
  const last = mem.last;
  if (last?.actedTarget && last.actedTargetType) {
    return { name: last.actedTarget, type: last.actedTargetType, via: "last interaction" };
  }
  if (last?.objects?.length) {
    const o = last.objects.find((x) => x.type === "app" || x.type === "website" || x.type === "file" || x.type === "folder" || x.type === "song");
    if (o) return { name: o.name, type: o.type, via: "last interaction" };
  }
  if (mem.activeApp) return { name: mem.activeApp, type: "app", via: "current active app" };
  if (mem.activeWebsite) return { name: mem.activeWebsite, type: "website", via: "current active website" };
  return null;
}

/**
 * Resolve references in one pass. Always returns a usable result —
 * `resolved` equals the input when nothing matched.
 */
export function resolveReferences(raw: string, mem: ReferenceInput): ResolutionResult {
  const text = raw.trim();
  const notes: string[] = [];
  if (!text) return { resolved: text, notes, unresolved: null, confidence: 1 };

  // ── "do it again" → replay the previous command verbatim ────────────────
  const again = text.match(AGAIN);
  if (again) {
    const prev = mem.last?.command;
    if (prev) {
      notes.push(`"again" → replaying the previous task ("${prev.slice(0, 60)}")`);
      return { resolved: prev, notes, unresolved: null, confidence: 0.9 };
    }
    return { resolved: text, notes, unresolved: "previous task", confidence: 0.3 };
  }

  // ── "play another one" → same intent, next item of the same type ────────
  const another = text.match(ANOTHER);
  if (another) {
    const verb = another[1];
    const type = mem.last?.actedTargetType ?? mem.last?.objects?.[0]?.type ?? "song";
    const noun = TYPE_NOUN[type] ?? "one";
    notes.push(`"another one" → another ${noun} (from the last ${type})`);
    return { resolved: `${verb} another ${noun}`, notes, unresolved: null, confidence: 0.85 };
  }

  // ── "the file I just opened" → concrete path from execution context ─────
  const lastFile = text.match(LAST_FILE);
  if (lastFile && mem.lastOpenedPath) {
    const resolved = text.replace(LAST_FILE, mem.lastOpenedPath);
    notes.push(`"the ${lastFile[2]} you ${lastFile[5]}" → ${mem.lastOpenedPath}`);
    return { resolved, notes, unresolved: null, confidence: 0.9 };
  }

  // ── trailing pronoun as target: "close it", "open that", "wahi kholo" ───
  const pron = text.match(PRONOUN_TARGET);
  if (pron) {
    const rep = pronounReplacement(mem);
    if (rep) {
      // Replace ONLY the trailing pronoun (the last group in the match).
      const pronounText = pron[2];
      const idx = text.toLowerCase().lastIndexOf(pronounText.toLowerCase());
      const resolved = idx >= 0 ? text.slice(0, idx) + rep.name + text.slice(idx + pronounText.length) : text;
      notes.push(`"${pronounText}" → ${rep.name} (${rep.type}, ${rep.via})`);
      return { resolved: resolved.trim(), notes, unresolved: null, confidence: 0.88 };
    }
    return { resolved: text, notes, unresolved: pronounText(pron), confidence: 0.3 };
  }

  return { resolved: text, notes, unresolved: null, confidence: 1 };
}

function pronounText(pron: RegExpMatchArray): string {
  return pron[2] ?? "it";
}
