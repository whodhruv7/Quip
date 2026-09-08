// Tests: reliability round — companion-visibility window geometry, .env key
// store, provider probe (mocked fetch), deep system control (process deny-list,
// tasklist parsing, volume math, browser matcher) and the new intent clauses.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { clampRect, anchorBottomRight } from "../dist-test/electron/window-geometry.js";
import {
  validateApiKey,
  upsertEnvFile,
  maskKey,
} from "../dist-test/electron/system/env-store.js";
import {
  probeOpenRouter,
  probeGroq,
} from "../dist-test/electron/system/provider-probe.js";
import {
  isProtectedProcess,
  parseTasklistCsv,
  volumePressPlan,
  looksLikeBrowserWindow,
} from "../dist-test/electron/engine/system-control.js";
import { parseIntentV2 } from "../dist-test/electron/engine/intent-parser-v2.js";
import { riskForStep } from "../dist-test/electron/engine/permission-modes.js";

const AREA = { x: 0, y: 0, width: 1920, height: 1040 };

// ─── A. Window geometry — the companion must never be lost off-screen ──────

test("A1: clampRect keeps a normal position untouched", () => {
  const p = clampRect({ x: 500, y: 500, width: 132, height: 176 }, AREA);
  assert.deepEqual(p, { x: 500, y: 500 });
});

test("A2: clampRect pulls a window stranded beyond the right/bottom edge back", () => {
  const p = clampRect({ x: 3000, y: 2000, width: 132, height: 176 }, AREA);
  assert.equal(p.x, 1920 - 132);
  assert.equal(p.y, 1040 - 176);
});

test("A3: clampRect handles negative positions (second monitor unplugged)", () => {
  const p = clampRect({ x: -800, y: -400, width: 132, height: 176 }, AREA);
  assert.deepEqual(p, { x: 0, y: 0 });
});

test("A4: clampRect survives NaN garbage from a corrupted position file", () => {
  const p = clampRect({ x: NaN, y: NaN, width: 132, height: 176 }, AREA);
  assert.deepEqual(p, { x: 0, y: 0 });
});

test("A5: anchorBottomRight keeps the corner fixed when the panel opens", () => {
  const cur = { x: 1780, y: 860, width: 132, height: 176 };
  const p = anchorBottomRight(cur, 548, 560, AREA);
  assert.equal(p.x + 548, cur.x + cur.width);
  assert.equal(p.y + 560, cur.y + cur.height);
});

// ─── B. .env key store — in-app key setup persistence ───────────────────────

test("B1: OpenRouter keys must start with sk-or-", () => {
  assert.equal(validateApiKey("openrouter", "sk-or-v1-abc123").ok, true);
  assert.equal(validateApiKey("openrouter", "gsk_abc123").ok, false);
  assert.equal(validateApiKey("openrouter", "").ok, false);
  assert.equal(validateApiKey("openrouter", "sk-or-v1 abc").ok, false); // no spaces
});

test("B2: Groq keys must start with gsk_", () => {
  assert.equal(validateApiKey("groq", "gsk_abc123").ok, true);
  assert.equal(validateApiKey("groq", "sk-or-v1-abc123").ok, false);
});

test("B3: upsertEnvFile creates a file when missing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quip-env-"));
  const file = path.join(dir, ".env");
  const r = upsertEnvFile(file, { OPENROUTER_API_KEY: "sk-or-v1-new" });
  assert.equal(r.ok, true);
  const txt = fs.readFileSync(file, "utf8");
  assert.match(txt, /OPENROUTER_API_KEY=sk-or-v1-new/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B4: upsertEnvFile replaces in place, keeps comments and other vars", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quip-env-"));
  const file = path.join(dir, ".env");
  fs.writeFileSync(
    file,
    [
      "# my header comment",
      "OPENROUTER_API_KEY=sk-or-v1-old",
      "",
      "GROQ_MODEL=llama-3.3-70b-versatile",
    ].join("\n")
  );
  const r = upsertEnvFile(file, { OPENROUTER_API_KEY: "sk-or-v1-rotated" });
  assert.equal(r.ok, true);
  const txt = fs.readFileSync(file, "utf8");
  assert.match(txt, /# my header comment/);                       // comment kept
  assert.doesNotMatch(txt, /sk-or-v1-old/);                       // old key gone
  assert.match(txt, /OPENROUTER_API_KEY=sk-or-v1-rotated/);       // new key in place
  assert.match(txt, /GROQ_MODEL=llama-3.3-70b-versatile/);        // unrelated var kept
  assert.equal((txt.match(/OPENROUTER_API_KEY=/g) ?? []).length, 1); // no dupes
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B5: maskKey never reveals the full key", () => {
  const masked = maskKey("sk-or-v1-1234567890abcdef");
  assert.ok(!masked.includes("1234567890abcdef"));
  assert.ok(masked.startsWith("sk-or-v1"));
  assert.equal(maskKey(""), "");
});

