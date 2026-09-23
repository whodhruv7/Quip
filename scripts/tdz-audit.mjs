#!/usr/bin/env node
// TDZ Audit — detects "Cannot access 'X' before initialization" hazards in
// tsc-compiled CommonJS output (dist-electron).
//
// Bug class: TypeScript does NOT hoist `import` declarations above preceding
// top-level statements when emitting CommonJS. If module-evaluation-time code
// (top-level statements, plain blocks, if/for/try at top level) reads an
// import binding whose `const x_N = require(...)` declaration appears LATER
// in the file, the binding is in its Temporal Dead Zone -> startup crash.
//
// Method: per file, track brace depth with a context stack distinguishing
// deferred scopes (function bodies — safe) from immediate scopes (top level
// and plain blocks — evaluated at module load). Flag any read of a const/let
// require-binding that occurs on the immediate-execution path BEFORE its
// declaration line.

import fs from "node:fs";
import path from "node:path";

const root = process.argv[2] || "dist-electron";
const files = [];

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".js")) files.push(p);
  }
}
walk(root);

// tsc emit line forms we care about:
//   const x_1 = require("...");            (namespace import)
//   const x_1 = __importDefault(require("..."));
//   const x_1 = __importStar(require("..."));
//   let x_1 = require(...)                 (rare)
const DECL_RE = /^\s*(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:__importDefault\(|__importStar\()?require\(/;

function stripLineComment(line) {
  // naive but fine for generated code: cut at // not inside quotes
  let out = "";
  let inS = false, inD = false, inT = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i], p = line[i - 1];
    if (c === "'" && !inD && !inT && p !== "\\") inS = !inS;
    if (c === '"' && !inS && !inT && p !== "\\") inD = !inD;
    if (c === "`" && !inS && !inD && p !== "\\") inT = !inT;
    if (c === "/" && line[i + 1] === "/" && !inS && !inD && !inT) break;
    out += c;
  }
  return out;
}

let totalFlags = 0;
const flaggedFiles = new Set();

for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const lines = src.split("\n");

  // context stack: 'fn' = function body (deferred), 'blk' = plain block (immediate)
  // 'cls' = class body (field initializers deferred to construction; static
  //         blocks are rare in tsc output — accepted residual risk)
  const stack = [];
  const declLine = new Map(); // binding name -> first declaration line (top-level only)
  const flags = [];
  // Multi-line function signature tracking: tsc emits `function f(...) {` on
  // one line; arrow bodies too. Method shorthand same. So per-line analysis is
  // adequate for this emit style; we still carry the last-seen line content
  // for continuation lines (e.g. `const x = new Foo(\n` … `));`).
  let pendingCallDepth = 0; // inside an unclosed call across lines (still immediate scope)

  lines.forEach((rawLine, idx) => {
    const line = stripLineComment(rawLine);
    const lineNo = idx + 1;
    const inImmediate = !stack.includes("fn") && !stack.includes("cls");

    // ---- record uses (before processing braces of this line) -------------
    if (inImmediate) {
      for (const [name, declAt] of declLine) {
        if (declAt === undefined) continue;
        if (lineNo <= declAt) continue;
        continue; // declared already — safe (use-after-decl)
      }
      // find identifiers used on this line that have a PENDING declaration later
      // we handle this after collecting all decls: two-pass per file below
    }

    // ---- collect declaration on this line (top-level only) ---------------
    if (inImmediate && pendingCallDepth === 0) {
      const m = line.match(DECL_RE);
      if (m && !declLine.has(m[1])) declLine.set(m[1], lineNo);
    }

    // ---- brace/context tracking ------------------------------------------
    let i = 0;
    const n = line.length;
    while (i < n) {
      const c = line[i];
      if (c === "'" || c === '"' || c === "`") {
        const q = c; i++;
        while (i < n && line[i] !== q) { if (line[i] === "\\") i++; i++; }
        i++; continue;
      }
      if (c === "/" && line[i + 1] === "*") { i += 2; while (i < n && !(line[i] === "*" && line[i + 1] === "/")) i++; i += 2; continue; }
      if (c === "(") { pendingCallDepth++; i++; continue; }
      if (c === ")") { pendingCallDepth = Math.max(0, pendingCallDepth - 1); i++; continue; }
      if (c === "{") {
        // decide: function body or plain block?
        const before = line.slice(0, i);
        const isFn =
          /function\s*[\w$]*\s*\([^)]*\)\s*$/.test(before.trim()) ||
          /\)\s*=>\s*$/.test(before.trim()) ||
          /^\s*[\w$]+\s*\([^)]*\)\s*\{?\s*$/.test(before.trim()) && /this\.|super\(|private|public|protected/.test(lines[idx]) === false && stack.includes("cls");
        // tsc emit: method shorthand only inside class bodies; top-level
        // `name(args) {` never occurs at top level in this codebase.
        stack.push(isFn ? "fn" : "blk");
        i++; continue;
      }
      if (c === "}") { stack.pop(); i++; continue; }
      i++;
    }
  });

  // ---- second pass: flag immediate-scope uses that precede declaration ----
  // Re-scan with decl map known; a use is an identifier token read at
  // immediate depth on a line BEFORE the declaration line.
  const state = { stack: [], pendingCallDepth: 0 };
  lines.forEach((rawLine, idx) => {
    const line = stripLineComment(rawLine);
    const lineNo = idx + 1;
    const inImmediate = !state.stack.includes("fn") && !state.stack.includes("cls");
    if (inImmediate && state.pendingCallDepth === 0) {
      // declaration line itself is not a "use"
      let declNameHere = null;
      const m = line.match(DECL_RE);
      if (m) declNameHere = m[1];
      for (const [name, declAt] of declLine) {
        if (declNameHere === name) continue;
        if (lineNo >= declAt) continue; // use at/before own decl only matters strictly before
        // match identifier as a whole word, not preceded by `.` or in a string
        const re = new RegExp(`(?<![\\w$.'"])${name}(?![\\w$])`, "g");
        let mm;
        while ((mm = re.exec(line)) !== null) {
          flags.push({ line: lineNo, name, declAt, text: rawLine.trim().slice(0, 110) });
          totalFlags++; flaggedFiles.add(file);
          break;
        }
      }
    }
    // replicate context tracking
    let i = 0; const n = line.length;
    while (i < n) {
      const c = line[i];
      if (c === "'" || c === '"' || c === "`") {
        const q = c; i++;
        while (i < n && line[i] !== q) { if (line[i] === "\\") i++; i++; }
        i++; continue;
      }
      if (c === "/" && line[i + 1] === "*") { i += 2; while (i < n && !(line[i] === "*" && line[i + 1] === "/")) i++; i += 2; continue; }
      if (c === "(") { state.pendingCallDepth++; i++; continue; }
      if (c === ")") { state.pendingCallDepth = Math.max(0, state.pendingCallDepth - 1); i++; continue; }
      if (c === "{") {
        const before = line.slice(0, i).trim();
        const isFn =
          /function\s*[\w$]*\s*\([^)]*\)$/.test(before) ||
          /\)\s*=>\s*$/.test(before) ||
          (state.stack.includes("cls") && /^[\w$]+\s*\([^)]*\)$/.test(before) && !/^(if|for|while|switch|catch)\b/.test(before));
        state.stack.push(isFn ? "fn" : "blk");
        i++; continue;
      }
      if (c === "}") { state.stack.pop(); i++; continue; }
      i++;
    }
  });

  if (flags.length) {
    console.log(`\n✗ ${file}`);
    for (const f of flags) {
      console.log(`   line ${f.line}: uses '${f.name}' (declared at line ${f.declAt})`);
      console.log(`     > ${f.text}`);
    }
  }
}

console.log("\n────────────────────────────────────────────");
console.log(`Files scanned : ${files.length}`);
console.log(`TDZ hazards   : ${totalFlags}`);
console.log(totalFlags === 0 ? "RESULT        : CLEAN ✓" : `RESULT        : ${flaggedFiles.size} file(s) affected ✗`);
process.exit(totalFlags === 0 ? 0 : 1);
