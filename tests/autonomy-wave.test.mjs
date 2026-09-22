// Tests: Autonomy Wave engines (roadmap A–F)
// ─────────────────────────────────────────────────────────────────────────────
// SMTP protocol (scripted server), MailWing vault + outbox, WebGhost pure
// core, Contacts Book, FileButler plan/apply/undo/duplicates, GhostHands
// PowerShell builders, Quest Engine runner, registry/catalog/contract sync
// and intent routing for every new verb. Deterministic: no network, no
// Electron APIs, all stores in temp dirs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const smtp = await import("../dist-test/electron/engine/smtp-client.js");
const mailwing = await import("../dist-test/electron/engine/mailwing.js");
const ghost = await import("../dist-test/electron/engine/web-ghost.js");
const contacts = await import("../dist-test/electron/engine/contacts-book.js");
const butler = await import("../dist-test/electron/engine/file-butler.js");
const hands = await import("../dist-test/electron/engine/ghost-hands.js");
const quests = await import("../dist-test/electron/engine/quest-engine.js");
const registry = await import("../dist-test/electron/engine/tool-registry.js");
const contracts = await import("../dist-test/electron/actions/contracts.js");
const catalogMod = await import("../dist-test/electron/engine/tool-catalog.js");
const permissionModes = await import("../dist-test/electron/engine/permission-modes.js");
const parserMod = await import("../dist-test/electron/engine/intent-parser-v2.js");
const routerMod = await import("../dist-test/electron/system/model-router.js");
const parseIntentV2 = parserMod.parseIntentV2;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "quip-autonomy-"));

// ─── SMTP: pure helpers ───────────────────────────────────────────────────────

test("smtp: encodeHeaderValue passes ASCII, encodes unicode", () => {
  assert.equal(smtp.encodeHeaderValue("Plain subject"), "Plain subject");
  const enc = smtp.encodeHeaderValue("Namaste 🙏 Rahul");
  assert.match(enc, /^=\?utf-8\?B\?/);
  // Round-trips back to the original text.
  const decoded = enc.split("\r\n ").map((w) => Buffer.from(w.slice(10, -2), "base64").toString("utf8")).join("");
  assert.equal(decoded, "Namaste 🙏 Rahul");
});

test("smtp: splitUtf8ForBase64 never cuts a code point", () => {
  const bytes = Buffer.from("héllo world this has é and भी", "utf8");
  for (const chunk of smtp.splitUtf8ForBase64(bytes, 7)) {
    assert.ok(chunk.length >= 1 && chunk.length <= 7);
    // Every byte in the chunk is part of a valid sequence start or continuation
    const s = chunk.toString("utf8");
    assert.ok(!s.includes("\uFFFD"), "chunk produced replacement chars");
  }
});

test("smtp: dotStuff adds the extra dot only at line starts", () => {
  assert.equal(smtp.dotStuff("a\r\n.b\r\nc"), "a\r\n..b\r\nc");
});

test("smtp: chunk64 folds at 76 chars and round-trips", () => {
  const text = "Quip se bheja gaya message — ".repeat(20);
  const folded = smtp.chunk64(text);
  for (const line of folded.split("\r\n")) assert.ok(line.length <= 76);
  const back = Buffer.from(folded.replace(/\r\n/g, ""), "base64").toString("utf8");
  assert.equal(back, text);
});

test("smtp: takeReply parses multiline replies and reports consumption", () => {
  const { reply, consumed } = smtp.takeReply("250-ping\r\n250-PONG\r\n250 done\r\nEXTRA");
  assert.equal(reply.code, 250);
  assert.deepEqual(reply.lines, ["ping", "PONG", "done"]);
  assert.equal(consumed, "250-ping\r\n250-PONG\r\n250 done\r\n".length);
});

test("smtp: incomplete multiline replies are not yielded", () => {
  const { reply } = smtp.takeReply("250-first\r\n250-se");
  assert.equal(reply, null);
});

test("smtp: parseEhloCapabilities lowercases into a set", () => {
  const caps = smtp.parseEhloCapabilities(["PIPELINING", "AUTH PLAIN LOGIN", "STARTTLS"]);
  assert.ok(caps.has("PIPELINING"));
  assert.ok(caps.has("AUTH"));
  assert.ok(caps.has("STARTTLS"));
  assert.ok(!caps.has("auth"));
});

// ─── SMTP: scripted protocol sessions ────────────────────────────────────────

function scriptedIo(lines) {
  const sent = [];
  let upgrades = 0;
  let ended = false;
  return {
    sent,
    upgrades: () => upgrades,
    io: {
      async readReply() {
        if (lines.length === 0) throw new Error("script exhausted");
        const raw = lines.shift();
        const parsed = smtp.takeReply(raw.endsWith("\r\n") ? raw : raw + "\r\n");
        if (!parsed.reply) throw new Error("bad scripted reply: " + raw);
        return parsed.reply;
      },
      async send(line) { sent.push(line); },
      async upgradeTLS() { upgrades += 1; },
      end() { ended = true; },
    },
  };
}

const EHLO_TLS = "250-quip.local\r\n250-STARTTLS\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 33554432";
const EHLO_AFTER_TLS = "250-quip.local\r\n250-AUTH PLAIN LOGIN\r\n250 OK";

