// Tests: TDZ regression guard (F-28)
// ─────────────────────────────────────────────────────────────────────────────
// BUG F-28: "ReferenceError: Cannot access 'permission_modes_1' before
// initialization" crashed the main process at boot (main.js:45:9).
//
// ROOT CAUSE: tsc's CommonJS emit does NOT hoist import declarations above
// preceding top-level statements. electron/main.ts ran the §29 persisted-mode
// restore block at top level BEFORE the import that defines
// execPermissionSystem (engine/permission-modes) → in the compiled main.js the
// `const permission_modes_1 = require(...)` declaration sat ~50 lines BELOW
// the `permission_modes_1.permissionSystem.setMode(...)` call → Temporal Dead
// Zone → crash. Latent since the Action Engine round; it only surfaced once a
// fresh clone actually rebuilt dist-electron (older installs kept running a
// stale pre-bug main.js because the launcher skipped rebuilds).
//
// This suite enforces, permanently:
//   1. Source invariant — in electron/main.ts, every import whose binding is
//      read by top-level module-load code must be declared BEFORE that code.
//      (Direct check: permission-modes import line < §29 setMode use line.)
//   2. Compiled invariant — the full electron main process is recompiled to a
//      temp dir and scanned by scripts/tdz-audit.mjs, which detects ANY use of
//      a const/let require-binding at module-evaluation time before its
//      declaration, across ALL emitted files. Zero hazards must remain.
// ─────────────────────────────────────────────────────────────────────────────

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MAIN_TS = path.join(REPO, "electron", "main.ts");
const AUDIT = path.join(REPO, "scripts", "tdz-audit.mjs");
const TSC = path.join(REPO, "node_modules", "typescript", "bin", "tsc");

function firstIndexOf(src, needle) {
  const i = src.indexOf(needle);
  assert.notEqual(i, -1, `expected to find in main.ts: ${needle}`);
  return src.slice(0, i).split("\n").length; // 1-based line number
}

test("F-28 source invariant: permission-modes import sits ABOVE all top-level uses", () => {
  const src = fs.readFileSync(MAIN_TS, "utf8");
  const importLine = firstIndexOf(
    src,
    'import { permissionSystem as execPermissionSystem, type ApprovalRequest } from "./engine/permission-modes";'
  );
  const setModeUseLine = firstIndexOf(src, "execPermissionSystem.setMode(");
  assert.ok(
    importLine < setModeUseLine,
    `engine/permission-modes import (line ${importLine}) must be declared BEFORE ` +
      `the top-level execPermissionSystem.setMode use (line ${setModeUseLine}). ` +
      "tsc CJS emit does not hoist imports — moving it below top-level code " +
      "re-introduces the F-28 boot crash."
  );
});

test("F-28 compiled invariant: zero TDZ hazards across the whole compiled main process", () => {
  assert.ok(fs.existsSync(TSC), "typescript must be installed (npm install first)");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quip-tdz-"));
  try {
    // Compile with the REAL electron tsconfig; --outDir redirects to temp.
    execFileSync(process.execPath, [TSC, "-p", path.join(REPO, "electron", "tsconfig.json"), "--outDir", tmp], {
      cwd: REPO,
      stdio: "pipe",
      timeout: 120000,
    });
    const out = execFileSync(process.execPath, [AUDIT, tmp], {
      cwd: REPO,
      encoding: "utf8",
      timeout: 120000,
    });
    assert.match(out, /TDZ hazards\s*:\s*0/, `tdz-audit must report zero hazards.\n${out}`);
    assert.match(out, /RESULT\s*:\s*CLEAN/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("F-28 compiled order: emitted main.js declares permission_modes_1 before §29 use", () => {
  // Belt & braces on the artifact the app actually runs (skip on fresh clone
  // before first build — the compile-based test above already covers it).
  const built = path.join(REPO, "dist-electron", "electron", "main.js");
  if (!fs.existsSync(built)) return;
  const src = fs.readFileSync(built, "utf8");
  const declLine = firstIndexOf(src, 'permission_modes_1 = require("./engine/permission-modes")');
  const useLine = firstIndexOf(src, "permission_modes_1.permissionSystem.setMode(");
  assert.ok(declLine < useLine, `compiled require (line ${declLine}) must precede use (line ${useLine})`);
});
