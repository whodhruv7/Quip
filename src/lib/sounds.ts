// Quip — Sound design (WebAudio, zero assets, roadmap UX-002)
// ─────────────────────────────────────────────────────────────────────────────
// Tiny synthesized blips: no audio files, no latency, fully offline. Each
// companion gets its own base pitch so the feedback feels *theirs*. Muted
// state persists in prefs; reduced-motion users also get quieter feedback.
// ─────────────────────────────────────────────────────────────────────────────

export type SoundKind =
  | "send" | "success" | "error" | "notify" | "quest" | "pop"
  | "hydrate" | "eye" | "posture" | "screen" | "askhelp";

const COMPANION_PITCH: Record<string, number> = {
  pix: 1.0, kai: 0.92, ren: 1.08, bubbles: 1.15, capy: 0.85, skales: 0.95,
};

let ctx: AudioContext | null = null;
let muted = false;

export function setSoundsMuted(value: boolean): void {
  muted = value;
}

export function soundsAreMuted(): boolean {
  return muted;
}

function ensureCtx(): AudioContext | null {
  if (muted) return null;
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function blip(freq: number, at: number, dur: number, gain: number, type: OscillatorType = "sine"): void {
  const audio = ensureCtx();
  if (!audio) return;
  const osc = audio.createOscillator();
  const g = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audio.currentTime + at);
  g.gain.setValueAtTime(0, audio.currentTime + at);
  g.gain.linearRampToValueAtTime(gain, audio.currentTime + at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + at + dur);
  osc.connect(g).connect(audio.destination);
  osc.start(audio.currentTime + at);
  osc.stop(audio.currentTime + at + dur + 0.02);
}

/** Play a feedback sound for the given companion (pitch-shifted). */
export function playSound(kind: SoundKind, companionId?: string): void {
  const pitch = COMPANION_PITCH[companionId ?? "pix"] ?? 1;
  switch (kind) {
    case "send":
      blip(520 * pitch, 0, 0.09, 0.05, "triangle");
      blip(700 * pitch, 0.05, 0.10, 0.04, "triangle");
      break;
    case "success":
      blip(523 * pitch, 0, 0.10, 0.05);
      blip(659 * pitch, 0.08, 0.10, 0.05);
      blip(784 * pitch, 0.16, 0.14, 0.05);
      break;
    case "error":
      blip(280 * pitch, 0, 0.14, 0.06, "square");
      blip(190 * pitch, 0.10, 0.18, 0.05, "square");
      break;
    case "notify":
      blip(880 * pitch, 0, 0.09, 0.045);
      blip(880 * pitch, 0.14, 0.09, 0.035);
      break;
    case "quest":
      blip(440 * pitch, 0, 0.08, 0.04, "triangle");
      blip(587 * pitch, 0.07, 0.12, 0.045, "triangle");
      break;
    case "pop":
      blip(980 * pitch, 0, 0.05, 0.03, "sine");
      break;
    // ── Care routines: every reminder has its own signature voice ──
    case "hydrate":
      // water droplet: quick descending plop with a soft after-ring
      blip(740 * pitch, 0, 0.07, 0.05, "sine");
      blip(520 * pitch, 0.06, 0.11, 0.045, "sine");
      blip(660 * pitch, 0.17, 0.09, 0.025, "sine");
      break;
    case "eye":
      // soft two-note chime, wide interval — "look away"
      blip(660 * pitch, 0, 0.12, 0.04, "triangle");
      blip(990 * pitch, 0.12, 0.16, 0.04, "triangle");
      break;
    case "posture":
      // low warm triad — stretchy, grounding
      blip(330 * pitch, 0, 0.16, 0.045, "triangle");
      blip(415 * pitch, 0.06, 0.16, 0.04, "triangle");
      blip(495 * pitch, 0.12, 0.2, 0.035, "triangle");
      break;
    case "screen":
      // gentle rising arpeggio — "time for the real world"
      blip(440 * pitch, 0, 0.1, 0.04);
      blip(554 * pitch, 0.09, 0.1, 0.04);
      blip(659 * pitch, 0.18, 0.14, 0.045);
      break;
    case "askhelp":
      // curious little question — up-then-higher blip
      blip(587 * pitch, 0, 0.07, 0.035, "triangle");
      blip(880 * pitch, 0.09, 0.1, 0.04, "triangle");
      break;
  }
}
