// Quip MailWing — Email Engine
// ─────────────────────────────────────────────────────────────────────────────
// Real email for Quip: encrypted account vault (Electron safeStorage when the
// OS offers it), humanized compose through the model router (graceful fallback
// to the raw text), send via the zero-dependency SMTP client, and an outbox
// journal with honest status — "sent" ONLY after a 250 from the server.
//
// Storage (userData/mailwing/):
//   accounts.json — [{ id, label, smtpHost, smtpPort, secure, user, pass,
//                      fromEmail, fromName, isDefault, lastTest }]
//   outbox.json   — last 50 sends with status/detail/messageId
//
// Secrets: "enc1:<base64 safeStorage ciphertext>" or "plain:<base64 utf8>".
// The prefix is the truth about what is on disk — never hidden (CAP-089/078).
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";
import { smtpSend, buildMimeMessage, type SmtpResult, type MimeInput } from "./smtp-client";

// ─── Configuration (test-injectable base dir) ────────────────────────────────

let baseDir: string | null = null;

export function configureMailwing(userDataDir: string): void {
  baseDir = path.join(userDataDir, "mailwing");
  try {
    fs.mkdirSync(baseDir, { recursive: true });
  } catch {
    /* store loads fail soft — send/preview still work */
  }
}

function ensureBase(): string {
  if (!baseDir) throw new Error("MailWing not configured — configureMailwing(userDataDir) must run at boot");
  return baseDir;
}

// ─── Secret encoding (pure — unit-tested) ───────────────────────────────────

export function encodeSecretWith(mode: "safe" | "plain", secret: string): string {
  if (mode === "safe") {
    try {
      if (safeStorage && typeof safeStorage.isEncryptionAvailable === "function" && safeStorage.isEncryptionAvailable()) {
        return `enc1:${safeStorage.encryptString(secret).toString("base64")}`;
      }
    } catch {
      /* fall through to plain */
    }
  }
  return `plain:${Buffer.from(secret, "utf8").toString("base64")}`;
}

export function decodeSecretWith(stored: string): string {
  if (stored.startsWith("enc1:")) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.slice(5), "base64"));
    } catch {
      return ""; // vault-locked: honest empty — sends fail with a clear note
    }
  }
  if (stored.startsWith("plain:")) {
    return Buffer.from(stored.slice(6), "base64").toString("utf8");
  }
  return "";
}

export function secretIsEncrypted(stored: string): boolean {
  return stored.startsWith("enc1:");
}

// ─── Account vault ───────────────────────────────────────────────────────────

export interface MailAccount {
  id: string;
  label: string;
  smtpHost: string;
  smtpPort: number;
  secure: boolean;
  user: string;
  pass: string; // encoded — never logged, never returned raw
  fromEmail: string;
  fromName?: string;
  isDefault: boolean;
  createdAt: number;
  lastTestAt?: number;
  lastTestOk?: boolean;
}

interface VaultFile {
  version: 1;
  accounts: MailAccount[];
}

function accountsPath(): string {
  return path.join(ensureBase(), "accounts.json");
}

function loadVault(): VaultFile {
  try {
    const raw = fs.readFileSync(accountsPath(), "utf8");
    const parsed = JSON.parse(raw) as VaultFile;
    if (parsed && Array.isArray(parsed.accounts)) {
      return { version: 1, accounts: parsed.accounts.slice(0, 20) };
    }
  } catch {
    /* first run / corrupt file → fresh vault */
  }
  return { version: 1, accounts: [] };
}