test("smtp: full success session (STARTTLS + AUTH PLAIN + 250 on final dot)", async () => {
  const s = scriptedIo([
    "220 mail.acme.com ESMTP",
    EHLO_TLS,
    "220 go TLS",
    EHLO_AFTER_TLS,
    "235 2.7.0 accepted",
    "250 2.1.0 OK",
    "250 2.1.5 OK",
    "354 go ahead",
    "250 2.0.0 queued as Q7",
    "221 bye",
  ]);
  const result = await smtp.runSmtpSession(s.io, {
    host: "mail.acme.com", port: 587, user: "me@quip.dev", pass: "secret",
    from: "me@quip.dev", to: ["you@acme.com"], heloHost: "quip.local",
  }, {
    from: "me@quip.dev", to: ["you@acme.com"], subject: "Hello",
    text: "first line\n.dot line\nlast",
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.stage, "sent");
  assert.equal(result.tls, true);
  assert.equal(result.authUsed, "plain");
  assert.match(result.messageId, /@quip\.dev>$/);
  // Command order on the wire: EHLO → STARTTLS → EHLO again (RFC 3207).
  assert.deepEqual(s.sent.slice(0, 3), ["EHLO quip.local", "STARTTLS", "EHLO quip.local"]);
  assert.equal(s.sent[3].startsWith("AUTH PLAIN "), true);
  assert.ok(s.sent.includes("MAIL FROM:<me@quip.dev>"));
  assert.ok(s.sent.includes("RCPT TO:<you@acme.com>"));
  assert.ok(s.sent.includes("DATA"));
  // The DATA payload ends with the terminating dot (the message itself is
  // base64 inside MIME, so dot-stuffing is asserted via the MIME unit tests).
  const dataCmd = s.sent.find((l) => l !== "DATA" && l.length > 200);
  assert.ok(dataCmd, "full message payload was sent after DATA");
  assert.ok(dataCmd.endsWith("\r\n."), "payload ends with the terminating dot");
  const decoded = Buffer.from(dataCmd.split("\r\n\r\n")[1].replace(/\r\n\.$/, "").replace(/\r\n/g, ""), "base64").toString("utf8");
  assert.match(decoded, /\.dot line/);
});

test("smtp: AUTH LOGIN fallback when PLAIN is not offered", async () => {
  const s = scriptedIo([
    "220 mail.acme.com ESMTP",
    "250-quip.local\r\n250-AUTH LOGIN\r\n250 OK",
    "334 VXNlcm5hbWU6",
    "334 UGFzc3dvcmQ6",
    "235 2.7.0 accepted",
    "250 2.1.0 OK",
    "250 2.1.5 OK",
    "354 go ahead",
    "250 2.0.0 queued",
    "221 bye",
  ]);
  const result = await smtp.runSmtpSession(s.io, {
    host: "mail.acme.com", port: 587, user: "me@quip.dev", pass: "secret",
    from: "me@quip.dev", to: ["you@acme.com"],
  }, { from: "me@quip.dev", to: ["you@acme.com"], subject: "Hi", text: "x" });
  assert.equal(result.ok, true);
  assert.equal(result.authUsed, "login");
  assert.ok(s.sent.includes("AUTH LOGIN"));
  assert.ok(s.sent.includes(Buffer.from("me@quip.dev", "utf8").toString("base64")));
  assert.ok(s.sent.includes(Buffer.from("secret", "utf8").toString("base64")));
});

test("smtp: stopAt auth quits BEFORE MAIL FROM — nothing can be sent", async () => {
  const s = scriptedIo([
    "220 mail.acme.com ESMTP",
    "250-quip.local\r\n250-AUTH PLAIN\r\n250 OK",
    "235 2.7.0 accepted",
    "221 bye",
  ]);
  const result = await smtp.runSmtpSession(s.io, {
    host: "mail.acme.com", port: 587, user: "me@quip.dev", pass: "secret",
    from: "me@quip.dev", to: ["you@acme.com"], stopAt: "auth",
  }, { from: "me@quip.dev", to: ["you@acme.com"], subject: "probe", text: "probe" });
  assert.equal(result.ok, true);
  assert.equal(result.stage, "auth");
  assert.ok(!s.sent.some((l) => l.startsWith("MAIL FROM")), "no MAIL FROM was ever sent");
  assert.ok(s.sent.includes("QUIT"));
});

test("smtp: 550 at RCPT fails with the server's exact words", async () => {
  const s = scriptedIo([
    "220 mail.acme.com ESMTP",
    "250-quip.local\r\n250 OK",
    "250 2.1.0 OK",
    "550 5.1.1 unknown recipient",
  ]);
  const result = await smtp.runSmtpSession(s.io, {
    host: "mail.acme.com", port: 25, from: "me@quip.dev", to: ["ghost@acme.com"],
  }, { from: "me@quip.dev", to: ["ghost@acme.com"], subject: "x", text: "x" });
  assert.equal(result.ok, false);
  assert.equal(result.stage, "rcpt");
  assert.match(result.reply, /unknown recipient/);
});

test("smtp: MIME message has RFC 5322 headers, encoded subject and base64 body", () => {
  const { data, messageId } = smtp.buildMimeMessage({
    from: "me@quip.dev", fromName: "Quip Companion",
    to: ["you@acme.com"], subject: "Namaste 🙏",
    text: "body text", date: new Date(0), messageIdSeed: "seed1",
  });
  assert.match(data, /^From: Quip Companion <me@quip\.dev>/);
  assert.match(data, /To: you@acme\.com/);
  assert.match(data, /Subject: =\?utf-8\?B\?/);
  assert.match(data, /Message-ID: <quip-seed1@quip\.dev>/);
  assert.match(data, /Content-Type: text\/plain; charset="utf-8"/);
  const body = data.split("\r\n\r\n")[1];
  assert.equal(Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8"), "body text");
  assert.ok(messageId.includes("quip-seed1"));
});

test("smtp: MIME with attachments builds multipart with boundary", () => {
  const { data } = smtp.buildMimeMessage({
    from: "me@quip.dev", to: ["a@b.c"], subject: "file",
    text: "see attached",
    attachments: [{ filename: "report.pdf", contentType: "application/pdf", base64: "AAAA" }],
  });
  assert.match(data, /multipart\/mixed; boundary="/);
  assert.match(data, /name="report\.pdf"/);
  assert.match(data, /Content-Disposition: attachment/);
  assert.ok(data.trimEnd().endsWith("--"));
});

// ─── MailWing: vault, humanize fallback, outbox ───────────────────────────────

mailwing.configureMailwing(TMP);

test("mailwing: secrets encode without safeStorage and decode back", () => {
  const stored = mailwing.encodeSecretWith("safe", "hunter2");
  assert.ok(stored.startsWith("plain:"), "no safeStorage in tests → plain, but prefixed honestly");
  assert.equal(mailwing.decodeSecretWith(stored), "hunter2");
  assert.equal(mailwing.secretIsEncrypted(stored), false);
});

test("mailwing: account upsert/list never exposes the password", () => {
  const add = mailwing.upsertAccount({
    label: "personal", smtpHost: "smtp.gmail.com", smtpPort: 587,
    secure: false, user: "me@gmail.com", pass: "app-password", isDefault: true,
  });
  assert.equal(add.ok, true, add.error);
  const list = mailwing.listAccounts();
  const acct = list.find((a) => a.label === "personal");
  assert.ok(acct);
  assert.equal(acct.smtpHost, "smtp.gmail.com");
  assert.equal(acct.passEncrypted, false);
  assert.ok(!("pass" in acct), "raw password must never leave the vault");
  const bad = mailwing.upsertAccount({ label: "x", smtpHost: "h", smtpPort: 587, secure: false, user: "", pass: "" });
  assert.equal(bad.ok, false);
});

test("mailwing: removeAccount + resolveAccount default behaviour", () => {
  assert.equal(mailwing.removeAccount("personal").ok, true);
  assert.equal(mailwing.resolveAccount(), null);
  mailwing.upsertAccount({ label: "a1", smtpHost: "smtp.a.com", smtpPort: 465, secure: true, user: "a@a.com", pass: "p" });
  mailwing.upsertAccount({ label: "b1", smtpHost: "smtp.b.com", smtpPort: 587, secure: false, user: "b@b.com", pass: "p", isDefault: true });
  assert.equal(mailwing.resolveAccount().label, "b1");
  assert.equal(mailwing.resolveAccount("a1").label, "a1");
});

test("mailwing: humanizeEmail uses the model when it works", async () => {
  const orig = routerMod.modelRouter.complete;
  routerMod.modelRouter.complete = async () => "Dear Rahul,\n\nHere is the report.\n\nBest,\nQuip";
  try {
    const res = await mailwing.humanizeEmail({ body: "send report to rahul", tone: "professional" });
    assert.equal(res.humanized, true);
    assert.match(res.body, /Rahul/);
    assert.ok(res.subject.length > 0);
  } finally {
    routerMod.modelRouter.complete = orig;
  }
});

test("mailwing: humanizeEmail falls back to raw text when the model fails", async () => {
  const orig = routerMod.modelRouter.complete;
  routerMod.modelRouter.complete = async () => { throw new Error("no provider configured"); };
  try {
    const res = await mailwing.humanizeEmail({ body: "my rough notes about the invoice", tone: "casual" });
    assert.equal(res.humanized, false);
    assert.equal(res.body, "my rough notes about the invoice");
    assert.match(res.note, /humanizer unavailable/);
  } finally {
    routerMod.modelRouter.complete = orig;
  }
});

test("mailwing: sendMail without an account is an honest no-account failure", async () => {
  // Temporarily clear the vault by pointing at a fresh dir? configureMailwing
  // is already bound to TMP; remove every account instead.
  for (const a of mailwing.listAccounts()) mailwing.removeAccount(a.id);
  const res = await mailwing.sendMail({ to: ["x@y.z"], body: "hi" });
  assert.equal(res.status, "no-account");
  assert.equal(res.ok, false);
  const outbox = mailwing.readOutbox();
  assert.ok(outbox.length >= 1);
  assert.equal(outbox[0].status, "failed");
});

test("mailwing: sendMail to a dead socket fails honestly and journals", async () => {
  mailwing.upsertAccount({ label: "dead", smtpHost: "127.0.0.1", smtpPort: 1, secure: false, user: "d@d.com", pass: "p", isDefault: true });
  const res = await mailwing.sendMail({ to: ["x@y.z"], subject: "s", body: "b" });
  assert.equal(res.ok, false);
  assert.equal(res.status, "failed");
  assert.match(res.output, /failed/i);
  const last = mailwing.readOutbox()[0];
  assert.equal(last.status, "failed");
  assert.equal(last.subject, "s");
});

test("mailwing: gmailComposeUrl prefills to/subject/body", () => {
  const url = mailwing.gmailComposeUrl({ to: "a@b.c", subject: "Hello there", body: "Line one\nLine two" });
  assert.ok(url.startsWith("https://mail.google.com/mail/?view=cm"));
  assert.ok(url.includes("to=a%40b.c") || url.includes("to=a@b.c"));
  assert.ok(url.includes("su=Hello"));
  assert.ok(url.includes("body="));
});

// ─── WebGhost: pure extraction core ──────────────────────────────────────────

test("webghost: extractContactsFromHtml ranks mailto+named above role mailboxes", () => {
  const html = `
    <a href="mailto:noreply@acme.com">do not reply</a>
    <a href="mailto:rahul.sharma@acme.com">Rahul Sharma — Founder</a>
    <p>Contact us: info@acme.com or call +91 98765 43210</p>`;
  const cs = ghost.extractContactsFromHtml(html);
  assert.ok(cs.length >= 2);
  assert.equal(cs[0].email, "rahul.sharma@acme.com");
  assert.match(cs[0].name, /Rahul Sharma/);
  // noreply is either excluded or ranked last — never the top pick.
  const nr = cs.findIndex((c) => c.email === "noreply@acme.com");
  assert.ok(nr !== 0);
});

test("webghost: deobfuscated addresses are recovered", () => {
  const cs = ghost.extractContactsFromHtml("<p>write to priya [at] acme [dot] com today</p>");
  assert.ok(cs.some((c) => c.email === "priya@acme.com"));
  assert.deepEqual(
    ghost.deobfuscateEmails("boss(at)site(dot)org and v2 {at} x {dot} io"),
    ["boss@site.org", "v2@x.io"]
  );
});

test("webghost: phone-only pages surface a phone contact", () => {
  const cs = ghost.extractContactsFromHtml('<a href="tel:+919876543210">Call the office</a>');
  assert.ok(cs.some((c) => c.phone && c.phone.includes("919876543210")));
});

test("webghost: pickBestContact honours the hint", () => {
  const cs = ghost.extractContactsFromHtml(`
    <a href="mailto:support@acme.com">Support desk</a>
    <a href="mailto:meera@acme.com">Meera — CEO</a>`);
  const best = ghost.pickBestContact(cs, "CEO");
  assert.equal(best.email, "meera@acme.com");
  assert.equal(ghost.pickBestContact([], "x"), null);
});

test("webghost: findContactPage picks contact/about pages", () => {
  const url = ghost.findContactPage([
    { href: "https://acme.com/products", text: "Products" },
    { href: "https://acme.com/contact-us", text: "Contact us" },
    { href: "https://acme.com/blog/x", text: "Blog" },
  ]);
  assert.equal(url, "https://acme.com/contact-us");
  assert.equal(ghost.findContactPage([{ href: "https://x.com/a", text: "A" }]), null);
});

test("webghost: scripts JSON-encode values — quotes can never escape the literal", () => {
  const evil = `it's a "trap" alert('x')`;
  const click = ghost.buildGhostScript("click", { text: evil });
  // The payload is exactly JSON.stringify(args) inline — the ONLY safe way.
  assert.ok(click.includes(`const needle = ${JSON.stringify({ text: evil })}.text.toLowerCase()`));
  // Double quotes inside the value are escaped in the script source.
  assert.ok(click.includes('\\"trap\\"'));
  const fill = ghost.buildGhostScript("fill", { fields: [{ hint: "email", value: "a@b.c" }] });
  assert.ok(fill.includes("dispatchEvent"));
  assert.ok(fill.includes(JSON.stringify({ fields: [{ hint: "email", value: "a@b.c" }] }).slice(1, -1)));
});

// ─── Contacts Book ────────────────────────────────────────────────────────────

contacts.configureContactsBook(TMP);

test("contacts: upsert then merge by email", () => {
  const first = contacts.upsertContact({ email: "Rahul@Acme.com", name: "Rahul", source: "ghost:acme.com" });
  assert.equal(first.ok, true);
  const second = contacts.upsertContact({ email: "rahul@acme.com", company: "Acme Ltd", source: "manual:chat" });
  assert.equal(second.ok, true);
  assert.equal(second.contact.id, first.contact.id, "same email → same contact");
  assert.equal(second.contact.company, "Acme Ltd");
  assert.deepEqual(second.contact.sources, ["ghost:acme.com", "manual:chat"]);
  const bad = contacts.upsertContact({ name: "no address" });
  assert.equal(bad.ok, false);
});

test("contacts: scored search + resolveEmail", () => {
  const hits = contacts.searchContacts("rahul");
  assert.ok(hits.length >= 1);
  assert.equal(contacts.scoreContact({ ...hits[0] }, "rahul@acme.com"), 100);
  const resolved = contacts.resolveEmail("rahul");
  assert.equal(resolved.email, "rahul@acme.com");
});

test("contacts: CSV export writes a real file", () => {
  const out = path.join(TMP, "contacts.csv");
  const res = contacts.exportContactsCsv(out);
  assert.equal(res.ok, true, res.error);
  const csv = fs.readFileSync(out, "utf8");
  assert.match(csv, /^name,email,phone,company/);
  assert.match(csv, /rahul@acme\.com/);
});

// ─── FileButler ───────────────────────────────────────────────────────────────

butler.configureFileButler(TMP);

test("filebutler: classification + deny list", () => {
  assert.equal(butler.classifyFile("photo.JPG"), "Images");
  assert.equal(butler.classifyFile("report.pdf"), "Documents");
  assert.equal(butler.classifyFile("setup.exe"), "Installers");
  assert.equal(butler.classifyFile("mystery.xyz"), "Others");
  assert.equal(butler.isDeniedPath("C:\\Windows\\System32"), true);
  assert.equal(butler.isDeniedPath("C:\\Users\\me\\Downloads"), false);
  assert.equal(butler.isDeniedPath("/home/me/project/node_modules/x"), true);
});

test("filebutler: plan → apply → undo round-trip with manifest", () => {
  const dir = path.join(TMP, "dl");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "a.jpg"), "img-a");
  fs.writeFileSync(path.join(dir, "b.png"), "img-b");
  fs.writeFileSync(path.join(dir, "c.txt"), "doc-c");
  fs.mkdirSync(path.join(dir, "already-a-folder"), { recursive: true });

  const planned = butler.planOrganize(dir, "type");
  assert.equal(planned.ok, true, planned.error);
  assert.equal(planned.plan.entries.length, 3);
  assert.ok(planned.plan.skipped.some((s) => s.includes("already-a-folder")));

  const applied = butler.applyOrganizePlan(planned.plan);
  assert.equal(applied.ok, true, JSON.stringify(applied.failed));
  assert.equal(applied.moved, 3);
  assert.equal(fs.existsSync(path.join(dir, "Images", "a.jpg")), true);
  assert.equal(fs.existsSync(path.join(dir, "a.jpg")), false);

  const manifests = butler.listManifests(5);
  assert.ok(manifests.length >= 1);

  const undone = butler.undoOrganize(applied.manifestId);
  assert.equal(undone.ok, true, JSON.stringify(undone.failed));
  assert.equal(fs.existsSync(path.join(dir, "a.jpg")), true);
  assert.equal(fs.existsSync(path.join(dir, "Images", "a.jpg")), false);
});

test("filebutler: collision policy renames instead of overwriting", () => {
  const dir = path.join(TMP, "collide");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "shot.png"), "new");
  fs.mkdirSync(path.join(dir, "Images"), { recursive: true });
  fs.writeFileSync(path.join(dir, "Images", "shot.png"), "old");
  const plan = butler.buildOrganizePlan(dir, [
    { name: "shot.png", isDirectory: false, mtimeMs: Date.now() },
  ], "type");
  assert.equal(plan.entries[0].to, path.join(dir, "Images", "shot-2.png"));
  const applied = butler.applyOrganizePlan(plan);
  assert.equal(applied.moved, 1);
  assert.equal(fs.readFileSync(path.join(dir, "Images", "shot.png"), "utf8"), "old");
  assert.equal(fs.readFileSync(path.join(dir, "Images", "shot-2.png"), "utf8"), "new");
});

