// Quip Contacts Book — the people Quip met (ghost extractions, chat saves)
// ─────────────────────────────────────────────────────────────────────────────
// 100% local JSON store (CAP-096). Dedupe-by-email merge, source tracking,
// scored fuzzy search over a prebuilt lowercase index (<5ms at 5000, CAP-087).
// Pure core (mergeContact / scoreContact / toCsv) is unit-tested without fs.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";

const CAP = 5000; // CAP-081

let baseDir: string | null = null;

export function configureContactsBook(userDataDir: string): void {
  baseDir = path.join(userDataDir, "contacts");
  try {
    fs.mkdirSync(baseDir, { recursive: true });
  } catch {
    /* read paths still fail soft */
  }
}

function storePath(): string {
  if (!baseDir) throw new Error("Contacts Book not configured — configureContactsBook(userDataDir) must run at boot");
  return path.join(baseDir, "book.json");
}

export interface Contact {
  id: string;
  email?: string;
  phone?: string;
  name?: string;
  company?: string;
  note?: string;
  /** Every place this person came from, newest last. */
  sources: string[];
  firstSeen: number;
  lastSeen: number;
  /** Prebuilt lowercase haystack — the search index (CAP-087). */
  index: string;
}

export interface ContactInput {
  email?: string;
  phone?: string;
  name?: string;
  company?: string;
  note?: string;
  /** e.g. "ghost:acme.com", "manual:chat", "ghost:https://site.com/about" */
  source?: string;
}

function normalizeEmail(e?: string): string | undefined {
  const v = (e ?? "").trim().toLowerCase();
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}$/.test(v) ? v : undefined;
}

function buildIndex(c: Pick<Contact, "email" | "phone" | "name" | "company" | "note">): string {
  return [c.email, c.phone, c.name, c.company, c.note].filter(Boolean).join(" ").toLowerCase();
}

/** Pure merge rule: incoming fills gaps, refreshes recency, appends sources. */
export function mergeContact(existing: Contact, incoming: ContactInput, now: number, source = "manual"): Contact {
  const email = normalizeEmail(incoming.email) ?? existing.email;
  const phone = incoming.phone?.trim() || existing.phone;
  const name = incoming.name?.trim() || existing.name;
  const company = incoming.company?.trim() || existing.company;
  const note = incoming.note?.trim() || existing.note;
  const sources = existing.sources.includes(source) ? existing.sources : [...existing.sources, source].slice(-8);
  const merged: Contact = {
    ...existing,
    email,
    phone,
    name,
    company,
    note,
    sources,
    lastSeen: now,
  };
  merged.index = buildIndex(merged);
  return merged;
}

// ─── Store ops ───────────────────────────────────────────────────────────────

function load(): Contact[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), "utf8"));
    if (Array.isArray(parsed)) return parsed.slice(0, CAP);
  } catch {
    /* fresh book */
  }
  return [];
}

function save(list: Contact[]): void {
  const tmp = `${storePath()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list.slice(0, CAP), null, 2), "utf8");
  fs.renameSync(tmp, storePath());
}

/** Insert or merge one contact. Dedupe key: email, else phone. */
export function upsertContact(input: ContactInput): { ok: boolean; contact?: Contact; error?: string } {
  const email = normalizeEmail(input.email);
  const phone = input.phone?.replace(/[^\d+]/g, "");
  if (!email && !phone) {
    return { ok: false, error: "a contact needs a valid email or a phone number" };
  }
  const now = Date.now();
  const list = load();
  const idx = list.findIndex((c) => (email && c.email === email) || (!email && phone && c.phone === phone));
  if (idx === -1) {
    if (list.length >= CAP) list.shift(); // evict oldest (CAP-081)
    const contact: Contact = {
      id: `c-${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      email,
      phone,
      name: input.name?.trim() || undefined,
      company: input.company?.trim() || undefined,
      note: input.note?.trim() || undefined,
      sources: [input.source ?? "manual"],
      firstSeen: now,
      lastSeen: now,
      index: "",
    };
    contact.index = buildIndex(contact);
    list.push(contact);
    try {
      save(list);
      return { ok: true, contact };
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e).slice(0, 160) };
    }
  }
  const merged = mergeContact(list[idx], { ...input, email }, now, input.source ?? "manual");
  list[idx] = merged;
  try {
    save(list);
    return { ok: true, contact: merged };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 160) };
  }
}

export function removeContact(idOrEmail: string): { ok: boolean; removed?: string; error?: string } {
  const list = load();
  const key = idOrEmail.trim().toLowerCase();
  const idx = list.findIndex((c) => c.id === idOrEmail || c.email === key);
  if (idx === -1) return { ok: false, error: `no contact "${idOrEmail}"` };
  const [removed] = list.splice(idx, 1);
  try {
    save(list);
    return { ok: true, removed: removed.email ?? removed.name ?? removed.id };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 160) };
  }
}

// ─── Search (pure scoring — unit-tested) ────────────────────────────────────

/** Score one contact against a query. 0 = no match. */
export function scoreContact(contact: Contact, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  if (contact.email === q) return 100;
  if (contact.email?.startsWith(q)) return 90;
  let score = 0;
  const tokens = q.split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    if (contact.index.includes(t)) score += 20;
  }
  if (contact.name?.toLowerCase().startsWith(q)) score += 35;
  if (contact.company?.toLowerCase().startsWith(q)) score += 25;
  return Math.min(100, score);
}

export function searchContacts(query: string, limit = 8): Contact[] {
  const list = load();
  const scored = list
    .map((c) => ({ c, s: scoreContact(c, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.c.lastSeen - a.c.lastSeen);
  return scored.slice(0, limit).map((x) => x.c);
}

export function listContacts(limit = 50): Contact[] {
  return load()
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, limit);
}

/** "email Rahul" — resolve a person to an address before asking the user. */
export function resolveEmail(query: string): { email: string; contact: Contact } | null {
  const [best] = searchContacts(query, 1);
  return best?.email ? { email: best.email, contact: best } : null;
}

// ─── CSV export (pure formatter — unit-tested) ──────────────────────────────

export function toCsv(contacts: Contact[]): string {
  const esc = (v: string | undefined): string => {
    const s = (v ?? "").replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const rows = [["name", "email", "phone", "company", "note", "sources", "lastSeen"]];
  for (const c of contacts) {
    rows.push([c.name ?? "", c.email ?? "", c.phone ?? "", c.company ?? "", c.note ?? "", c.sources.join("|"), new Date(c.lastSeen).toISOString()]);
  }
  return rows.map((r) => r.map(esc).join(",")).join("\n");
}

export function exportContactsCsv(filePath?: string): { ok: boolean; path?: string; count?: number; error?: string } {
  const list = load();
  if (list.length === 0) return { ok: false, error: "the contacts book is empty" };
  const desktop =
    filePath ??
    (process.platform === "win32"
      ? path.join(process.env.USERPROFILE ?? "C:", "Desktop")
      : path.join(process.env.HOME ?? "/tmp", "Desktop"));
  const target = filePath ?? path.join(desktop, `quip-contacts-${new Date().toISOString().slice(0, 10)}.csv`);
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, toCsv(list), "utf8");
    return { ok: true, path: target, count: list.length };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 160) };
  }
}
