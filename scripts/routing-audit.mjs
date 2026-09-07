// Routing audit against the MASTER ENGINEERING PROMPT command matrix.
// Covers every device-control family + context follow-ups + negative cases
// (things that must NOT auto-execute).
import { parseIntentV2 } from "../dist-test/electron/engine/intent-parser-v2.js";
import { contextStore } from "../dist-test/electron/engine/context-store.js";

let pass = 0, fail = 0;
function expect(input, opts) {
  const r = parseIntentV2(input, { context: contextStore.get() });
  const steps = r.steps.map((s) => s.action).join(",");
  const detail = r.steps
    .map((s) => `${s.action}(${s.target || s.params.query || s.params.url || s.params.text || s.params.keys || ""})`)
    .join(" -> ");
  let ok = true;
  const problems = [];
  if (opts.expectTask !== undefined && r.isTask !== opts.expectTask) {
    ok = false;
    problems.push(`isTask=${r.isTask} want ${opts.expectTask}`);
  }
  if (opts.firstStep && r.steps[0]?.action !== opts.firstStep) {
    ok = false;
    problems.push(`first=${r.steps[0]?.action} want ${opts.firstStep}`);
  }
  if (opts.contains && !steps.includes(opts.contains)) {
    ok = false;
    problems.push(`steps=[${steps}] missing ${opts.contains}`);
  }
  if (opts.notContains && steps.includes(opts.notContains)) {
    ok = false;
    problems.push(`steps=[${steps}] must NOT contain ${opts.notContains}`);
  }
  if (opts.notFirst && r.steps[0]?.action === opts.notFirst) {
    ok = false;
    problems.push(`first=${r.steps[0]?.action} must not be ${opts.notFirst}`);
  }
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  "${input}"  → ${detail}${problems.length ? "  << " + problems.join("; ") : ""}`);
}

// ── Applications ─────────────────────────────────────────────────────────────
expect("Open VS Code", { expectTask: true, firstStep: "open_app", notContains: "search_web" });
expect("open chrome", { expectTask: true, firstStep: "open_app" });
expect("Close VS Code", { expectTask: true, firstStep: "close_app" });
expect("quit chrome", { expectTask: true, firstStep: "close_app" });
expect("focus chrome", { expectTask: true, firstStep: "focus_app" });
expect("switch to chrome", { expectTask: true, firstStep: "focus_app" });

// ── Windows ──────────────────────────────────────────────────────────────────
expect("minimize chrome", { expectTask: true, firstStep: "window_control" });
expect("maximize the vs code window", { expectTask: true, firstStep: "window_control" });
expect("move chrome window to 100,200", { expectTask: true, firstStep: "window_control" });
expect("resize the chrome window to 1200x800", { expectTask: true, firstStep: "window_control" });
expect("what windows are open", { expectTask: true, firstStep: "windows_list" });

// ── Files / folders ──────────────────────────────────────────────────────────
expect("find the pdf on my desktop", { expectTask: true, firstStep: "file_op", notContains: "search_web" });
expect("find resume.pdf and open it", { expectTask: true, firstStep: "file_op" });
expect("open my quip project", { expectTask: true, firstStep: "open_folder", notContains: "search_web" });
expect("open downloads", { expectTask: true, firstStep: "open_folder" });
expect("create a folder called projects", { expectTask: true, firstStep: "file_op" });
expect("delete the file temp.txt", { expectTask: true, firstStep: "file_op" });
expect("read the file notes.txt", { expectTask: true, firstStep: "file_op" });
expect("show me the file notes.txt", { expectTask: true, firstStep: "file_op" });

// ── Mouse ────────────────────────────────────────────────────────────────────
expect("click at 400,300", { expectTask: true, firstStep: "click" });
expect("click this", { expectTask: true, firstStep: "click" });
expect("double click at 400,300", { expectTask: true, firstStep: "click" });
expect("right click at 400,300", { expectTask: true, firstStep: "click" });
expect("scroll down", { expectTask: true, firstStep: "scroll" });
expect("scroll up 3", { expectTask: true, firstStep: "scroll" });
expect("drag from 100,200 to 300,400", { expectTask: true, firstStep: "drag" });
expect("move mouse to 500,300", { expectTask: true, firstStep: "mouse_move" });

// ── Keyboard ─────────────────────────────────────────────────────────────────
expect("type hello world", { expectTask: true, firstStep: "type_text" });
expect("press enter", { expectTask: true, firstStep: "press_key" });
expect("press ctrl+c", { expectTask: true, firstStep: "press_key" });

// ── Clipboard ────────────────────────────────────────────────────────────────
expect("copy hello world to clipboard", { expectTask: true, firstStep: "clipboard" });
expect("copy this", { expectTask: true, firstStep: "press_key" });
expect("copy this to clipboard", { expectTask: true, firstStep: "press_key" });
expect("paste this", { expectTask: true, firstStep: "press_key" });
expect("what's on my clipboard", { expectTask: true, firstStep: "clipboard" });

// ── Screen ───────────────────────────────────────────────────────────────────
expect("take a screenshot", { expectTask: true, firstStep: "screen" });
expect("screenshot", { expectTask: true, firstStep: "screen" });

// ── Web / browser / media ────────────────────────────────────────────────────
expect("Open YouTube", { expectTask: true, firstStep: "open_website" });
expect("Open YouTube and play Mitwa", { expectTask: true, contains: "play_media" });
expect("Open Chrome, go to YouTube, search for Mitwa and play it.", { expectTask: true, contains: "play_media" });
expect("play mitwa", { expectTask: true, firstStep: "play_media" });
expect("go and play the song mitwa", { expectTask: true, contains: "play_media" });
expect("play i want it that way", { expectTask: true, contains: "play_media" });
expect("search youtube for lofi beats", { expectTask: true, firstStep: "site_search" });
expect("search reddit for quip tips", { expectTask: true, firstStep: "site_search" });
expect("search x for quip", { expectTask: true, firstStep: "site_search" });
expect("read this reddit page", { expectTask: true, firstStep: "read_page" });
expect("open github", { expectTask: true, firstStep: "open_website" });

// ── Multi-step chains ────────────────────────────────────────────────────────
expect("Open VS Code and open my Quip project.", { expectTask: true, contains: "open_app" });
expect("Open Reddit and search for quip tips.", { expectTask: true, contains: "site_search" });
expect("open notepad and type hello world", { expectTask: true, contains: "type_text" });
expect("click here and then scroll down", { expectTask: true, contains: "scroll" });
expect("open chrome and close edge", { expectTask: true, contains: "close_app" });

// ── Context follow-ups (needs prior context) ────────────────────────────────
contextStore.update({ lastMediaQuery: "mitwa", activeWebsite: "youtube" });
expect("play it", { expectTask: true, contains: "play_media" });
contextStore.reset();

// ── NEGATIVE: must stay chat — never auto-execute ───────────────────────────
expect("display settings", { expectTask: true, firstStep: "system_action" }); // opening settings IS the right action
expect("what does this display", { expectTask: false });
expect("screenplay ideas", { expectTask: false });
expect("show me the weather", { expectTask: false });
expect("how was your day", { expectTask: false });
expect("tell me a joke", { expectTask: false });
expect("the play was amazing", { expectTask: false });
expect("I listen to music while working", { expectTask: false });
expect("who is the best player", { expectTask: false });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
