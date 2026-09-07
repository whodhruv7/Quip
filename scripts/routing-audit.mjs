// Routing audit against MASTER TODO required examples.
import { parseIntentV2 } from "../dist-test/electron/engine/intent-parser-v2.js";

const CASES = [
  "Open Chrome, go to YouTube, search for Mitwa and play it.",
  "Open VS Code and open my Quip project.",
  "Find the PDF on my Desktop and open it.",
  "Open Reddit and search for quip tips.",
  "Open X and find this post.",
  "Open my project folder and launch VS Code.",
  "find the pdf on my desktop",
  "find resume.pdf",
  "Open the folder on my Desktop.",
  "switch to chrome",
  "Close VS Code.",
  "copy this",
  "paste this",
  "click this",
  "scroll down",
  "type this",
  "Open Chrome",
  "Open YouTube",
  "Open YouTube and play Mitwa",
];

for (const input of CASES) {
  const r = parseIntentV2(input);
  const steps = r.steps.map((s) => `${s.action}(${s.target || s.params.query || s.params.url || s.params.text || ""})`).join(" -> ");
  console.log(`"${input}"`);
  console.log(`  isTask=${r.isTask} action=${r.action} steps=[${steps}] conf=${r.confidence}`);
}