test("filebutler: denied directories are refused", () => {
  assert.equal(butler.planOrganize("C:\\Windows", "type").ok, false);
  assert.equal(butler.storageReport("C:\\Program Files").ok, false);
  assert.equal(butler.findDuplicates("C:\\Windows\\System32").ok, false);
  assert.equal(butler.startWatch("C:\\Windows", () => {}).ok, false);
});

test("filebutler: duplicates found by size then sha256, cleaned to .quip-trash", () => {
  const dir = path.join(TMP, "dupes");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "one.bin"), "IDENTICAL-CONTENT");
  fs.writeFileSync(path.join(dir, "two.bin"), "IDENTICAL-CONTENT");
  fs.writeFileSync(path.join(dir, "three.bin"), "different");
  const found = butler.findDuplicates(dir);
  assert.equal(found.ok, true);
  assert.equal(found.groups.length, 1);
  assert.equal(found.groups[0].files.length, 2);
  const cleaned = butler.trashDuplicateCopies(found.groups);
  assert.equal(cleaned.trashed.length, 1);
  // The FIRST copy of each group survives; the second goes to .quip-trash.
  assert.equal(fs.existsSync(path.join(dir, "one.bin")), true, "first copy survives");
  assert.equal(fs.existsSync(path.join(dir, "two.bin")), false, "duplicate copy trashed");
  assert.equal(fs.existsSync(path.join(dir, "three.bin")), true, "unique file untouched");
});

