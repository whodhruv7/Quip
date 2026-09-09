// Tests: companion system — exactly 6 companions, one shared system
import test from "node:test";
import assert from "node:assert/strict";
import { COMPANIONS, getCompanion } from "../dist-test/src/lib/companion-config.js";

// Pix, Kai, Ren are Quip originals; Bubbles, Capy, Ivy joined from Skales.
const EXPECTED_IDS = ["pix", "kai", "ren", "bubbles", "capy", "skales"];

test("Quip has exactly 6 companions", () => {
  assert.equal(COMPANIONS.length, 6);
  assert.deepEqual(
    COMPANIONS.map((c) => c.id).sort(),
    [...EXPECTED_IDS].sort()
  );
});

test("originals Pix, Kai and Ren remain functional (ren replaced old 'zee')", () => {
  for (const id of ["pix", "kai", "ren"]) {
    const c = getCompanion(id);
    assert.equal(c.id, id);
    assert.ok(c.name.length > 0);
  }
  // The old "zee" id no longer exists as a real companion — it falls back to pix
  assert.equal(getCompanion("zee").id, "pix");
  assert.equal(getCompanion("ren").id, "ren");
});

test("The real Skales companions (bubbles, capy, skales) are first-class — exactly 6 total", () => {
  assert.equal(getCompanion("bubbles").name, "Bubbles");
  assert.equal(getCompanion("capy").name, "Capy");
  assert.equal(getCompanion("skales").name, "Skales");
});

test("every companion has complete theme fields in Quip's palette", () => {
  for (const companion of COMPANIONS) {
    assert.ok(companion.id, "id");
    assert.ok(companion.name, `name for ${companion.id}`);
    assert.ok(companion.subtitle, `subtitle for ${companion.id}`);
    assert.ok(companion.primary.startsWith("#"), `primary hex for ${companion.id}`);
    assert.ok(companion.secondary.startsWith("#") || companion.secondary.startsWith("rgba"), `secondary for ${companion.id}`);
    assert.ok(companion.dark.startsWith("#"), `dark for ${companion.id}`);
    assert.ok(companion.eyeColor, `eyeColor for ${companion.id}`);
    assert.ok(companion.auraA, `auraA for ${companion.id}`);
    assert.ok(companion.mouthThinking, `mouthThinking for ${companion.id}`);
  }
});

test("all 6 companions have distinct primary colors (visual identity)", () => {
  const primaries = COMPANIONS.map((c) => c.primary);
  assert.equal(new Set(primaries).size, 6, "primary colors should be unique");
});

test("no companion uses the broken all-black theme", () => {
  for (const companion of COMPANIONS) {
    assert.notEqual(companion.primary, "#1a1a1a");
  }
});

test("getCompanion falls back to pix for unknown ids", () => {
  const c = getCompanion("not-a-companion");
  assert.equal(c.id, "pix");
});
