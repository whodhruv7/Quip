// Quip WebGhost — Offscreen DOM Automation Engine
// ─────────────────────────────────────────────────────────────────────────────
// A SECOND browser surface: hidden Electron BrowserWindow that Quip can READ
// and OPERATE. The user's real browser stays theirs — nothing here touches it.
// This is what makes "open that site, find the email, use it" possible.
//
// Design rules (roadmap A):
//   • Pure core: extractContactsFromHtml / pickBestContact / buildGhostScript
//     are string→data functions — unit-tested WITHOUT Electron.
//   • SSRF gate on EVERY navigation (reuse isSafePublicUrl).
//   • Budget: max 6 navigations per session, idle auto-close 60s, hard close
//     on quit. A ghost session can never linger forever.
//   • Values are JSON-encoded into scripts — never string-spliced (CAP-091).
// ─────────────────────────────────────────────────────────────────────────────

import { BrowserWindow } from "electron";
import { isSafePublicUrl } from "./browser-automation";

// ─── Pure core: contact extraction ───────────────────────────────────────────

export interface GhostContact {
  email?: string;
  phone?: string;
  name?: string;
  role?: string; // anchor text / nearby label that identified it
  source: "mailto" | "text" | "deobfuscated" | "tel" | "social";
  score: number;
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi;
const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3,5}[\s.-]?\d{3,5}(?:[\s.-]?\d{2,4})?/g;
const MAILTO_RE = /mailto:([^"'?>\s]+)/gi;
const TEL_RE = /tel:([^"'?>\s]+)/gi;

/** How bad is this address as a *contact* target? Lower = better. */
const TRAP_SCORES: [RegExp, number][] = [
  [/^(noreply|no-reply|donotreply|do-not-reply)@/i, 100],
  [/^(privacy|abuse|postmaster|webmaster|hostmaster|abuse@)@?/i, 60],
  [/@(example|test|domain|email|yourdomain|sample)\.(com|org|net)$/i, 100],
  [/\.(png|jpg|jpeg|gif|webp|css|js)$/i, 100],
  [/^(info|contact|hello|hi|support|help|office|admin|sales|enquiries|inquiries|team|mail)@/i, 22],
  [/sentry\.io|wixpress|godaddy|squarespace/i, 80],
];

function scoreEmail(email: string, role: string): number {
  let score = 50;
  for (const [re, penalty] of TRAP_SCORES) {
    if (re.test(email)) score -= penalty;
  }
  // Personal-looking addresses are gold for "email the guy".
  if (/^[a-z][a-z0-9._-]*@[a-z0-9.-]+\.[a-z]{2,24}$/i.test(email) && !/^(info|contact|hello|hi|support|help|office|admin|sales|team|mail|careers|jobs|hr|press|media|marketing|billing|accounts|legal|api|dev|test|user|admin)@/i.test(email)) {
    score += 20;
  }
  if (role) {
    const r = role.toLowerCase();
    if (/(founder|ceo|director|manager|owner|proprietor|contact|reach|mail|email|write)/.test(r)) score += 15;
    if (/(copyright|terms|privacy|policy|cookie)/.test(r)) score -= 25;
  }
  return Math.max(0, Math.min(100, score));
}

/** Decode "name [at] site [dot] com" style obfuscations. */
export function deobfuscateEmails(text: string): string[] {
  const found: string[] = [];
  const pattern =
    /([a-z0-9._%+-]+)\s*(?:\[at\]|\(at\)|#at#|\{at\}|@|&#64;|\s+at\s+)\s*([a-z0-9.-]+)\s*(?:\[dot\]|\(dot\)|#dot#|\{dot\}|\.|&#46;|\s+dot\s+)\s*([a-z]{2,24})/gi;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text))) {
    const email = `${m[1]}@${m[2]}.${m[3]}`.toLowerCase();
    if (/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}$/.test(email)) found.push(email);
  }
  return found;
}

function titleCase(s: string): string {
  return s
    .replace(/[._-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Extract every contact from raw HTML. Uses regex over the markup (no DOM
 * needed in tests). Dedupes by email; keeps the BEST role text per address.
 */
export function extractContactsFromHtml(html: string, max = 12): GhostContact[] {
  const src = (html ?? "").slice(0, 600_000); // hard cap — huge pages can't stall this
  const byEmail = new Map<string, GhostContact>();

  const record = (c: Partial<GhostContact> & { source: GhostContact["source"] }) => {
    if (c.email) {
      const key = c.email.toLowerCase();
      const prev = byEmail.get(key);
      if (!prev || c.score! > prev.score) {
        byEmail.set(key, {
          email: key,
          name: c.name ?? prev?.name,
          role: c.role ?? prev?.role,
          source: c.source,
          score: Math.max(c.score ?? 0, prev?.score ?? 0),
        });
      }
      return;
    }
    if (c.phone) {
      const key = c.phone.replace(/\s+/g, "");
      const prev = byEmail.get(`tel:${key}`);
      if (!prev || c.score! > prev.score) {
        byEmail.set(`tel:${key}`, { phone: c.phone, name: c.name, role: c.role, source: c.source, score: c.score ?? 0 });
      }
    }
  };

  // 1) mailto: links — the highest-signal source, with anchor text as role.
  MAILTO_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MAILTO_RE.exec(src))) {
    const email = decodeURIComponent(m[1]).split("?")[0].toLowerCase();
    if (!EMAIL_TEST.test(email)) continue;
    const before = src.slice(Math.max(0, m.index - 220), m.index);
    const anchor = lastAnchorText(before);
    record({ email, name: personNameFrom(email, anchor), role: anchor, source: "mailto", score: scoreEmail(email, anchor) + 10 });
  }

  // 2) visible text emails (strip tags first so attributes don't pollute).
  const text = src
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&#64;/g, "@").replace(/&nbsp;/g, " ");
  EMAIL_RE.lastIndex = 0;
  while ((m = EMAIL_RE.exec(text))) {
    const email = m[0].toLowerCase().replace(/\.$/, "");
    if (!EMAIL_TEST.test(email)) continue;
    const around = text.slice(Math.max(0, m.index - 120), m.index + 80);
    record({ email, name: personNameFrom(email, around), role: cleanRole(around), source: "text", score: scoreEmail(email, around) });
  }

  // 3) deobfuscated.
  for (const email of deobfuscateEmails(src)) {
    record({ email, source: "deobfuscated", role: "hidden address decoded", score: scoreEmail(email, "contact") });
  }

  // 4) tel: links.
  TEL_RE.lastIndex = 0;
  while ((m = TEL_RE.exec(src))) {
    const phone = decodeURIComponent(m[1]).replace(/[^\d+]/g, "");
    if (phone.length >= 8 && phone.length <= 16) {
      const before = src.slice(Math.max(0, m.index - 200), m.index);
      record({ phone, name: lastAnchorText(before), source: "tel", score: 45 });
    }
  }

  const ranked = [...byEmail.values()].sort((a, b) => b.score - a.score);
  // Phones only matter when no email exists at all.
  const emails = ranked.filter((c) => c.email);
  if (emails.length > 0) return emails.slice(0, max);
  return ranked.filter((c) => c.phone).slice(0, max);
}

const EMAIL_TEST = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}$/i;

function lastAnchorText(htmlBefore: string): string {
  const anchor = [...htmlBefore.matchAll(/<a[^>]*>([\s\S]{0,120}?)<\/a>/gi)].pop();
  const text = anchor?.[1] ?? "";
  return cleanRole(text);
}

function cleanRole(s: string): string {
  return (s ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

function personNameFrom(email: string, context: string): string | undefined {
  // "rahul.sharma@acme.com" → "Rahul Sharma" (only when the local part looks
  // like a name, not a role mailbox).
  const local = email.split("@")[0];
  if (/^(info|contact|hello|hi|support|help|office|admin|sales|team|mail|careers|jobs|hr|press|media|marketing|billing|accounts|legal|api|dev|no-?reply)/i.test(local)) return undefined;
  if (/[0-9]{3,}/.test(local)) return undefined;
  const parts = local.split(/[._-]+/).filter((p) => p.length >= 2 && /^[a-z]+$/i.test(p));
  if (parts.length === 0 || parts.length > 3) return undefined;
  const display = titleCase(parts.join(" "));
  // Prefer a name seen in nearby text (e.g. an <a> that says the person).
  if (context && context.toLowerCase().includes(display.toLowerCase().split(" ")[0])) return display;
  return display;
}

/** Pick the contact a request like "email the founder of X" actually means. */
export function pickBestContact(contacts: GhostContact[], hint?: string): GhostContact | null {
  if (contacts.length === 0) return null;
  if (!hint || !hint.trim()) return contacts[0];
  const h = hint.toLowerCase().trim();
  let best: GhostContact | null = null;
  let bestScore = -Infinity;
  for (const c of contacts) {
    let s = c.score;
    const hay = `${c.name ?? ""} ${c.role ?? ""} ${c.email ?? ""}`.toLowerCase();
    if (hay.includes(h)) s += 60;
    else {
      for (const tok of h.split(/\s+/).filter((t) => t.length >= 3)) {
        if (hay.includes(tok)) s += 18;
      }
    }
    if (s > bestScore) {
      best = c;
      bestScore = s;
    }
  }
  return best;
}

/** From a link harvest, choose the page most likely to hold humans' emails. */
export function findContactPage(links: { href: string; text: string }[]): string | null {
  const scored = links
    .map((l) => {
      const href = l.href.toLowerCase();
      const text = l.text.toLowerCase();
      let s = 0;
      if (/contact|about|team|impressum|reach|connect|people|staff/.test(href)) s += 30;
      if (/contact|email|reach|touch|team|impressum|write to/.test(text)) s += 25;
      if (/^mailto:/i.test(l.href)) s += 20;
      if (/#contact/.test(href)) s += 10;
      return { href: l.href, s };
    })
    .filter((x) => /^https?:\/\//i.test(x.href) || /^mailto:/i.test(x.href))
    .sort((a, b) => b.s - a.s);
  const top = scored[0];
  if (!top || top.s < 25) return null;
  return top.href.startsWith("mailto:") ? null : top.href;
}

// ─── Pure core: DOM script builders (values are JSON-encoded, CAP-091) ──────

export function buildGhostScript(kind: "harvest" | "click" | "fill" | "wait" | "submit", args: Record<string, unknown>): string {
  const payload = JSON.stringify(args);
  switch (kind) {
    case "harvest":
      return `(() => {
  const out = { title: document.title, url: location.href, text: "", html: "", links: [] };
  out.text = (document.body && document.body.innerText || "").slice(0, 40000);
  out.html = document.documentElement.outerHTML.slice(0, 500000);
  const seen = new Set();
  for (const a of Array.from(document.querySelectorAll("a[href]"))) {
    let href = ""; try { href = a.href; } catch {}
    if (!href || seen.has(href)) continue; seen.add(href);
    out.links.push({ href, text: (a.innerText || a.getAttribute("aria-label") || "").trim().slice(0, 120) });
    if (out.links.length >= 300) break;
  }
  return out;
})()`;
    case "click":
      return `(() => {
  const needle = ${payload}.text.toLowerCase();
  const els = Array.from(document.querySelectorAll('a,button,[role="button"],input[type="submit"],input[type="button"]'));
  const el = els.find((e) => {
    const t = ((e.innerText || "") + " " + (e.getAttribute("aria-label") || "") + " " + (e.value || "")).toLowerCase();
    return t.includes(needle);
  });
  if (!el) return { clicked: false, reason: "no visible element with that text" };
  el.scrollIntoView({ block: "center" });
  el.click();
  return { clicked: true, label: (el.innerText || el.getAttribute("aria-label") || el.tagName).slice(0, 80) };
})()`;
    case "fill":
      return `(() => {
  const fields = ${payload}.fields;
  const report = [];
  for (const f of fields) {
    const sel = f.selector;
    let el = null;
    try { el = document.querySelector(sel); } catch {}
    if (!el) {
      el = Array.from(document.querySelectorAll('input,textarea')).find((i) =>
        ((i.name || "") + " " + (i.placeholder || "") + " " + (i.getAttribute("aria-label") || "")).toLowerCase().includes(f.hint.toLowerCase()));
    }
    if (!el) { report.push({ field: f.hint, filled: false, reason: "not found" }); continue; }
    el.focus();
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, f.value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    report.push({ field: f.hint, filled: true });
  }
  return { report };
})()`;
    case "wait":
      return `(() => {
  const needle = ${payload}.text.toLowerCase();
  const body = (document.body && document.body.innerText || "").toLowerCase();
  return { found: body.includes(needle), title: document.title };
})()`;
    case "submit":
      return `(() => {
  const forms = Array.from(document.querySelectorAll("form"));
  const f = forms.find((x) => x.querySelector("input[type=email],textarea,input[type=text]"));
  if (!f) return { submitted: false, reason: "no form found" };
  if (typeof f.requestSubmit === "function") f.requestSubmit(); else f.submit();
  return { submitted: true, action: f.action || "(same page)" };
})()`;
  }
}

// ─── Electron shell: the hidden window + budget ──────────────────────────────

const MAX_NAVIGATIONS = 6;
const IDLE_CLOSE_MS = 60_000;

interface GhostSession {
  win: BrowserWindow;
  navigations: number;
  idleTimer: NodeJS.Timeout;
}

let session: GhostSession | null = null;

function clearIdleTimer(s: GhostSession): void {
  clearTimeout(s.idleTimer);
}

function armIdleTimer(s: GhostSession): void {
  clearIdleTimer(s);
  s.idleTimer = setTimeout(() => {
    destroyGhostSession("idle 60s");
  }, IDLE_CLOSE_MS);
  s.idleTimer.unref?.();
}

export function destroyGhostSession(reason = "manual"): void {
  if (!session) return;
  clearIdleTimer(session);
  try {
    session.win.destroy();
  } catch {
    /* already gone */
  }
  session = null;
}

export function ghostSessionInfo(): { active: boolean; navigations: number } {
  return { active: Boolean(session), navigations: session?.navigations ?? 0 };
}

function ensureWindow(): BrowserWindow {
  if (session) return session.win;
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      // Isolated session: zero cookie/state sharing with anything else (CAP-090).
      partition: "persist=quip-ghost",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      images: false, // speed — text and links are all we need
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" })); // no popups
  session = {
    win,
    navigations: 0,
    idleTimer: setTimeout(() => {}, 0),
  };
  armIdleTimer(session);
  return win;
}

export interface GhostNavResult {
  ok: boolean;
  url?: string;
  title?: string;
  statusText?: string;
  error?: string;
}

async function ghostNavigate(rawUrl: string): Promise<GhostNavResult> {
  const gate = isSafePublicUrl(rawUrl);
  if (!gate.safe) {
    return { ok: false, error: `unsafe URL — ${gate.reason}` };
  }
  if (session && session.navigations >= MAX_NAVIGATIONS) {
    destroyGhostSession("navigation budget spent");
    return { ok: false, error: `ghost session navigation budget (${MAX_NAVIGATIONS} pages) is spent — ask again for a fresh pass` };
  }
  const win = ensureWindow();
  try {
    await win.loadURL(gate.url!);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    // ERR_ABORTED is what loadURL reports when the page itself redirects
    // mid-load — the navigation still happened, so probe reality before failing.
    if (!msg.includes("ERR_ABORTED")) {
      return { ok: false, error: `load failed: ${msg.slice(0, 160)}` };
    }
  }
  if (session) {
    session.navigations += 1;
    armIdleTimer(session);
  }
  const url = win.webContents.getURL();
  const title = win.webContents.getTitle();
  return { ok: true, url, title: title || url };
}

async function ghostExecute<T>(script: string, timeoutMs = 15_000): Promise<T> {
  const win = ensureWindow();
  return (await Promise.race([
    win.webContents.executeJavaScript(script, true),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`ghost script timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ])) as T;
}

// ─── High-level operations (the ones executors call) ─────────────────────────

export interface GhostHarvest {
  title: string;
  url: string;
  text: string;
  html: string;
  links: { href: string; text: string }[];
}

export async function ghostHarvest(rawUrl: string): Promise<{ ok: boolean; data?: GhostHarvest; error?: string }> {
  const nav = await ghostNavigate(rawUrl);
  if (!nav.ok) return { ok: false, error: nav.error };
  try {
    const data = await ghostExecute<GhostHarvest>(buildGhostScript("harvest", {}));
    return { ok: true, data: { ...data, url: data.url || nav.url! } };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 200) };
  }
}

export async function ghostReadPage(rawUrl: string): Promise<{ ok: boolean; title?: string; text?: string; error?: string }> {
  const harvest = await ghostHarvest(rawUrl);
  if (!harvest.ok || !harvest.data) return { ok: false, error: harvest.error };
  return { ok: true, title: harvest.data.title, text: harvest.data.text };
}

export async function ghostExtractContacts(
  rawUrl: string
): Promise<{ ok: boolean; contacts: GhostContact[]; title?: string; followedContactPage?: boolean; error?: string }> {
  const harvest = await ghostHarvest(rawUrl);
  if (!harvest.ok || !harvest.data) return { ok: false, contacts: [], error: harvest.error };
  let contacts = extractContactsFromHtml(harvest.data.html + "\n" + harvest.data.text);
  let followedContactPage = false;

  // One follow: a contact/about page usually beats the homepage.
  if (contacts.length === 0) {
    const next = findContactPage(harvest.data.links);
    if (next) {
      const second = await ghostHarvest(next);
      if (second.ok && second.data) {
        const more = extractContactsFromHtml(second.data.html + "\n" + second.data.text);
        if (more.length > 0) {
          contacts = more;
          followedContactPage = true;
        }
      }
    }
  }
  return { ok: true, contacts, title: harvest.data.title, followedContactPage };
}

export async function ghostClickText(rawUrl: string, text: string): Promise<{ ok: boolean; clicked?: boolean; label?: string; error?: string }> {
  const nav = await ghostNavigate(rawUrl);
  if (!nav.ok) return { ok: false, error: nav.error };
  try {
    const r = await ghostExecute<{ clicked: boolean; label?: string; reason?: string }>(
      buildGhostScript("click", { text: text.slice(0, 120) })
    );
    return r.clicked ? { ok: true, clicked: true, label: r.label } : { ok: true, clicked: false, error: r.reason };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 200) };
  }
}

export interface GhostField {
  selector?: string;
  hint: string;
  value: string;
}

export async function ghostFill(rawUrl: string, fields: GhostField[]): Promise<{ ok: boolean; report?: { field: string; filled: boolean; reason?: string }[]; error?: string }> {
  const nav = await ghostNavigate(rawUrl);
  if (!nav.ok) return { ok: false, error: nav.error };
  try {
    const r = await ghostExecute<{ report: { field: string; filled: boolean; reason?: string }[] }>(
      buildGhostScript("fill", { fields: fields.slice(0, 12) })
    );
    return { ok: true, report: r.report };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 200) };
  }
}

export async function ghostWaitForText(text: string, timeoutMs = 10_000): Promise<{ found: boolean; title?: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!session) return { found: false };
    try {
      const r = await ghostExecute<{ found: boolean; title: string }>(buildGhostScript("wait", { text }));
      if (r.found) return { found: true, title: r.title };
    } catch {
      /* page still navigating — retry until deadline */
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  return { found: false };
}
