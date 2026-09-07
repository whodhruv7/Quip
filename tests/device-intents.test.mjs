// Tests: device-control intent routing (windows, files, screen, site search)
import test from "node:test";
import assert from "node:assert/strict";
import { parseIntentV2 } from "../dist-test/electron/engine/intent-parser-v2.js";
import { permissionSystem, riskForStep } from "../dist-test/electron/engine/permission-modes.js";

test("screenshot request routes to screen capture", () => {
  const r = parseIntentV2("take a screenshot");
  assert.equal(r.action, "screen");
  assert.equal(r.steps[0].action, "screen");
  assert.equal(r.isTask, true);
});

test("list open windows routes to windows_list", () => {
  const r = parseIntentV2("show me the open windows");
  assert.equal(r.action, "windows_list");
});

test("minimize/maximize routes to window_control", () => {
  const min = parseIntentV2("minimize chrome");
  assert.equal(min.action, "window_control");
  assert.equal(min.steps[0].params.op, "minimize");
  assert.equal(min.steps[0].params.target, "chrome");

  const max = parseIntentV2("maximize the vs code window");
  assert.equal(max.action, "window_control");
  assert.equal(max.steps[0].params.op, "maximize");
});

test("move window routes with coordinates", () => {
  const r = parseIntentV2("move the chrome window to 100 200");
  assert.equal(r.action, "window_control");
  assert.equal(r.steps[0].params.op, "move");
  assert.equal(r.steps[0].params.x, "100");
  assert.equal(r.steps[0].params.y, "200");
});

test("double click and right click route with variant", () => {
  const dbl = parseIntentV2("double click at 300 400");
  assert.equal(dbl.steps[0].action, "click");
  assert.equal(dbl.steps[0].params.variant, "double");

  const rgt = parseIntentV2("right click at 10 20");
  assert.equal(rgt.steps[0].params.variant, "right");
});

test("file operations route to file_op with the right op", () => {
  const mkdir = parseIntentV2("create folder my-stuff");
  assert.equal(mkdir.action, "file_op");
  assert.equal(mkdir.steps[0].params.op, "mkdir");

  const read = parseIntentV2("read file notes.txt");
  assert.equal(read.steps[0].params.op, "read");

  const del = parseIntentV2("delete file old-notes.txt");
  assert.equal(del.steps[0].params.op, "delete");

  const copy = parseIntentV2("copy file report.txt to backups");
  assert.equal(copy.steps[0].params.op, "copy");
  assert.equal(copy.steps[0].params.to, "backups");

  const search = parseIntentV2("find file quip-config");
  assert.equal(search.steps[0].params.op, "search");
});

test("site search routes for reddit / x / github", () => {
  const reddit = parseIntentV2("search reddit for mechanical keyboards");
  assert.equal(reddit.action, "site_search");
  assert.equal(reddit.steps[0].params.site, "reddit");
  assert.equal(reddit.steps[0].params.query, "mechanical keyboards");

  const x = parseIntentV2("search x for ai news");
  assert.equal(x.steps[0].params.site, "x");

  const gh = parseIntentV2("search github for electron apps");
  assert.equal(gh.steps[0].params.site, "github");
});

test("generic web search is NOT hijacked by site search", () => {
  const r = parseIntentV2("search for best laptops 2026");
  assert.notEqual(r.action, "site_search");
});

test("clipboard copy still wins over file copy when clipboard is named", () => {
  const r = parseIntentV2('copy "hello world" to clipboard');
  assert.equal(r.action, "clipboard");
  assert.equal(r.steps[0].params.mode, "write");
});

test("quiz intent no longer exists (study features removed)", () => {
  const r = parseIntentV2("quiz me on photosynthesis");
  assert.notEqual(r.action, "quiz");
});

test("file_op risk is refined per operation", () => {
  assert.equal(riskForStep("file_op", { op: "delete" }), "dangerous");
  assert.equal(riskForStep("file_op", { op: "move" }), "dangerous");
  assert.equal(riskForStep("file_op", { op: "write" }), "medium");
  assert.equal(riskForStep("file_op", { op: "mkdir" }), "medium");
  assert.equal(riskForStep("file_op", { op: "read" }), "safe");
  assert.equal(riskForStep("file_op", { op: "search" }), "safe");
  assert.equal(riskForStep("window_control", { op: "minimize" }), "medium");
  assert.equal(riskForStep("screen", {}), "safe");
  assert.equal(riskForStep("windows_list", {}), "safe");
  assert.equal(riskForStep("site_search", {}), "safe");
});

test("delete-plan requires approval even in approve_task mode", () => {
  permissionSystem.setMode("approve_task");
  const needs = permissionSystem.stepsNeedApproval([
    { action: "file_op", params: { op: "delete" } },
  ]);
  assert.equal(needs, true);
});

test("read-only plans never nag", () => {
  permissionSystem.setMode("approve_task");
  const needs = permissionSystem.stepsNeedApproval([
    { action: "open_app", params: {} },
    { action: "site_search", params: {} },
    { action: "file_op", params: { op: "read" } },
  ]);
  assert.equal(needs, false);
});