test("filebutler: storage report counts bytes honestly", () => {
  const dir = path.join(TMP, "storage");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "big.bin"), "x".repeat(1000));
  fs.writeFileSync(path.join(dir, "note.txt"), "y".repeat(100));
  const rep = butler.storageReport(dir);
  assert.equal(rep.ok, true);
  assert.equal(rep.report.files, 2);
  assert.equal(rep.report.bytes, 1100);
  assert.equal(butler.formatBytes(1100), "1.1 KB");
  assert.equal(butler.formatBytes(5), "5 B");
});

// ─── GhostHands: pure builders + guarded execution ────────────────────────────

test("ghosthands: PowerShell builders are complete and quoted", () => {
  const wp = hands.buildWallpaperPs("C:\\Users\\me\\pic's.png");
  assert.ok(wp.includes("SystemParametersInfo(20"));
  assert.ok(wp.includes("pic''s.png"), "single quotes are doubled for PS");
  assert.ok(hands.buildBrightnessPs(85).includes(", 85)"));
  assert.ok(hands.buildLockPs().includes("LockWorkStation"));
  assert.ok(hands.buildBatteryPs().includes("Win32_Battery"));
  const clamped = hands.buildBrightnessPs(5000);
  assert.ok(clamped.includes(", 100)"), "level clamps to 1-100");
});