// ─── C. Provider probe — honest results, mocked fetch ───────────────────────

const okRes = (status, body = "") => ({
  status,
  text: async () => body,
});

test("C1: OpenRouter probe reports success with latency", async () => {
  const r = await probeOpenRouter("sk-or-v1-x", "minimax/minimax-m3:free", async () => okRes(200));
  assert.equal(r.ok, true);
  assert.ok(r.latencyMs >= 0);
});

test("C2: OpenRouter probe maps 401 to an honest auth failure", async () => {
  const r = await probeOpenRouter("sk-or-v1-bad", "m", async () => okRes(401));
  assert.equal(r.ok, false);
  assert.equal(r.kind, "auth");
  assert.match(r.message, /rejected/i);
});

test("C3: OpenRouter probe calls out a rejected model id (400)", async () => {
  const r = await probeOpenRouter("sk-or-v1-x", "wrong/model", async () =>
    okRes(400, '{"error":"model not found"}')
  );
  assert.equal(r.ok, false);
  assert.match(r.message, /model/i);
});

test("C4: network errors are reported as network, not success", async () => {
  const r = await probeGroq("gsk_x", "m", async () => {
    throw new Error("ECONNREFUSED");
  });
  assert.equal(r.ok, false);
  assert.equal(r.kind, "network");
});

test("C5: timeouts are their own kind", async () => {
  const abortErr = new Error("The operation was aborted");
  abortErr.name = "AbortError";
  const r = await probeGroq("gsk_x", "m", async () => {
    throw abortErr;
  });
  assert.equal(r.ok, false);
  assert.equal(r.kind, "timeout");
});

test("C6: empty key is refused before any request", async () => {
  let called = false;
  const r = await probeOpenRouter("", "m", async () => {
    called = true;
    return okRes(200);
  });
  assert.equal(called, false);
  assert.equal(r.kind, "no-key");
});

// ─── D. System control — pure helpers ───────────────────────────────────────

test("D1: protected-process deny-list guards the Windows core", () => {
  assert.equal(isProtectedProcess("lsass.exe"), true);
  assert.equal(isProtectedProcess("csrss"), true);
  assert.equal(isProtectedProcess("explorer"), true);
  assert.equal(isProtectedProcess("explorer.exe"), true);
  assert.equal(isProtectedProcess("svchost"), true);
  assert.equal(isProtectedProcess("chrome"), false);
  assert.equal(isProtectedProcess("notepad"), false);
  assert.equal(isProtectedProcess("quip"), true); // never kill itself
});

test("D2: parseTasklistCsv extracts name, pid and memory", () => {
  const csv = [
    '"System",4,123,456,"1,024 K"',
    '"chrome.exe",4210,123,456,"312,800 K"',
    'garbage line without quotes',
    '',
  ].join("\n");
  const procs = parseTasklistCsv(csv);
  assert.equal(procs.length, 2);
  assert.equal(procs[0].name, "System");
  assert.equal(procs[0].pid, 4);
  assert.equal(procs[1].name, "chrome.exe");
  assert.equal(procs[1].pid, 4210);
  assert.equal(procs[1].memUsageKb, 312800);
});

test("D3: volume 'set N' is deterministic (50 downs floor, then ups)", () => {
  const plan = volumePressPlan(50);
  assert.deepEqual(plan, { downs: 50, ups: 25 });
  assert.deepEqual(volumePressPlan(0), { downs: 50, ups: 0 });
  assert.deepEqual(volumePressPlan(100), { downs: 50, ups: 50 });
  assert.deepEqual(volumePressPlan(133), { downs: 50, ups: 50 }); // clamped
});

test("D4: browser matcher only trusts real browser windows", () => {
  assert.equal(looksLikeBrowserWindow("Google Chrome"), true);
  assert.equal(looksLikeBrowserWindow("Mitwa - YouTube — Mozilla Firefox"), true);
  assert.equal(looksLikeBrowserWindow("document1 - Word"), false);
  assert.equal(looksLikeBrowserWindow("Visual Studio Code"), false);
  assert.equal(looksLikeBrowserWindow(""), false);
});

