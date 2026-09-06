// Tests: risk-based permission gates
import test from "node:test";
import assert from "node:assert/strict";
import {
  permissionSystem,
  getRiskLevel,
} from "../dist-test/electron/engine/permission-modes.js";

test("opening apps/folders/sites is SAFE — never nags in any mode", () => {
  for (const action of ["open_app", "open_website", "open_folder", "open_url", "search_web", "search_youtube", "read_page", "play_media", "focus_app"]) {
    assert.equal(getRiskLevel(action), "safe", `${action} should be safe`);
  }
});

test("sending emails/messages + destructive ops are dangerous — always confirm", () => {
  for (const action of ["compose_email", "compose_message", "send_email", "send_message", "delete_file", "move_file", "run_command", "payment", "system_shutdown"]) {
    assert.equal(getRiskLevel(action), "dangerous", `${action} should be dangerous`);
  }
});

test("interactive input actions are medium risk", () => {
  for (const action of ["type_text", "press_key", "click", "close_app", "drag"]) {
    assert.equal(getRiskLevel(action), "medium", `${action} should be medium`);
  }
});

test("ask_every_time mode: safe actions run without confirmation, medium ask", () => {
  permissionSystem.setMode("ask_every_time");
  assert.equal(permissionSystem.needsConfirmation("open_app"), false);
  assert.equal(permissionSystem.needsConfirmation("type_text"), true);
  assert.equal(permissionSystem.needsConfirmation("delete_file"), true);
});

test("full_access mode: only dangerous actions confirm", () => {
  permissionSystem.setMode("full_access");
  assert.equal(permissionSystem.needsConfirmation("open_app"), false);
  assert.equal(permissionSystem.needsConfirmation("type_text"), false);
  assert.equal(permissionSystem.needsConfirmation("delete_file"), true);
});

test("plan risk uses the highest step risk", () => {
  permissionSystem.setMode("full_access");
  assert.equal(permissionSystem.planRisk(["open_app", "open_website"]), "safe");
  assert.equal(permissionSystem.planRisk(["open_app", "type_text"]), "medium");
  assert.equal(permissionSystem.planRisk(["open_app", "delete_file"]), "dangerous");
});

test("plan approval in approve_task mode: safe plans auto-run", () => {
  permissionSystem.setMode("approve_task");
  assert.equal(permissionSystem.planNeedsApproval(["open_app"]), false);
  assert.equal(permissionSystem.planNeedsApproval(["type_text"]), true);
  assert.equal(permissionSystem.planNeedsApproval(["delete_file"]), true);
});

test("safe actions never block in requestApproval", async () => {
  permissionSystem.setMode("ask_every_time");
  const result = await permissionSystem.requestApproval("Open YouTube", ["Open YouTube"], "safe");
  assert.equal(result.approved, true);
});
