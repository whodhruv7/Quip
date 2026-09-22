// Quip MailWing — Zero-dependency SMTP client
// ─────────────────────────────────────────────────────────────────────────────
// A real SMTP client on raw Node sockets (net/tls) — no npm deps, fully
// unit-testable: the protocol loop (runSmtpSession) speaks to an injected
// SmtpIO, so tests script the server side byte-for-byte. The production IO
// (createSocketIO) wraps net/tls with a line-based reply parser.
//
// Flow: 220 greeting → EHLO → [STARTTLS] → EHLO → [AUTH PLAIN|LOGIN] →
//       MAIL FROM → RCPT TO… → DATA → message (dot-stuffed) → QUIT
// "Sent" is claimed ONLY when the final DATA reply is 250 (CAP-024).
// ─────────────────────────────────────────────────────────────────────────────

import net from "node:net";
import tls from "node:tls";

// ─── Pure helpers (unit-tested) ──────────────────────────────────────────────

/** RFC 2047 encoded-word for non-ASCII header values (base64, folded). */
export function encodeHeaderValue(value: string): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  // Printable ASCII (space through tilde) needs no encoding.
  if (/^[\x20-\x7e]*$/.test(v)) return v.replace(/([\r\n]+)/g, " ");
  const bytes = Buffer.from(v, "utf8");
  const chunks = splitUtf8ForBase64(bytes, 24);
  return chunks
    .map((c) => `=?utf-8?B?${Buffer.from(c).toString("base64")}?=`)
    .join("\r\n ");
}

/** Split a UTF-8 buffer into chunks that never cut a code point. */
export function splitUtf8ForBase64(bytes: Buffer, maxBytes: number): Buffer[] {
  const out: Buffer[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + maxBytes, bytes.length);
    // Never end inside a multi-byte sequence: back up over continuation bytes.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    if (end <= start) end = Math.min(start + 1, bytes.length);
    out.push(bytes.subarray(start, end));
    start = end;
  }
  return out;
}

/** SMTP dot-stuffing: every line starting with "." gets another ".". */
export function dotStuff(data: string): string {
  return data
    .split(/\r?\n/)
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}

/** Message-ID safe token from arbitrary text. */
function idToken(s: string): string {
  return s.replace(/[^a-z0-9.-]/gi, "").slice(0, 40) || "local";
}

export interface MimeInput {
  from: string;
  fromName?: string;
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; contentType: string; base64: string }[];
  date?: Date; // injectable for tests
  messageIdSeed?: string;
}

export interface MimeResult {
  data: string;
  messageId: string;
}

