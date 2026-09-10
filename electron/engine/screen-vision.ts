// Quip Execution Engine V3 — Screen Vision (Skales computer-use pattern)
// ─────────────────────────────────────────────────────────────────────────────
// Port of Skales' actions/browser-control.ts vision loop — pointed at the
// user's REAL screen instead of a headless browser:
//
//   capture real screenshot (PowerShell CopyFromScreen)
//     → vision model (Groq llama-4 via the user's OWN Groq key)
//     → element found → {"x":…,"y":…} pixel coordinates
//     → REAL SetCursorPos + mouse_event click (desktop-controller)
//     → capture again → describe what changed → honest result
//
// This is how Quip clicks things it can SEE but has no API for — real
// screen, real mouse, no embedded browser, nothing simulated.
// ─────────────────────────────────────────────────────────────────────────────

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ActionVerification } from "./action-verifier";
import { executeDesktopAction } from "./desktop-controller";

/** Vision brain surface — ModelRouter.completeVision satisfies this. */
export interface VisionBrain {
  completeVision(prompt: string, imageBase64: string, mimeType: string, timeoutMs?: number): Promise<{ text: string }>;
}

let boundVision: VisionBrain | null = null;

/** Called by main.ts at boot: bind the real model router. */
export function bindVisionBrain(v: VisionBrain): void {
  boundVision = v;
}

function vision(): VisionBrain {
  if (!boundVision) throw new Error("Vision isn't available — the AI brain isn't connected.");
  return boundVision;
}

// ─── Real screenshot capture ─────────────────────────────────────────────────

async function captureScreenPng(): Promise<{ base64: string; file: string; width: number; height: number }> {
  const { app } = await import("electron");
  const dir = path.join(app.getPath("userData"), "screens");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `quip-vision-${Date.now()}.png`);

  const script =
    `Add-Type -AssemblyName System.Drawing; Add-Type -AssemblyName System.Windows.Forms; ` +
    `$b = [System.Windows.Forms.SystemInformation]::VirtualScreen; ` +
    `$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height; ` +
    `$g = [System.Drawing.Graphics]::FromImage($bmp); ` +
    `$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size); ` +
    `$bmp.Save('${file.replace(/\\/g, "\\\\")}'); ` +
    `Write-Output "$($b.Width)x$($b.Height)"; ` +
    `$g.Dispose(); $bmp.Dispose();`;

  const stdout = await new Promise<string>((resolve, reject) => {
    execFile("powershell", ["-NoProfile", "-Command", script], { timeout: 15_000 }, (err, so) => {
      if (err) reject(err);
      else resolve(String(so ?? ""));
    });
  });

  const sizeMatch = stdout.match(/(\d+)x(\d+)/);
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
    throw new Error("The screenshot didn't get saved — screen capture failed.");
  }
  return {
    base64: fs.readFileSync(file).toString("base64"),
    file,
    width: sizeMatch ? parseInt(sizeMatch[1]) : 0,
    height: sizeMatch ? parseInt(sizeMatch[2]) : 0,
  };
}

/** Keep only the last N vision screenshots (disk hygiene). */
function pruneOld(dir: string, keep: number): void {
  try {
    const files = fs.readdirSync(dir).filter((f) => f.startsWith("quip-vision-") && f.endsWith(".png")).sort();
    for (const f of files.slice(0, Math.max(0, files.length - keep))) {
      try { fs.unlinkSync(path.join(dir, f)); } catch { /* best effort */ }
    }
  } catch { /* best effort */ }
}

// ─── Coordinate parsing (Skales' strict JSON contract) ──────────────────────

export function parseCoords(raw: string): { x: number; y: number } | null {
  const match = raw.match(/\{\s*"x"\s*:\s*(-?\d+(?:\.\d+)?)\s*,\s*"y"\s*:\s*(-?\d+(?:\.\d+)?)\s*\}/);
  if (!match) return null;
  const x = Math.round(parseFloat(match[1]));
  const y = Math.round(parseFloat(match[2]));
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return null;
  // (0,0) is the exact screen corner — in practice always a vision failure,
  // never a real target. The models' "not found" answer is {"x":-1,"y":-1}
  // but 0,0 shows up when they hedge; treat both as not-found.
  if (x === 0 && y === 0) return null;
  return { x, y };
}

// ─── Public capabilities ─────────────────────────────────────────────────────

/** Look at the real screen and describe it. */
export async function observeScreen(): Promise<ActionVerification & { description?: string }> {
  let shot;
  try {
    shot = await captureScreenPng();
  } catch (e: any) {
    return { ok: false, summary: `I couldn't capture the screen: ${e?.message ?? e}`, evidence: [] };
  }
  try {
    const text = await visionComplete(
      "Describe what is currently on this screen in under 120 words: which apps/windows are open, what the active window shows, any visible buttons, dialogs or text worth noticing.",
      shot.base64
    );
    pruneOld(path.dirname(shot.file), 8);
    return {
      ok: true,
      summary: text.trim() || "I looked at the screen but the vision model returned nothing.",
      evidence: ["real screenshot", `vision model answered`],
      description: text.trim(),
    };
  } catch (e: any) {
    pruneOld(path.dirname(shot.file), 8);
    return {
      ok: false,
      summary: `I captured the screen but couldn't analyze it — ${e?.message ?? e}`,
      evidence: ["real screenshot captured", "vision call failed"],
    };
  }
}

