// Tests: companion theme config completeness (pix / kai / zee aligned)
import test from "node:test";
import assert from "node:assert/strict";
import { COMPANIONS, getCompanion } from "../dist-test/src/lib/companion-config.js";

const EXPECTED_IDS = ["pix", "kai", "zee"];

test("companions are exactly pix, kai, zee — no stray 'ren' ID", () => {
  assert.deepEqual(
    COMPANIONS.map((c) => c.id).sort(),
    [...EXPECTED_IDS].sort()
  );
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

test("getCompanion falls back to pix for unknown ids", () => {
  const c = getCompanion("not-a-companion");
  assert.equal(c.id, "pix");
});

test("zee no longer uses the broken all-black theme", () => {
  const zee = getCompanion("zee");
  assert.notEqual(zee.primary, "#1a1a1a");
});