/** Build a complete RFC 5322 message (multipart when html/attachments exist). */
export function buildMimeMessage(input: MimeInput): MimeResult {
  const date = input.date ?? new Date();
  const seed = input.messageIdSeed ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const host = idToken(input.from.split("@")[1] ?? "quip.local");
  const messageId = `<quip-${seed}@${host}>`;
  const fromHeader = input.fromName
    ? `${encodeHeaderValue(input.fromName)} <${input.from}>`
    : input.from;

  const headers: string[] = [
    `From: ${fromHeader}`,
    `To: ${input.to.join(", ")}`,
    ...(input.cc?.length ? [`Cc: ${input.cc.join(", ")}`] : []),
    `Subject: ${encodeHeaderValue(input.subject)}`,
    `Date: ${date.toUTCString().replace(/GMT$/, "+0000")}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
  ];

  const hasHtml = Boolean(input.html);
  const hasAtt = Boolean(input.attachments?.length);
  const boundary = `=_quip_${seed}`;

  if (!hasHtml && !hasAtt) {
    headers.push(
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: base64"
    );
    const data = `${headers.join("\r\n")}\r\n\r\n${chunk64(input.text)}`;
    return { data, messageId };
  }

  // Mixed (attachments) containing alternative (text/html) or a single part.
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const altBoundary = `=_quip_alt_${seed}`;
  const bodyParts: string[] = [];

  if (hasHtml) {
    bodyParts.push(
      `--${altBoundary}`,
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: base64",
      "",
      chunk64(input.text),
      `--${altBoundary}`,
      'Content-Type: text/html; charset="utf-8"',
      "Content-Transfer-Encoding: base64",
      "",
      chunk64(input.html!)
    );
    bodyParts.push(`--${altBoundary}--`);
    const altBlock = [
      `--${boundary}`,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      "",
      ...bodyParts,
    ];
    bodyParts.length = 0;
    bodyParts.push(...altBlock);
  } else {
    bodyParts.push(
      `--${boundary}`,
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: base64",
      "",
      chunk64(input.text)
    );
  }

  for (const att of input.attachments ?? []) {
    bodyParts.push(
      `--${boundary}`,
      `Content-Type: ${att.contentType}; name="${sanitizeFilename(att.filename)}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${sanitizeFilename(att.filename)}"`,
      "",
      att.base64.replace(/(.{76})/g, "$1\r\n").replace(/\r\n$/, "")
    );
  }
  bodyParts.push(`--${boundary}--`);

  const data = `${headers.join("\r\n")}\r\n\r\n${bodyParts.join("\r\n")}`;
  return { data, messageId };
}

function sanitizeFilename(name: string): string {
  return (name ?? "attachment").replace(/[\r\n"\\]/g, "_").slice(0, 120);
}

/** UTF-8 body → base64 with CRLF folding at 76 chars. */
export function chunk64(text: string): string {
  return Buffer.from(text, "utf8")
    .toString("base64")
    .replace(/(.{76})/g, "$1\r\n")
    .replace(/\r\n$/, "");
}

// ─── Reply parsing (line-based) ──────────────────────────────────────────────

export interface SmtpReply {
  code: number;
  lines: string[];
  text: string;
}

/**
 * Parse a complete reply out of a buffer, returning the reply and the number
 * of characters consumed. A reply is complete when a line matches
 * /^\d{3} / (code + space) instead of /^\d{3}-/.
 */
export function takeReply(buffer: string): { reply: SmtpReply | null; consumed: number } {
  const lines = buffer.split(/\r?\n/);
  let consumedChars = 0;
  const replyLines: string[] = [];
  for (const line of lines) {
    if (line === "") break;
    const m = line.match(/^(\d{3})([ -])(.*)$/);
    if (!m) {
      if (replyLines.length === 0) {
        // Garbage before the first reply line — skip it.
        consumedChars += line.length + 2;
        continue;
      }
      break; // continuation without code — stop conservatively
    }
    replyLines.push(m[3]);
    consumedChars += line.length + 2;
    if (m[2] === " ") {
      const code = parseInt(m[1], 10);
      return {
        reply: { code, lines: replyLines, text: replyLines.join(" | ") },
        consumed: consumedChars,
      };
    }
  }
  return { reply: null, consumed: 0 };
}

// ─── The IO boundary (injected — this is what tests script) ─────────────────

export interface SmtpIO {
  readReply(): Promise<SmtpReply>;
  send(line: string): Promise<void>;
  upgradeTLS(servername: string): Promise<void>;
  end(): void;
}

export interface SmtpConfig {
  host: string;
  port: number;
  /** true = implicit TLS (465). false/undefined = plain + STARTTLS (587/25). */
  secure?: boolean;
  user?: string;
  pass?: string;
  from: string;
  to: string[];
  cc?: string[];
  heloHost?: string;
  timeoutMs?: number;
  /** Verify-only sessions: stop cleanly after the given stage and QUIT.
   *  "auth" = prove host+TLS+auth, then quit before MAIL FROM (nothing sent).
   *  "mail" = also pass MAIL FROM (still nothing sent — RCPT never runs). */
  stopAt?: "auth" | "mail";
}

export type SmtpStage =
  | "greeting" | "ehlo" | "starttls" | "auth" | "mail" | "rcpt" | "data" | "sent" | "quit";

export interface SmtpResult {
  ok: boolean;
  stage: SmtpStage;
  code?: number;
  reply?: string;
  messageId?: string;
  tls: boolean;
  authUsed: "plain" | "login" | false;
}

const POSITIVE = [250, 251] as const;

function isPositive(code: number): boolean {
  return (POSITIVE as readonly number[]).includes(code);
}

/** Parse EHLO capability lines into a set (lowercased keywords).
 *  AUTH lines carry their mechanisms on the same line ("AUTH PLAIN LOGIN"),
 *  so each mechanism is registered too — that's how the client picks PLAIN
 *  vs LOGIN and never sends a mechanism the server refused. */
export function parseEhloCapabilities(lines: string[]): Set<string> {
  const caps = new Set<string>();
  for (const line of lines) {
    const tokens = line.toUpperCase().split(/\s+/).filter(Boolean);
    if (tokens[0]) caps.add(tokens[0]);
    if (tokens[0] === "AUTH") {
      for (const mech of tokens.slice(1)) caps.add(mech);
    }
  }
  return caps;
}

/**
 * The protocol state machine. Talks ONLY through the injected IO.
 * Every failure carries the exact stage + server reply — never a vague error.
 */
export async function runSmtpSession(
  io: SmtpIO,
  config: SmtpConfig,
  message: MimeInput
): Promise<SmtpResult> {
  const helo = config.heloHost || "quip.local";
  const timeoutMs = config.timeoutMs ?? 30_000;
  let tlsUp = false;
  let authUsed: SmtpResult["authUsed"] = false;

  const deadline = Date.now() + timeoutMs;
  const checkTime = (stage: SmtpStage): void => {
    if (Date.now() > deadline) {
      throw new SmtpError(`SMTP timed out after ${timeoutMs}ms at stage: ${stage}`, stage, undefined, `timeout after ${timeoutMs}ms`);
    }
  };

  try {
    // ── greeting ──
    let reply = await io.readReply();
    if (reply.code !== 220) {
      return fail("greeting", reply, tlsUp, authUsed);
    }

    // ── EHLO (plain) ──
    checkTime("ehlo");
    await io.send(`EHLO ${helo}`);
    reply = await io.readReply();
    if (reply.code !== 250) {
      return fail("ehlo", reply, tlsUp, authUsed);
    }
    let caps = parseEhloCapabilities(reply.lines);

    // ── STARTTLS (only when advertised + not already implicit-TLS) ──
    if (!config.secure && caps.has("STARTTLS")) {
      checkTime("starttls");
      await io.send("STARTTLS");
      reply = await io.readReply();
      if (reply.code !== 220) {
        return fail("starttls", reply, tlsUp, authUsed);
      }
      await io.upgradeTLS(config.host);
      tlsUp = true;
      // EHLO again inside TLS — required by RFC 3207.
      await io.send(`EHLO ${helo}`);
      reply = await io.readReply();
      if (reply.code !== 250) {
        return fail("ehlo", reply, tlsUp, authUsed);
      }
      caps = parseEhloCapabilities(reply.lines);
    } else if (config.secure) {
      tlsUp = true;
    }

    // ── AUTH ──
    if (config.user && config.pass) {
      checkTime("auth");
      if (caps.has("AUTH") || caps.has("PLAIN") || caps.has("LOGIN")) {
        const authRes = await authenticate(io, config.user, config.pass, caps);
        if (!authRes.ok) {
          return { ok: false, stage: "auth", code: authRes.code, reply: authRes.reply, tls: tlsUp, authUsed };
        }
        authUsed = authRes.via;
      }
      // Server with no AUTH extension + no way to authenticate → proceed
      // anonymously (e.g. internal relays); if it refuses MAIL FROM we stop there.
    }

    // ── stopAt: "auth" — a reachability probe quits BEFORE anything is sent ──
    if (config.stopAt === "auth") {
      try {
        await io.send("QUIT");
        await io.readReply();
      } catch {
        /* server may close first */
      }
      return { ok: true, stage: "auth", code: 235, reply: "session verified through authentication", tls: tlsUp, authUsed };
    }

    // ── MAIL FROM ──
    checkTime("mail");
    await io.send(`MAIL FROM:<${config.from}>`);
    reply = await io.readReply();
    if (!isPositive(reply.code)) {
      return fail("mail", reply, tlsUp, authUsed);
    }

    if (config.stopAt === "mail") {
      try {
        await io.send("QUIT");
        await io.readReply();
      } catch {
        /* server may close first */
      }
      return { ok: true, stage: "mail", code: reply.code, reply: "session verified through MAIL FROM", tls: tlsUp, authUsed };
    }

    // ── RCPT TO (every recipient must be accepted) ──
    const allRecipients = [...config.to, ...(config.cc ?? [])];
    for (const rcpt of allRecipients) {
      checkTime("rcpt");
      await io.send(`RCPT TO:<${rcpt.trim()}>`);
      reply = await io.readReply();
      if (!isPositive(reply.code) && reply.code !== 251) {
        return { ok: false, stage: "rcpt", code: reply.code, reply: `${rcpt}: ${reply.text}`, tls: tlsUp, authUsed };
      }
    }

    // ── DATA ──
    checkTime("data");
    await io.send("DATA");
    reply = await io.readReply();
    if (reply.code !== 354) {
      return fail("data", reply, tlsUp, authUsed);
    }

    const mime = buildMimeMessage(message);
    await io.send(`${dotStuff(mime.data)}\r\n.`);
    reply = await io.readReply();
    if (reply.code !== 250) {
      return fail("data", reply, tlsUp, authUsed);
    }

    // ── QUIT (best effort) ──
    try {
      await io.send("QUIT");
      await io.readReply();
    } catch {
      /* some servers close first — the send already succeeded */
    }
    return { ok: true, stage: "sent", code: reply.code, reply: reply.text, messageId: mime.messageId, tls: tlsUp, authUsed };
  } catch (e: any) {
    if (e instanceof SmtpError) {
      return { ok: false, stage: e.stage, reply: e.detail, tls: tlsUp, authUsed };
    }
    return { ok: false, stage: "greeting", reply: String(e?.message ?? e).slice(0, 300), tls: tlsUp, authUsed };
  }

  function fail(stage: SmtpStage, reply: SmtpReply, tlsFlag: boolean, auth: SmtpResult["authUsed"]): SmtpResult {
    return { ok: false, stage, code: reply.code, reply: reply.text, tls: tlsFlag, authUsed: auth };
  }
}

export class SmtpError extends Error {
  constructor(
    message: string,
    readonly stage: SmtpStage,
    readonly code: number | undefined,
    readonly detail: string
  ) {
    super(message);
    this.name = "SmtpError";
  }
}

interface AuthOutcome {
  ok: boolean;
  via: "plain" | "login";
  code?: number;
  reply?: string;
}

/** AUTH PLAIN with initial response, falling back to AUTH LOGIN. */
export async function authenticate(
  io: SmtpIO,
  user: string,
  pass: string,
  caps: Set<string>
): Promise<AuthOutcome> {
  const preferLogin = caps.has("LOGIN") && !caps.has("PLAIN");
  if (!preferLogin) {
    const initial = Buffer.from(`\u0000${user}\u0000${pass}`, "utf8").toString("base64");
    await io.send(`AUTH PLAIN ${initial}`);
    let r = await io.readReply();
    if (r.code === 235) return { ok: true, via: "plain" };
    if (r.code === 334) {
      // Some servers demand the initial response in a second round.
      await io.send(initial);
      r = await io.readReply();
      if (r.code === 235) return { ok: true, via: "plain" };
    }
    if (caps.has("LOGIN")) {
      return loginFlow(io, user, pass, r);
    }
    return { ok: false, via: "plain", code: r.code, reply: r.text };
  }
  return loginFlow(io, user, pass);
}

async function loginFlow(io: SmtpIO, user: string, pass: string, prev?: SmtpReply): Promise<AuthOutcome> {
  await io.send("AUTH LOGIN");
  let r = prev && prev.code === 334 ? prev : await io.readReply();
  if (r.code !== 334) return { ok: false, via: "login", code: r.code, reply: r.text };
  await io.send(Buffer.from(user, "utf8").toString("base64"));
  r = await io.readReply();
  if (r.code !== 334) return { ok: false, via: "login", code: r.code, reply: r.text };
  await io.send(Buffer.from(pass, "utf8").toString("base64"));
  r = await io.readReply();
  if (r.code === 235) return { ok: true, via: "login" };
  return { ok: false, via: "login", code: r.code, reply: r.text };
}

// ─── Production IO over real sockets ─────────────────────────────────────────

class SocketIO implements SmtpIO {
  private buffer = "";
  private socket: net.Socket;
  private pending: ((r: SmtpReply) => void) | null = null;
  private closed = false;
  private timer: NodeJS.Timeout;

  constructor(
    socket: net.Socket,
    private timeoutMs: number,
    private rejectConnect: (e: Error) => void
  ) {
    this.socket = socket;
    this.timer = setTimeout(() => this.onTimeout(), timeoutMs);
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.tryParse();
    });
    socket.on("error", (e: Error) => {
      this.rejectConnect(e);
      this.failPending(`socket error: ${e.message}`);
    });
    socket.on("close", () => {
      this.closed = true;
      this.failPending("connection closed by server");
    });
  }

  private failPending(reason: string): void {
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      p({ code: -1, lines: [reason], text: reason });
    }
  }

  private onTimeout(): void {
    this.failPending(`timed out after ${this.timeoutMs}ms`);
    try {
      this.socket.destroy();
    } catch {
      /* already gone */
    }
  }

  private tryParse(): void {
    if (!this.pending) return;
    const { reply, consumed } = takeReply(this.buffer);
    if (reply) {
      this.buffer = this.buffer.slice(consumed);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.onTimeout(), this.timeoutMs);
      const p = this.pending;
      this.pending = null;
      p(reply);
    }
  }

  async readReply(): Promise<SmtpReply> {
    if (this.closed) return { code: -1, lines: ["connection closed"], text: "connection closed" };
    const existing = takeReply(this.buffer);
    if (existing.reply) {
      this.buffer = this.buffer.slice(existing.consumed);
      return existing.reply;
    }
    return new Promise<SmtpReply>((resolve) => {
      this.pending = resolve;
      this.tryParse();
    });
  }

  async send(line: string): Promise<void> {
    if (this.closed) throw new SmtpError("connection closed", "greeting", undefined, "socket closed");
    await new Promise<void>((resolve, reject) => {
      this.socket.write(`${line}\r\n`, (err) => (err ? reject(err) : resolve()));
    });
  }

  async upgradeTLS(servername: string): Promise<void> {
    this.socket.removeAllListeners("data");
    this.socket.removeAllListeners("error");
    this.socket.removeAllListeners("close");
    clearTimeout(this.timer);
    const upgraded: tls.TLSSocket = await new Promise((resolve, reject) => {
      const t = tls.connect(
        { socket: this.socket, servername, rejectUnauthorized: false },
        () => resolve(t)
      );
      t.once("error", reject);
    });
    this.socket = upgraded;
    this.buffer = "";
    this.socket.setEncoding("utf8");
    this.socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.tryParse();
    });
    this.socket.on("error", (e: Error) => this.failPending(`socket error: ${e.message}`));
    this.socket.on("close", () => {
      this.closed = true;
      this.failPending("connection closed by server");
    });
    this.timer = setTimeout(() => this.onTimeout(), this.timeoutMs);
  }

  end(): void {
    clearTimeout(this.timer);
    try {
      this.socket.end();
    } catch {
      /* already gone */
    }
  }
}

/** Open a real connection and return the IO for runSmtpSession. */
export function createSocketIO(config: SmtpConfig): Promise<SmtpIO> {
  const timeoutMs = config.timeoutMs ?? 30_000;
  return new Promise<SmtpIO>((resolve, reject) => {
    let settled = false;
    const rejectConnect = (e: Error) => {
      if (!settled) {
        settled = true;
        reject(e);
      }
    };
    const socket = config.secure
      ? tls.connect({ host: config.host, port: config.port, servername: config.host, rejectUnauthorized: false })
      : net.connect({ host: config.host, port: config.port });
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      rejectConnect(new Error(`connect timed out after ${timeoutMs}ms`));
    });
    socket.once(config.secure ? "secureConnect" : "connect", () => {
      if (settled) return;
      settled = true;
      socket.setTimeout(0);
      resolve(new SocketIO(socket, timeoutMs, rejectConnect));
    });
    socket.once("error", rejectConnect);
  });
}

/** One-call send: connect → session → close. Returns the SmtpResult verbatim. */
export async function smtpSend(config: SmtpConfig, message: MimeInput): Promise<SmtpResult> {
  const io = await createSocketIO(config);
  try {
    return await runSmtpSession(io, config, message);
  } finally {
    io.end();
  }
}