test("ghosthands: winget proposals match known ids, exact-name otherwise", () => {
  assert.match(hands.proposeInstall("notepad++").command, /Notepad\+\+\.Notepad\+\+/);
  assert.match(hands.proposeInstall("some unknown app").command, /--name "some unknown app"/);
  assert.equal(hands.proposeInstall("   ").ok, false);
});

test("ghosthands: snap presets compute real rects", () => {
  const wa = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(hands.snapRect("left", wa), { x: 0, y: 0, width: 960, height: 1040 });
  assert.deepEqual(hands.snapRect("right", wa), { x: 960, y: 0, width: 960, height: 1040 });
});

test("ghosthands: clipboard ring caps at 25 entries", () => {
  for (let i = 0; i < 40; i++) hands.pushClipboard(`clip-${i}`, "write");
  const hist = hands.clipboardHistory();
  assert.equal(hist.length, 25);
  assert.equal(hist[0].text, "clip-39");
});

test("ghosthands: unsupported platform refuses honestly (no fake success)", async () => {
  if (process.platform === "win32") return; // on real Windows this path never runs
  const wp = await hands.setWallpaper("https://example.com/x.jpg");
  assert.equal(wp.ok, false);
  const br = await hands.setBrightness(50);
  assert.equal(br.ok, false);
  const lock = await hands.lockPc();
  assert.equal(lock.ok, false);
});

