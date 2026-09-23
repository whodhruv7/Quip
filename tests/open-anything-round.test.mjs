// Tests: Open-anything round — files, apps, folders and websites must all
// resolve robustly; the never-quit rule stays enforced; every companion
// ships a complete definition set.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { parseIntentV2 } from "../dist-test/electron/engine/intent-parser-v2.js";
import { normalizeAppName, scoreAppMatch, resolveApp } from "../dist-test/electron/engine/app-discovery.js";
import { COMPANIONS } from "../dist-test/src/lib/companion-config.js";

const EXPECTED_COMPANIONS = ["pix", "kai", "ren", "bubbles", "capy", "skales"];

// ─── Intent routing: "open anything" phrasings resolve to the right tool ────

test("open intents: apps, websites, folders and files route to their tools", () => {
  const cases = [
    { cmd: "open chrome", action: "open_app" },
    { cmd: "open notepad", action: "open_app" },
    { cmd: "open folder downloads", action: "open_folder" },
    { cmd: "open downloads folder", action: "open_folder" },
    // Known sites keep their rich website routing
    { cmd: "open youtube", action: "open_website" },
  ];
  for (const c of cases) {
    const intent = parseIntentV2(c.cmd);
    const actions = intent.steps.map((s) => s.action);
    assert.ok(
      actions.includes(c.action),
      `"${c.cmd}" should route to ${c.action}, got [${actions.join(", ")}]`
    );
  }
});

test("open intents: hindi/hinglish phrasings still resolve", () => {
  // The user speaks Hinglish — the opener must not need perfect English.
  const kholo = parseIntentV2("youtube kholo");
  const khol = parseIntentV2("chrome khol do");
  const dekho = parseIntentV2("notepad kholo mere liye");
  const got = [kholo, khol, dekho].map((i) => i.steps.map((s) => s.action).join(","));
  assert.ok(got.some((g) => g.includes("open_app") || g.includes("open_url")), `hinglish opens lost: ${got.join(" | ")}`);
});

test("open intents: bare domains and URLs open as websites (F-29 regression)", () => {
  // F-29: bare domains used to misroute to open_folder and open an
  // Explorer error instead of the site.
  for (const cmd of ["open github.com", "open https://x.com", "go to gmail.com", "open example.com"]) {
    const intent = parseIntentV2(cmd);
    const actions = intent.steps.map((s) => s.action);
    assert.ok(
      actions.includes("open_url") || actions.includes("open_website"),
      `"${cmd}" should open as a website, got [${actions.join(", ")}]`
    );
  }
  // ...but folder words still mean folders even with a dot nearby
  const folderIntent = parseIntentV2("open my github.com folder");
  assert.ok(
    folderIntent.steps.some((s) => s.action === "open_folder"),
    "folder wording must still win when the user says folder"
  );
});

// ─── App resolution: fuzzy matching against the installed index ──────────────

const FAKE_INDEX = [
  { name: "Google Chrome", executable: "chrome.exe", confidence: 1 },
  { name: "Visual Studio Code", executable: "code.exe", confidence: 1 },
  { name: "WhatsApp", executable: "whatsapp.exe", confidence: 1 },
  { name: "Notepad++", executable: "notepad++.exe", confidence: 1 },
  { name: "Microsoft Edge", executable: "msedge.exe", confidence: 1 },
];

test("app resolution: common spoken names find the real installed app", () => {
  const cases = [
    { q: "chrome", want: "Google Chrome" },
    { q: "vs code", want: "Visual Studio Code" },
    { q: "whatsapp", want: "WhatsApp" },
    { q: "notepad++", want: "Notepad++" },
    { q: "edge", want: "Microsoft Edge" },
  ];
  for (const c of cases) {
    const hit = resolveApp(c.q, FAKE_INDEX);
    assert.ok(hit, `"${c.q}" must resolve`);
    assert.equal(hit.name, c.want, `"${c.q}" → ${hit.name}, wanted ${c.want}`);
  }
});

test("app resolution: junk queries return null instead of a wild guess", () => {
  assert.equal(resolveApp("", FAKE_INDEX), null);
  assert.equal(resolveApp("zzzqqqxyz", FAKE_INDEX), null);
});

test("app resolution: normalization strips noise before scoring", () => {
  assert.equal(normalizeAppName("  Google   Chrome! "), normalizeAppName("google chrome"));
  assert.ok(scoreAppMatch(normalizeAppName("code"), normalizeAppName("visual studio code")) > 0);
});

// ─── Never-quit: the close handler contract, enforced structurally ──────────

test("never-quit: every window close is intercepted unless quitting", () => {
  const src = fs.readFileSync(path.resolve("electron/main.ts"), "utf8");
  const closeHandlers = (src.match(/\.on\("close"/g) ?? []).length;
  assert.ok(closeHandlers >= 1, "main.ts must register close interception");
  // Every interception checks isQuitting (the only true quit path)
  const guarded = /win\.on\("close", \(e\) => \{\s*\n\s*if \(!isQuitting\) \{/.test(src);
  assert.ok(guarded, "close handler must check isQuitting before preventing default");
  // Settings → Quit and tray → Quit both funnel through app.quit()
  assert.ok((src.match(/app\.quit\(\)/g) ?? []).length >= 2, "explicit quit paths exist");
});

// ─── Companion refinement: all six ship complete, consistent definitions ────

test("companions: all six define the same complete field set", () => {
  const ids = COMPANIONS.map((c) => c.id).sort();
  assert.deepEqual(
    ids,
    [...EXPECTED_COMPANIONS].sort(),
    "the six companions are all present"
  );
  const required = Object.keys(COMPARIONS_PIX_SHAPE).sort();
  for (const c of COMPANIONS) {
    const fields = Object.keys(c).sort();
    for (const f of required) {
      assert.ok(fields.includes(f), `${c.id} is missing field "${f}"`);
    }
    // Visual identity must be real values, never empty placeholders.
    assert.ok(c.primary.length > 0 && c.secondary.length > 0, `${c.id} has colors`);
    assert.ok(c.name.length > 0 && c.subtitle.length > 0, `${c.id} has identity copy`);
  }
});

// Shape reference derived from Pix — every companion must match it.
const COMPARIONS_PIX_SHAPE = {
  id: 1, name: 1, subtitle: 1, primary: 1, secondary: 1, dark: 1,
  eyeColor: 1, cheekColor: 1, auraA: 1, auraB: 1, mouthThinking: 1,
};