function saveVault(vault: VaultFile): void {
  const tmp = `${accountsPath()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(vault, null, 2), "utf8");
  fs.renameSync(tmp, accountsPath());
}

export interface AddAccountInput {
  label: string;
  smtpHost: string;
  smtpPort: number;
  secure: boolean;
  user: string;
  pass: string;
  fromEmail?: string;
  fromName?: string;
  isDefault?: boolean;
}

/** Add/update an account by label. The password is encoded at rest. */
export function upsertAccount(input: AddAccountInput): { ok: boolean; accountId?: string; error?: string } {
  const label = (input.label ?? "").trim();
  const host = (input.smtpHost ?? "").trim();
  const user = (input.user ?? "").trim();
  const fromEmail = (input.fromEmail ?? user).trim();
  if (!label || !host || !user || !input.pass) {
    return { ok: false, error: "label, smtpHost, user and pass are all required" };
  }
  if (!fromEmail.includes("@")) {
    return { ok: false, error: "fromEmail must be a real email address" };
  }
  const vault = loadVault();
  const existing = vault.accounts.find((a) => a.label.toLowerCase() === label.toLowerCase());
  const id = existing?.id ?? `acct-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const account: MailAccount = {
    id,
    label,
    smtpHost: host,
    smtpPort: Math.max(1, Math.min(65535, Number(input.smtpPort) || 587)),
    secure: Boolean(input.secure),
    user,
    pass: encodeSecretWith("safe", input.pass),
    fromEmail,
    fromName: input.fromName?.trim() || undefined,
    isDefault: existing?.isDefault ?? Boolean(input.isDefault) ?? vault.accounts.length === 0,
    createdAt: existing?.createdAt ?? Date.now(),
    lastTestAt: existing?.lastTestAt,
    lastTestOk: existing?.lastTestOk,
  };
  if (existing) {
    vault.accounts[vault.accounts.indexOf(existing)] = account;
  } else {
    vault.accounts.push(account);
  }
  if (account.isDefault) {
    for (const a of vault.accounts) a.isDefault = a.id === id;
  }
  try {
    saveVault(vault);
    return { ok: true, accountId: id };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 200) };
  }
}

export function removeAccount(idOrLabel: string): { ok: boolean; removed?: string; error?: string } {
  const vault = loadVault();
  const idx = vault.accounts.findIndex(
    (a) => a.id === idOrLabel || a.label.toLowerCase() === idOrLabel.trim().toLowerCase()
  );
  if (idx === -1) return { ok: false, error: `no account "${idOrLabel}"` };
  const [removed] = vault.accounts.splice(idx, 1);
  if (removed.isDefault && vault.accounts.length > 0) vault.accounts[0].isDefault = true;
  try {
    saveVault(vault);
    return { ok: true, removed: removed.label };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 200) };
  }
}

/** List accounts WITHOUT secrets — only whether the stored password is encrypted. */
export function listAccounts(): (Omit<MailAccount, "pass"> & { passEncrypted: boolean })[] {
  return loadVault().accounts.map(({ pass, ...rest }) => ({
    ...rest,
    passEncrypted: secretIsEncrypted(pass),
  }));
}

export function resolveAccount(idOrLabel?: string): MailAccount | null {
  const vault = loadVault();
  if (idOrLabel) {
    const found = vault.accounts.find(
      (a) => a.id === idOrLabel || a.label.toLowerCase() === idOrLabel.trim().toLowerCase()
    );
    if (found) return found;
  }
  return vault.accounts.find((a) => a.isDefault) ?? vault.accounts[0] ?? null;
}

function setPassword(account: MailAccount, plain: string): void {
  account.pass = encodeSecretWith("safe", plain);
  const vault = loadVault();
  const idx = vault.accounts.findIndex((a) => a.id === account.id);
  if (idx !== -1) {
    vault.accounts[idx] = account;
    saveVault(vault);
  }
}

export interface AccountTestResult {
  ok: boolean;
  detail: string;
  tls?: boolean;
  auth?: string;
  stage?: string;
}

/**
 * Prove an account works: a real connection, real authentication, then QUIT
 * before MAIL FROM — nothing is sent. Uses a real SMTP conversation.
 */