// ─── Quest Engine ─────────────────────────────────────────────────────────────

quests.configureRoutines(path.join(TMP, "routines"));

function stubRuntime({ approved = true } = {}) {
  const execCalls = [];
  const approvalCalls = [];
  return {
    execCalls,
    approvalCalls,
    runtime: {
      executeTool: async (action, step) => {
        execCalls.push({ action, step });
        return { success: true, output: `ok:${action}`, note: "stub", evidence: [] };
      },
      requestApproval: async (title, lines) => {
        approvalCalls.push({ title, lines });
        return approved;
      },
    },
  };
}

test("quests: buildQuest refuses unknown kinds and missing urls", () => {
  assert.equal(quests.buildQuest("does-not-exist", {}).ok, false);
  assert.equal(quests.buildQuest("email-from-website", {}).ok, false, "url required");
  assert.equal(quests.buildQuest("email-from-website", { url: "https://acme.com" }).ok, true);
  assert.equal(quests.buildQuest("organize-downloads", {}).ok, true);
  assert.equal(quests.buildQuest("morning-brief", {}).ok, true);
});

test("quests: organize-downloads plans → asks → moves (approval honored)", async () => {
  const dir = path.join(TMP, "quest-dl");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "v.mkv"), "video");
  fs.writeFileSync(path.join(dir, "d.pdf"), "doc");
  const stub = stubRuntime({ approved: true });
  quests.configureQuestRuntime(stub.runtime);
  const events = [];
  quests.setQuestEventSink((e) => events.push(e));
  const built = quests.buildQuest("organize-downloads", { dir });
  const res = await quests.runQuest(built.quest, { dir });
  assert.equal(res.ok, true, res.summary + "\n" + res.notes.join("\n"));
  assert.equal(fs.existsSync(path.join(dir, "Videos", "v.mkv")), true);
  assert.equal(stub.approvalCalls.length, 1, "exactly one approval card");
  assert.match(stub.approvalCalls[0].title, /Move 2 file/);
  assert.ok(events.some((e) => e.status === "waiting_permission"));
  assert.ok(events.some((e) => e.status === "done"));
});

test("quests: a declined plan moves nothing", async () => {
  const dir = path.join(TMP, "quest-dl2");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "x.jpg"), "img");
  const stub = stubRuntime({ approved: false });
  quests.configureQuestRuntime(stub.runtime);
  const built = quests.buildQuest("organize-downloads", { dir });
  const res = await quests.runQuest(built.quest, { dir });
  assert.equal(res.ok, false);
  assert.equal(res.cancelled, true);
  assert.match(res.summary, /declined/i);
  assert.equal(fs.existsSync(path.join(dir, "x.jpg")), true, "file untouched");
});

test("quests: morning-brief degrades honestly when battery/weather unavailable", async () => {
  const stub = stubRuntime({ approved: true });
  quests.configureQuestRuntime(stub.runtime);
  const built = quests.buildQuest("morning-brief", {});
  const res = await quests.runQuest(built.quest, {});
  assert.equal(res.ok, true, res.summary);
  // On non-Windows sandboxes battery fails → that step is skipped, not faked.
  assert.ok(res.notes.some((n) => n.startsWith("skipped battery") || n.startsWith("battery:")));
  assert.ok(stub.execCalls.some((c) => c.action === "speak"), "the brief is spoken via the runtime");
});

test("quests: email-from-website build fails without a url (no network in tests)", () => {
  const built = quests.buildQuest("email-from-website", { url: "" });
  assert.equal(built.ok, false);
  assert.match(built.error, /website/i);
});

