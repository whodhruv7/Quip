// Tests: capability-repair round 3b — fixes re-applied on top of the remote
// capabilities-merge (58e0403). Covers the gaps that remained live:
//   1. file-in-folder routing ("open my invoice from downloads" must find the
//      FILE, not win with a score-95 Downloads folder candidate)
//   2. explicit filesystem paths are never name-munged and keep their case
//   3. Hinglish volume ("volume kam karo" / "volume badhao")
//   4. location-aware candidate suppression in resolveLocalCandidates
// Pure/deterministic: no model calls, no PowerShell, no Windows APIs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { parseIntentV2 } = await import("../dist-test/electron/engine/intent-parser-v2.js");
const { resolveLocalCandidates, scoreEntryName } = await import(
  "../dist-test/electron/engine/file-discovery.js"
);

// ─── Parser: Hinglish volume ─────────────────────────────────────────────────

test("parser: 'volume kam karo' is a volume DOWN step, not chat", () => {
  const p = parseIntentV2("volume kam karo");
  assert.equal(p.isTask, true);
  assert.equal(p.steps.length, 1);
  assert.equal(p.steps[0].action, "volume");
  assert.equal(p.steps[0].params.action, "down");
});

test("parser: 'volume badhao' is a volume UP step", () => {
  const p = parseIntentV2("volume badhao");
  assert.equal(p.steps[0].action, "volume");
  assert.equal(p.steps[0].params.action, "up");
});

test("parser: 'volume kam kar do' still parses (suffix variants)", () => {
  const p = parseIntentV2("volume dheema kar do");
  assert.equal(p.steps[0].action, "volume");
  assert.equal(p.steps[0].params.action, "down");
});

// ─── Parser: file-in-folder routing ──────────────────────────────────────────

test("parser: 'open my invoice from downloads' opens the FILE, not the folder", () => {
  const p = parseIntentV2("open my invoice from downloads");
  assert.equal(p.isTask, true);
  assert.equal(p.steps.length, 1);
  assert.equal(p.steps[0].action, "open_file");
  assert.equal(p.steps[0].target, "invoice");
  assert.ok(p.steps[0].params.query.includes("downloads"), "the location must ride along in query");
});

test("parser: 'open resume in documents' routes to the file inside Documents", () => {
  const p = parseIntentV2("open resume in documents");
  assert.equal(p.steps[0].action, "open_file");
  assert.equal(p.steps[0].target, "resume");
});

test("parser: 'open downloads' still opens the folder itself", () => {
  const p = parseIntentV2("open downloads");
  assert.equal(p.steps[0].action, "open_folder");
});

test("parser: 'open pictures' is untouched by the file-in-folder clause", () => {
  const p = parseIntentV2("open pictures");
  assert.equal(p.steps[0].action, "open_folder");
});

// ─── Parser: explicit filesystem paths ───────────────────────────────────────

test("parser: explicit Windows paths keep their case and are never name-munged", () => {
  const p = parseIntentV2("open C:\\Users\\me\\My Files\\resume.pdf");
  assert.equal(p.steps.length, 1);
  assert.equal(p.steps[0].action, "open_file");
  assert.equal(p.steps[0].target, "C:\\Users\\me\\My Files\\resume.pdf");
});

test("parser: an explicit folder path routes to open_folder", () => {
  const p = parseIntentV2("open C:\\Users\\me\\dev\\quip");
  assert.equal(p.steps[0].action, "open_folder");
  assert.equal(p.steps[0].target, "C:\\Users\\me\\dev\\quip");
});

// ─── Resolver: location-aware candidates ─────────────────────────────────────

test("resolver: a unique file under /home is found as an exact-path hit", async () => {
  const dir = fs.mkdtempSync(path.join("/home/z", "quipxtest-"));
  try {
    const file = path.join(dir, "quipx-invoice-march.pdf");
    fs.writeFileSync(file, "x");
    const hits = await resolveLocalCandidates(`open ${file}`, undefined, { limit: 3 });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].path, file);
    assert.equal(hits[0].score, 100);
    assert.equal(hits[0].source, "exact-path");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolver: 'X from downloads' style queries never offer the bare folder as a candidate", async () => {
  // The file noun is nonsense-unique so nothing can match it; the assertion is
  // that the score-95 Downloads folder does NOT sneak back into the results.
  const hits = await resolveLocalCandidates("quipxnonexistent from downloads", undefined, { limit: 6 });
  assert.ok(!hits.some((c) => c.name.toLowerCase() === "downloads"), `got: ${hits.map((h) => h.name)}`);
});

test("resolver: plain 'desktop' still resolves the folder (no file noun)", async () => {
  const hits = await resolveLocalCandidates("desktop", undefined, { limit: 6 });
  assert.ok(hits.some((c) => c.name.toLowerCase() === "desktop" && c.kind === "folder"), `got: ${hits.map((h) => h.name)}`);
});

// ─── Scoring sanity (remote's 0–100 scale) ───────────────────────────────────

test("scoring: exact base-name beats partial, noise scores low", () => {
  const exact = scoreEntryName("invoice", "invoice.pdf");
  const partial = scoreEntryName("invoice", "invoice-march.pdf");
  const noise = scoreEntryName("invoice", "beach-vacation.png");
  assert.ok(exact >= 80, `exact=${exact}`);
  assert.ok(partial >= 60 && partial <= exact, `partial=${partial}`);
  assert.ok(noise < 40, `noise=${noise}`);
});