export async function testAccount(idOrLabel?: string): Promise<AccountTestResult> {
  const account = resolveAccount(idOrLabel);
  if (!account) {
    return { ok: false, detail: "no MailWing account configured — add one in Settings → MailWing" };
  }
  const pass = decodeSecretWith(account.pass);
  if (!pass) {
    return { ok: false, detail: "the stored password could not be decrypted on this machine (vault locked to another OS user?)" };
  }
  try {
    // stopAt: "auth" — the session proves host + TLS + authentication, then
    // QUITs BEFORE MAIL FROM. Nothing is ever sent by a reachability test.
    const result = await smtpSend(
      {
        host: account.smtpHost,
        port: account.smtpPort,
        secure: account.secure,
        user: account.user,
        pass,
        from: account.fromEmail,
        to: [account.fromEmail],
        heloHost: "quip.local",
        timeoutMs: 20_000,
        stopAt: "auth",
      },
      {
        from: account.fromEmail,
        fromName: account.fromName,
        to: [account.fromEmail],
        subject: "MailWing reachability test (never sent)",
        text: "Quip verifies the SMTP session and quits before MAIL FROM — no mail leaves the machine.",
        date: new Date(),
        messageIdSeed: "reachability-test",
      }
    );
    const reachedAuth = result.ok && (result.stage === "auth" || result.stage === "mail");
    account.lastTestAt = Date.now();
    account.lastTestOk = reachedAuth;
    setPassword(account, pass); // re-encode + persist lastTest
    return {
      ok: reachedAuth,
      detail: reachedAuth
        ? `SMTP ${account.smtpHost}:${account.smtpPort} — TLS ${result.tls ? "yes" : "no"}, auth ${result.authUsed || "none"} — session verified, nothing sent`
        : `failed at "${result.stage}": ${result.reply ?? "no reply"}`,
      tls: result.tls,
      auth: result.authUsed || undefined,
      stage: result.stage,
    };
  } catch (e: any) {
    return { ok: false, detail: `connection failed: ${String(e?.message ?? e).slice(0, 200)}` };
  }
}

// ─── Humanized compose (LLM pass, graceful fallback) ─────────────────────────

export type MailTone = "professional" | "friendly" | "casual" | "formal";

const TONE_GUIDE: Record<MailTone, string> = {
  professional: "Clear, warm, workplace-ready. Short paragraphs, no corporate filler.",
  friendly: "Warm and human, like a good colleague. Light, direct, kind.",
  casual: "Relaxed and natural, like texting a friend — but still readable.",
  formal: "Respectful and precise. Full sentences, correct salutation and sign-off.",
};

export interface HumanizeInput {
  body: string;
  tone: MailTone;
  context?: string; // where the contact came from, what the user is replying to
  signature?: string;
  languageHint?: string;
}

export interface HumanizeResult {
  body: string;
  subject: string;
  humanized: boolean; // false = model unavailable, raw text used honestly
  note: string;
}

/**
 * Rewrite the user's rough notes into a sendable email. Facts are preserved;
 * nothing is invented; when the model fails the ORIGINAL text is used and
 * `humanized: false` says so. A failed humanizer must never block a send.
 */