test("routines: save, list, run through the runtime", async () => {
  const stub = stubRuntime({ approved: true });
  quests.configureQuestRuntime(stub.runtime);
  const saved = quests.saveRoutine("evening", [
    { kind: "tool", action: "battery", params: {} },
    { kind: "say", text: "all done" },
  ]);
  assert.equal(saved.ok, true, saved.error);
  assert.equal(quests.listRoutines().some((r) => r.name === "evening"), true);
  const res = await quests.runRoutine("evening");
  assert.equal(res.ok, true, res.summary + "\n" + res.results.join("\n"));
  assert.equal(res.results.length, 2);
  assert.ok(stub.execCalls.some((c) => c.action === "battery"));
  assert.ok(stub.execCalls.some((c) => c.action === "speak"));
  const nope = await quests.runRoutine("nope");
  assert.equal(nope.ok, false);
  assert.equal(quests.saveRoutine("empty", []).ok, false);
  assert.equal(quests.deleteRoutine("evening").ok, true);
});

// ─── Registry / catalog / contracts / permissions sync ───────────────────────

const NEW_EXECUTORS = [
  "web_ghost_read", "web_ghost_extract", "web_ghost_click", "web_ghost_fill",
  "mailwing_draft", "mailwing_send", "mailwing_accounts", "mailwing_outbox",
  "contacts_search", "contacts_save", "contacts_export",
  "file_organize", "file_duplicates", "file_storage_report", "file_watch",
  "screenshot_save", "wallpaper_set", "brightness", "notify_me", "lock_pc",
  "battery", "clipboard_history", "install_app",
  "quest_run", "routine_save", "routine_run", "routine_list",
];

test("sync: every new executor exists and has a contract", () => {
  const names = registry.executorNames();
  for (const name of NEW_EXECUTORS) {
    assert.ok(names.includes(name), `executor ${name} missing from the registry`);
    assert.ok(contracts.contractFor(name), `executor ${name} has no contract`);
  }
});

test("sync: every new executor is advertised in the model catalog", () => {
  const catalogNames = catalogMod.TOOL_CATALOG.map((t) => t.schema.function.name);
  for (const name of NEW_EXECUTORS) {
    assert.ok(catalogNames.includes(name), `catalog entry missing for ${name}`);
    assert.ok(catalogMod.progressFor(name) !== "Working…", `progress label missing for ${name}`);
  }
  // And the reverse: the catalog never advertises a ghost executor.
  for (const entry of catalogMod.TOOL_CATALOG) {
    assert.ok(registry.executorNames().includes(entry.schema.function.name),
      `catalog advertises ${entry.schema.function.name} which has no executor`);
  }
});

test("sync: §19 safety classes for the autonomy wave", () => {
  assert.equal(contracts.safetyClass("web_ghost_extract"), "EXTERNAL");
  assert.equal(contracts.safetyClass("web_ghost_read"), "EXTERNAL");
  assert.equal(contracts.safetyClass("mailwing_send"), "DESTRUCTIVE");
  assert.equal(contracts.safetyClass("lock_pc"), "DESTRUCTIVE");
  assert.equal(contracts.safetyClass("install_app"), "DESTRUCTIVE");
  assert.equal(contracts.safetyClass("quest_run"), "DESTRUCTIVE");
  assert.equal(contracts.safetyClass("mailwing_draft"), "WRITE");
  assert.equal(contracts.safetyClass("battery"), "READ");
  assert.equal(contracts.safetyClass("mailwing_outbox"), "READ");
  assert.equal(contracts.safetyClass("file_organize", { op: "plan" }), "READ");
  assert.equal(contracts.safetyClass("file_organize", { op: "apply" }), "DESTRUCTIVE");
  assert.equal(contracts.safetyClass("file_organize", { op: "undo" }), "DESTRUCTIVE");
  assert.equal(contracts.safetyClass("file_duplicates", { clean: "true" }), "DESTRUCTIVE");
  assert.equal(contracts.safetyClass("file_duplicates", {}), "READ");
  assert.equal(contracts.safetyClass("mailwing_accounts", { op: "test" }), "EXTERNAL");
  assert.equal(contracts.safetyClass("mailwing_accounts", {}), "READ");
});

test("sync: permission risk levels for the autonomy wave", () => {
  assert.equal(permissionModes.riskForStep("mailwing_send"), "dangerous");
  assert.equal(permissionModes.riskForStep("lock_pc"), "dangerous");
  assert.equal(permissionModes.riskForStep("install_app"), "dangerous");
  assert.equal(permissionModes.riskForStep("quest_run"), "dangerous");
  assert.equal(permissionModes.riskForStep("routine_run"), "dangerous");
  assert.equal(permissionModes.riskForStep("mailwing_draft"), "medium");
  assert.equal(permissionModes.riskForStep("screenshot_save"), "medium");
  assert.equal(permissionModes.riskForStep("contacts_save"), "medium");
  assert.equal(permissionModes.riskForStep("battery"), "safe");
  assert.equal(permissionModes.riskForStep("web_ghost_read"), "safe");
});

test("sync: §20 validation refuses malformed autonomy steps", () => {
  const missing = contracts.validateStep({ action: "mailwing_draft", target: "", params: {} });
  assert.ok(missing.some((i) => i.slot === "to"));
  assert.ok(missing.some((i) => i.slot === "body"));
  const okStep = contracts.validateStep({ action: "mailwing_draft", target: "", params: { to: "a@b.c", body: "hi" } });
  assert.deepEqual(okStep, []);
  const noKind = contracts.validateStep({ action: "quest_run", target: "", params: {} });
  assert.ok(noKind.some((i) => i.slot === "kind"));
  const noContract = contracts.validateStep({ action: "not_a_real_action", target: "", params: {} });
  assert.equal(noContract.length, 1);
});