async function visionComplete(prompt: string, base64: string): Promise<string> {
  const r = await vision().completeVision(prompt, base64, "image/png", 30_000);
  return r.text;
}

/**
 * Find a described element on the REAL screen and click it with the REAL mouse.
 * Returns an honest verification with before/after evidence.
 */
export async function screenClickElement(element: string): Promise<ActionVerification> {
  if (!element?.trim()) {
    return { ok: false, summary: "I need to know what to click.", evidence: [] };
  }
  let shot;
  try {
    shot = await captureScreenPng();
  } catch (e: any) {
    return { ok: false, summary: `I couldn't capture the screen: ${e?.message ?? e}`, evidence: [] };
  }

  let coords: { x: number; y: number } | null = null;
  try {
    const raw = await visionComplete(
      `This is a screenshot of the user's real screen (${shot.width}x${shot.height} pixels). ` +
      `Locate: "${element}". ` +
      `Return ONLY a compact JSON object like {"x":123,"y":456} with the pixel coordinates of its CENTER in this image. ` +
      `If it is not visible, return {"x":-1,"y":-1}. No other text.`,
      shot.base64
    );
    coords = parseCoords(raw);
  } catch (e: any) {
    return { ok: false, summary: `I couldn't analyze the screen — ${e?.message ?? e}`, evidence: ["vision call failed"] };
  }

  if (!coords) {
    return {
      ok: false,
      summary: `I looked at the screen but couldn't find "${element}". It may not be visible right now — try opening the right window first.`,
      evidence: ["real screenshot analyzed", "element not found"],
    };
  }

  const click = await executeDesktopAction({ type: "click", x: coords.x, y: coords.y });
  if (!click.ok) {
    return { ok: false, summary: `I found "${element}" at (${coords.x}, ${coords.y}) but the click failed.`, evidence: [...(click.evidence ?? []), `target: ${coords.x},${coords.y}`] };
  }

  // Give the UI a moment, then look again — honest "what changed" evidence.
  await new Promise((r) => setTimeout(r, 1200));
  let after = "";
  try {
    const shot2 = await captureScreenPng();
    after = await visionComplete(
      "A click was just performed on this screen. In one short sentence: what changed or loaded?",
      shot2.base64
    );
    pruneOld(path.dirname(shot2.file), 8);
  } catch { /* verification shot is best-effort — the click itself was real */ }

  return {
    ok: true,
    summary:
      `I found "${element}" at (${coords.x}, ${coords.y}) and clicked it.` +
      (after.trim() ? ` After: ${after.trim()}` : ""),
    evidence: [`real click at ${coords.x},${coords.y}`, ...(after.trim() ? ["post-click screen verified"] : [])],
  };
}

/**
 * Find a described input field on the REAL screen, click into it, type text.
 */
export async function screenTypeInto(element: string, text: string): Promise<ActionVerification> {
  if (!element?.trim() || !text) {
    return { ok: false, summary: "I need to know which field to type into and what to type.", evidence: [] };
  }
  let shot;
  try {
    shot = await captureScreenPng();
  } catch (e: any) {
    return { ok: false, summary: `I couldn't capture the screen: ${e?.message ?? e}`, evidence: [] };
  }

  let coords: { x: number; y: number } | null = null;
  try {
    const raw = await visionComplete(
      `This is a screenshot of the user's real screen (${shot.width}x${shot.height} pixels). ` +
      `Locate the input field: "${element}". ` +
      `Return ONLY a compact JSON object like {"x":123,"y":456} with the pixel coordinates of its CENTER in this image. ` +
      `If no such input field is visible, return {"x":-1,"y":-1}. No other text.`,
      shot.base64
    );
    coords = parseCoords(raw);
  } catch (e: any) {
    return { ok: false, summary: `I couldn't analyze the screen — ${e?.message ?? e}`, evidence: ["vision call failed"] };
  }

  if (!coords) {
    return {
      ok: false,
      summary: `I looked at the screen but couldn't find an input field like "${element}".`,
      evidence: ["real screenshot analyzed", "input field not found"],
    };
  }

  const click = await executeDesktopAction({ type: "click", x: coords.x, y: coords.y });
  if (!click.ok) {
    return { ok: false, summary: `I found the field at (${coords.x}, ${coords.y}) but couldn't click into it.`, evidence: click.evidence ?? [] };
  }
  await new Promise((r) => setTimeout(r, 400));

  const typed = await executeDesktopAction({ type: "type", text });
  return typed.ok
    ? { ok: true, summary: `I clicked the "${element}" field at (${coords.x}, ${coords.y}) and typed the text.`, evidence: [...(typed.evidence ?? []), `field at ${coords.x},${coords.y}`] }
    : { ok: false, summary: `I clicked into the field but typing failed — ${typed.summary}`, evidence: typed.evidence ?? [] };
}