// ─── E. New intent clauses — volume / media / processes / tabs ─────────────

test("E1: 'set volume to 50' routes to volume with level", () => {
  const r = parseIntentV2("set volume to 50");
  assert.equal(r.action, "volume");
  assert.equal(r.steps[0].params.action, "set");
  assert.equal(r.steps[0].params.level, "50");
});

test("E2: volume up/down/mute/unmute route correctly", () => {
  for (const [cmd, action] of [["volume up", "up"], ["turn the volume down", "down"], ["mute", "mute"], ["unmute the sound", "unmute"]]) {
    const r = parseIntentV2(cmd);
    assert.equal(r.action, "volume", cmd);
    assert.equal(r.steps[0].params.action, action, cmd);
  }
});

test("E3: Hinglish volume works (awaaz band karo / awaaz 40)", () => {
  assert.equal(parseIntentV2("awaaz band karo").steps[0].params.action, "mute");
  assert.equal(parseIntentV2("awaaz bada karo").steps[0].params.action, "up");
  assert.equal(parseIntentV2("awaaz kam karo").steps[0].params.action, "down");
  const lvl = parseIntentV2("awaaz 40 karo");
  assert.equal(lvl.steps[0].params.action, "set");
  assert.equal(lvl.steps[0].params.level, "40");
});

test("E4: 'play the next song' is a media key, NOT a YouTube search", () => {
  const r = parseIntentV2("play the next song");
  assert.equal(r.action, "media_key");
  assert.equal(r.steps[0].params.action, "next");
  assert.equal(parseIntentV2("previous track").steps[0].params.action, "previous");
  assert.equal(parseIntentV2("pause the music").steps[0].params.action, "playpause");
});

test("E5: 'play mitwa' still searches YouTube (no regression)", () => {
  const r = parseIntentV2("play mitwa");
  const stepActions = r.steps.map((s) => s.action);
  assert.ok(r.action === "play" || stepActions.includes("play_media"), JSON.stringify(r.steps));
  assert.ok(stepActions.includes("play_media"));
});

test("E6: process listing and force-close route to the right tools", () => {
  assert.equal(parseIntentV2("what processes are running").action, "process_list");
  assert.equal(parseIntentV2("list running processes").action, "process_list");
  assert.equal(parseIntentV2("show running processes").action, "process_list");
  const kill = parseIntentV2("kill the chrome process");
  assert.equal(kill.action, "process_kill");
  assert.equal(kill.steps[0].params.target, "chrome");
  const pid = parseIntentV2("close process 4210");
  assert.equal(pid.action, "process_kill");
  assert.equal(pid.steps[0].params.target, "4210");
});

test("E7: plain 'close chrome' stays a graceful close_app (not a kill)", () => {
  const r = parseIntentV2("close chrome");
  assert.equal(r.action, "close_app");
});

test("E8: browser tab control routes (new/close/next/back/reload)", () => {
  for (const [cmd, op] of [
    ["open a new tab", "new"],
    ["close this tab", "close"],
    ["switch to the next tab", "next"],
    ["go back", "back"],
    ["refresh the page", "reload"],
  ] ) {
    const r = parseIntentV2(cmd);
    assert.equal(r.action, "browser_tab", cmd);
    assert.equal(r.steps[0].params.op, op, cmd);
  }
});

test("E9: 'go back to youtube' does NOT trigger a bare tab action", () => {
  const r = parseIntentV2("go back to youtube");
  assert.notEqual(r.action, "browser_tab");
});

test("E10: risk levels — kill is dangerous, tab close is medium, volume safe", () => {
  assert.equal(riskForStep("process_kill"), "dangerous");
  assert.equal(riskForStep("browser_tab", { op: "close" }), "medium");
  assert.equal(riskForStep("browser_tab", { op: "new" }), "safe");
  assert.equal(riskForStep("volume"), "safe");
  assert.equal(riskForStep("media_key"), "safe");
  assert.equal(riskForStep("process_list"), "safe");
});

test("E11: chaos — sentences containing the words never execute", () => {
  // "volume" inside a sentence about volume knobs on a speaker
  const a = parseIntentV2("the volume on my speaker is broken");
  assert.notEqual(a.action, "volume");
  // "tab" in a sentence, not a command
  const b = parseIntentV2("i opened too many tabs today");
  assert.notEqual(b.action, "browser_tab");
  // "process" as a topic
  const c = parseIntentV2("the writing process takes time");
  assert.notEqual(c.action, "process_kill");
  assert.notEqual(c.action, "process_list");
});