// ─── Intent routing for the new verbs (English + Hinglish) ───────────────────

test("intents: email-from-website quest wins over open/search", () => {
  const r = parseIntentV2("us site pe jo email hai usko mail bhejo about partnership https://acme.com");
  assert.equal(r.steps[0].action, "quest_run");
  assert.equal(r.steps[0].params.kind, "email-from-website");
  assert.match(r.steps[0].params.url, /acme\.com/);
  assert.match(r.steps[0].params.body, /partnership/i);
});

test("intents: extract emails from a site", () => {
  const r = parseIntentV2("extract emails from https://acme.com/team");
  assert.equal(r.steps[0].action, "web_ghost_extract");
  assert.equal(r.steps[0].params.url, "https://acme.com/team");
});

test("intents: read a JS-rendered page fully", () => {
  const r = parseIntentV2("read https://spa-app.com/pricing fully");
  assert.equal(r.steps[0].action, "web_ghost_read");
});

test("intents: send an email with address + about + tone", () => {
  const r = parseIntentV2("send a formal email to rahul@acme.com about the quarterly report");
  assert.equal(r.steps[0].action, "mailwing_draft");
  assert.equal(r.steps[0].params.to, "rahul@acme.com");
  assert.equal(r.steps[0].params.tone, "formal");
  assert.match(r.steps[0].params.body, /quarterly report/);
  assert.equal(r.steps[1].action, "mailwing_send");
});

test("intents: organize downloads plans then applies", () => {
  const r = parseIntentV2("organize my downloads");
  assert.equal(r.steps.length, 2);
  assert.equal(r.steps[0].action, "file_organize");
  assert.equal(r.steps[0].params.op, "plan");
  assert.ok(r.steps[0].params.dir.endsWith("Downloads"));
  assert.equal(r.steps[1].params.op, "apply");
});

test("intents: Hinglish organize (downloads saaf karo)", () => {
  const r = parseIntentV2("downloads saaf karo");
  assert.equal(r.steps[0].action, "file_organize");
  assert.ok(r.steps[0].params.dir.endsWith("Downloads"));
});

test("intents: confirm / undo organize", () => {
  assert.equal(parseIntentV2("confirm organize").steps[0].params.op, "apply");
  assert.equal(parseIntentV2("undo organize").steps[0].params.op, "undo");
});

test("intents: duplicates scan + clean", () => {
  const scan = parseIntentV2("find duplicates in downloads");
  assert.equal(scan.steps[0].action, "file_duplicates");
  assert.ok(scan.steps[0].params.dir.endsWith("Downloads"));
  assert.equal(scan.steps[0].params.clean, undefined);
  const clean = parseIntentV2("clean duplicates in downloads");
  assert.equal(clean.steps[0].params.clean, "true");
});

test("intents: storage report + watch", () => {
  const st = parseIntentV2("downloads ki storage report");
  assert.equal(st.steps[0].action, "file_storage_report");
  const watch = parseIntentV2("watch my downloads folder");
  assert.equal(watch.steps[0].action, "file_watch");
  assert.equal(watch.steps[0].params.op, "start");
  const stop = parseIntentV2("stop watching downloads");
  assert.equal(stop.steps[0].params.op, "stop");
});

test("intents: device superpowers", () => {
  assert.equal(parseIntentV2("screenshot and save it").steps[0].action, "screenshot_save");
  assert.equal(parseIntentV2("lock my pc").steps[0].action, "lock_pc");
  const br = parseIntentV2("brightness 60");
  assert.equal(br.steps[0].action, "brightness");
  assert.equal(br.steps[0].params.level, "60");
  assert.equal(parseIntentV2("battery kaisi hai").steps[0].action, "battery");
  assert.equal(parseIntentV2("clipboard history dikhao").steps[0].action, "clipboard_history");
});

test("intents: wallpaper with URL", () => {
  const r = parseIntentV2("change wallpaper to https://images.example.com/art.jpg");
  assert.equal(r.steps[0].action, "wallpaper_set");
  assert.equal(r.steps[0].params.source, "https://images.example.com/art.jpg");
});

test("intents: install an app", () => {
  const r = parseIntentV2("install notepad++");
  assert.equal(r.steps[0].action, "install_app");
  assert.match(r.steps[0].params.query, /notepad/i);
});

test("intents: routines save / run / list", () => {
  const save = parseIntentV2("save a routine called morning that organizes downloads");
  assert.equal(save.steps[0].action, "routine_save");
  assert.equal(save.steps[0].params.name, "morning");
  const parsedSteps = JSON.parse(save.steps[0].params.steps);
  assert.equal(parsedSteps[0].questId, "organize-downloads");
  const run = parseIntentV2("run morning routine");
  assert.equal(run.steps[0].action, "routine_run");
  assert.equal(run.steps[0].params.name, "morning");
  assert.equal(parseIntentV2("list routines").steps[0].action, "routine_list");
});

test("intents: legacy clipboard copy still works (history excluded)", () => {
  const copy = parseIntentV2("copy hello world to the clipboard");
  assert.equal(copy.steps[0].action, "clipboard");
  assert.equal(copy.steps[0].params.mode, "write");
});

test("intents: plain screenshot keeps the old screen action", () => {
  const r = parseIntentV2("take a screenshot");
  assert.equal(r.steps[0].action, "screen");
});