export async function humanizeEmail(input: HumanizeInput): Promise<HumanizeResult> {
  const raw = (input.body ?? "").trim();
  if (!raw) {
    return { body: "", subject: "", humanized: false, note: "nothing to write — no body given" };
  }
  try {
    // Lazy import avoids a hard model-router dependency in unit tests.
    const { modelRouter } = await import("../system/model-router");
    const system = [
      "You draft the final version of a short email body from the user's rough notes.",
      `Tone: ${TONE_GUIDE[input.tone] ?? TONE_GUIDE.professional}`,
      "Rules:",
      "- Keep every fact, name, number and request from the notes. Invent NOTHING.",
      "- No subject line, no markdown, no placeholder brackets like [Name].",
      "- If the notes specify a greeting or sign-off, keep them; otherwise open and close naturally.",
      input.signature ? `- End with this signature on its own line: ${input.signature}` : "",
      input.context ? `- Context you should quietly respect: ${input.context.slice(0, 400)}` : "",
      input.languageHint ? `- Write in this language: ${input.languageHint}` : "",
      "Return ONLY the email body text.",
    ]
      .filter(Boolean)
      .join("\n");
    const out = await modelRouter.complete(system, [{ role: "user", content: raw.slice(0, 8000) }], 20_000);
    const body = out.trim().replace(/^["'`]+|["'`]+$/g, "").trim();
    if (body.length < 5) throw new Error("model returned an empty draft");
    const subject = await draftSubject(body, input);
    return { body, subject, humanized: true, note: `humanized (${input.tone})` };
  } catch (e: any) {
    return {
      body: raw,
      subject: firstLineAsSubject(raw),
      humanized: false,
      note: `used your text as-is — humanizer unavailable (${String(e?.message ?? e).slice(0, 120)})`,
    };
  }
}

async function draftSubject(body: string, input: HumanizeInput): Promise<string> {
  try {
    const { modelRouter } = await import("../system/model-router");
    const out = await modelRouter.complete(
      "Write ONE email subject line (max 8 words) for this body. Return only the subject, no quotes.",
      [{ role: "user", content: body.slice(0, 2000) }],
      10_000
    );
    const subject = out.trim().replace(/^["'`]+|["'`]+$/g, "").split("\n")[0].slice(0, 90);
    if (subject) return subject;
  } catch {
    /* fall through */
  }
  return firstLineAsSubject(input.body);
}

function firstLineAsSubject(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "Message from Quip";
  return line.trim().slice(0, 80);
}

// ─── Reply-chain awareness (CAP-022) ────────────────────────────────────────

export interface ReplyChain {
  isReply: boolean;
  isForward: boolean;
  /** Subject with Re:/Fwd: prefixes stripped. */
  cleaned: string;
}

/** Pure: detect Re:/Fwd: (any casing, repeated prefixes, Fw: too). */
export function parseReplyChain(subject: string): ReplyChain {
  let s = String(subject ?? "").trim();
  let isReply = false;
  let isForward = false;
  // Strip repeated prefixes like "Re: Re: Fwd:"
  for (;;) {
    const next = s.replace(/^(?:re|fw|fwd)\s*:\s*/i, "");
    if (next === s) break;
    if (/^re\s*:/i.test(s)) isReply = true;
    else isForward = true;
    s = next.trim();
  }
  return { isReply, isForward, cleaned: s };
}

/** Pure: the context line the humanizer gets for a reply — thread-aware tone. */
export function buildReplyContext(chain: ReplyChain, originalSubject?: string): string {
  if (chain.isReply) {
    return `This is a REPLY in the existing thread "${(originalSubject ?? chain.cleaned).slice(0, 120)}" — keep the continuity, reference the thread naturally, do not reintroduce yourself from scratch.`;
  }
  if (chain.isForward) {
    return `This is a FORWARD of "${chain.cleaned.slice(0, 120)}" — add a short human note on top, keep the forwarded facts intact.`;
  }
  return "";
}

// ─── Send pipeline ───────────────────────────────────────────────────────────

export interface SendMailInput {
  accountId?: string; // label or id; default account when omitted
  to: string[];
  cc?: string[];
  subject?: string;
  body: string;
  tone?: MailTone;
  humanize?: boolean;
  context?: string;
  languageHint?: string;
  html?: string;
  attachments?: { filename: string; contentType: string; base64: string }[];
}

export interface SendMailResult {
  ok: boolean;
  output: string;
  evidence: string[];
  status: "sent" | "failed" | "no-account";
  messageId?: string;
  smtp?: Pick<SmtpResult, "stage" | "code" | "reply" | "tls" | "authUsed">;
}

export function gmailComposeUrl(input: { to?: string; subject?: string; body?: string; cc?: string }): string {
  const params = new URLSearchParams();
  if (input.to) params.set("to", input.to);
  if (input.cc) params.set("cc", input.cc);
  if (input.subject) params.set("su", input.subject);
  if (input.body) params.set("body", input.body);
  return `https://mail.google.com/mail/?view=cm&fs=1&tf=1&${params.toString()}`;
}

/**
 * The real send. Retry ONCE on transient failure (connect/timeout), never on
 * a 5xx rejection — the server's word is final there. Every attempt is
 * journaled to the outbox with honest status.
 */
export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  // CAP-022: a subject that already carries Re:/Fwd: is thread continuity —
  // keep it verbatim and tell the humanizer to respect the thread.
  const chain = parseReplyChain(input.subject ?? "");
  const context = [input.context, buildReplyContext(chain, input.subject)].filter(Boolean).join(" ");
  const effectiveInput: SendMailInput = chain.isReply || chain.isForward ? { ...input, context } : input;
  const account = resolveAccount(effectiveInput.accountId);
  if (!account) {
    const detail = "no MailWing account is set up — add one in Settings → MailWing, or let me open a prefilled Gmail draft instead";
    journalOutbox({ status: "failed", accountId: null, to: input.to, subject: input.subject ?? "", detail });
    return { ok: false, output: detail, evidence: ["vault empty"], status: "no-account" };
  }
  const pass = decodeSecretWith(account.pass);
  if (!pass) {
    const detail = "the stored password could not be decrypted on this machine — re-enter it in Settings → MailWing";
    journalOutbox({ status: "failed", accountId: account.id, to: input.to, subject: input.subject ?? "", detail });
    return { ok: false, output: detail, evidence: ["vault-locked"], status: "failed" };
  }

  const mime: MimeInput = {
    from: account.fromEmail,
    fromName: account.fromName,
    to: input.to,
    cc: input.cc,
    subject: input.subject || "(no subject)",
    text: input.body,
    html: input.html,
    attachments: input.attachments,
  };
  const config = {
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.secure,
    user: account.user,
    pass,
    from: account.fromEmail,
    to: input.to,
    cc: input.cc,
    heloHost: "quip.local",
    timeoutMs: 30_000,
  };

  let result: SmtpResult | null = null;
  let attempts = 0;
  for (attempts = 1; attempts <= 2; attempts++) {
    try {
      result = await smtpSend(config, mime);
    } catch (e: any) {
      // Connection-level failure (refused / DNS / TLS): normalized to an
      // honest SmtpResult so the retry loop and journal see one shape.
      result = {
        ok: false,
        stage: "greeting",
        reply: String(e?.message ?? e).slice(0, 300),
        tls: Boolean(config.secure),
        authUsed: false,
      };
    }
    if (result.ok) break;
    const transient = result.stage === "greeting" || result.stage === "starttls" || (result.reply ?? "").includes("timed out");
    if (!transient || attempts === 2) break;
    await new Promise((r) => setTimeout(r, 1500)); // bounded backoff
  }

  const ok = Boolean(result?.ok);
  const detail = ok
    ? `Sent to ${input.to.join(", ")} via ${account.smtpHost} (TLS ${result!.tls ? "on" : "off"}).`
    : `Send failed at "${result!.stage}" — the server said: ${result!.reply ?? "nothing"}`;

  journalOutbox({
    status: ok ? "sent" : "failed",
    accountId: account.id,
    to: input.to,
    subject: mime.subject,
    detail,
    messageId: result?.messageId,
  });

  return {
    ok,
    output: detail,
    evidence: [
      `${account.smtpHost}:${account.smtpPort}${account.secure ? " (implicit TLS)" : ""}`,
      `stage: ${result!.stage}`, `code: ${result!.code ?? -1}`, `attempt: ${attempts}`,
    ],
    status: ok ? "sent" : "failed",
    messageId: result?.messageId,
    smtp: result
      ? { stage: result.stage, code: result.code, reply: result.reply, tls: result.tls, authUsed: result.authUsed }
      : undefined,
  };
}

// ─── Outbox journal ──────────────────────────────────────────────────────────

export interface OutboxEntry {
  id: string;
  ts: number;
  status: "sent" | "failed";
  accountId: string | null;
  to: string[];
  subject: string;
  detail: string;
  messageId?: string;
}

const OUTBOX_CAP = 50;

function outboxPath(): string {
  return path.join(ensureBase(), "outbox.json");
}

function journalOutbox(entry: Omit<OutboxEntry, "id" | "ts">): void {
  try {
    const list = readOutbox();
    list.unshift({ id: `out-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, ts: Date.now(), ...entry });
    fs.writeFileSync(outboxPath(), JSON.stringify(list.slice(0, OUTBOX_CAP), null, 2), "utf8");
  } catch {
    /* journaling must never break the send result */
  }
}

export function readOutbox(): OutboxEntry[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(outboxPath(), "utf8")) as OutboxEntry[];
    return Array.isArray(parsed) ? parsed.slice(0, OUTBOX_CAP) : [];
  } catch {
    return [];
  }
}

/** Redact everything secret-shaped before anything reaches a log/UI (CAP-078). */
export function digestOutboxForLog(entries: OutboxEntry[]): string[] {
  return entries.map((e) => `${new Date(e.ts).toISOString()} ${e.status} → ${e.to.join(",")} "${e.subject.slice(0, 40)}"`);
}
