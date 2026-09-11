// Quip V3 — speech (TTS): the companion SPEAKS.
// ─────────────────────────────────────────────────────────────────────────────
// The user's ask: "make it able to speak through that models of ai … if
// openrouter has a problem then nvidia then groq — but somehow it should
// start talking." So the voice engine is a failover chain of its own:
//
//   1. Groq playai-tts   — real neural voice through the SAME Groq key.
//                          Returns wav bytes; the renderer plays them.
//   2. Windows SAPI      — the laptop's built-in System.Speech voice via
//                          PowerShell. Offline, zero setup, always there
//                          on Windows. Quip keeps talking even when every
//                          cloud provider is down.
//
// Honest failure: when neither engine can speak, the reason comes back as a
// plain string (never silent). Pure helpers are injectable for tests.
// ─────────────────────────────────────────────────────────────────────────────

import { spawn, type ChildProcess } from "node:child_process";

export type SpeakEngine = "auto" | "groq" | "local";

export interface SpeakConfig {
  enabled: boolean;
  engine: SpeakEngine;
  /** Groq playai-tts voice name (…-PlayAI). */
  voice: string;
  /** Optional Windows SAPI voice name. Empty = system default. */
  localVoice: string;
}

export interface SpeakOutcome {
  ok: boolean;
  /** Which engine actually produced (or attempted) the speech. */
  engine: "groq" | "local" | "none";
  /** Groq engine: wav audio for the renderer to play. */
  audioBase64?: string;
  mime?: string;
  /** Honest note — why the engine fell back or failed. */
  message: string;
  /** True when a fallback engine was used instead of the primary. */
  fellBack: boolean;
}

const GROQ_TTS_URL = "https://api.groq.com/openai/v1/audio/speech";
const GROQ_TTS_MODEL = "playai-tts";
const MAX_SPEAK_CHARS = 10_000;

type FetchLike = (url: string, init?: any) => Promise<any>;

// ─── Config (env-backed, live without restart) ──────────────────────────────

export function getSpeakConfig(): SpeakConfig {
  return {
    enabled: process.env.QUIP_SPEAK_ENABLED !== "0",
    engine: parseEngine(process.env.QUIP_SPEAK_ENGINE),
    voice: process.env.GROQ_TTS_VOICE || "Celeste-PlayAI",
    localVoice: process.env.QUIP_LOCAL_VOICE || "",
  };
}

function parseEngine(value: string | undefined): SpeakEngine {
  return value === "groq" || value === "local" ? value : "auto";
}

export function speakConfigEnvEntries(cfg: Partial<SpeakConfig>): Record<string, string> {
  const entries: Record<string, string> = {};
  if (cfg.enabled !== undefined) entries.QUIP_SPEAK_ENABLED = cfg.enabled ? "1" : "0";
  if (cfg.engine !== undefined) entries.QUIP_SPEAK_ENGINE = parseEngine(cfg.engine);
  if (cfg.voice !== undefined && cfg.voice.trim()) entries.GROQ_TTS_VOICE = cfg.voice.trim();
  if (cfg.localVoice !== undefined) entries.QUIP_LOCAL_VOICE = cfg.localVoice.trim();
  return entries;
}

// ─── Text prep ───────────────────────────────────────────────────────────────

/** Strip markdown, URLs and emoji so the voice reads clean sentences. */
export function sanitizeForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " (code) ") // code blocks → spoken placeholder
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // links → label
    .replace(/https?:\/\/\S+/g, " a link ")
    .replace(/[*_#>|~]+/g, " ")
    .replace(
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu,
      ""
    )
    .replace(/\s*([.!?])\s*/g, "$1 ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

// ─── Groq playai-tts ─────────────────────────────────────────────────────────

async function groqSpeak(
  text: string,
  voice: string,
  fetchImpl: FetchLike
): Promise<SpeakOutcome> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { ok: false, engine: "groq", message: "No Groq key — cannot use the Groq voice.", fellBack: false };
  }
  const input = text.slice(0, MAX_SPEAK_CHARS);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let res: any;
    try {
      res = await fetchImpl(GROQ_TTS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: GROQ_TTS_MODEL,
          voice,
          input,
          response_format: "wav",
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 1000) {
        return { ok: true, engine: "groq", audioBase64: buf.toString("base64"), mime: "audio/wav", message: "Groq voice.", fellBack: false };
      }
      return { ok: false, engine: "groq", message: "Groq returned empty audio.", fellBack: false };
    }

    // Honest reason — surface the provider's own words (e.g. playai terms).
    let detail = "";
    try {
      const body = await res.text();
      try {
        const json = JSON.parse(body);
        detail = json?.error?.message ?? json?.message ?? "";
      } catch {
        detail = body.slice(0, 140);
      }
    } catch {
      /* no body */
    }
    const hint =
      res.status === 401
        ? "the Groq key was rejected"
        : res.status === 429
          ? "Groq is rate limiting"
          : /terms|playai/i.test(detail)
            ? "one-time step needed: accept the PlayAI TTS terms at console.groq.com/playai"
            : `HTTP ${res.status}`;
    return {
      ok: false,
      engine: "groq",
      message: `Groq voice unavailable (${hint}).${detail ? ` — ${String(detail).replace(/\s+/g, " ").slice(0, 140)}` : ""}`,
      fellBack: false,
    };
  } catch (e: any) {
    const timedOut = e?.name === "AbortError" || /abort/i.test(String(e?.message ?? ""));
    return {
      ok: false,
      engine: "groq",
      message: timedOut ? "Groq voice timed out." : `Groq voice unreachable: ${String(e?.message ?? e).slice(0, 120)}`,
      fellBack: false,
    };
  }
}

// ─── Windows SAPI (local, offline, always there) ─────────────────────────────

const localSpeakers = new Set<ChildProcess>();

function psQuote(text: string): string {
  return text.replace(/'/g, "''");
}

/** Speak with the laptop's built-in voice. Resolves when speaking finishes. */
export function localSpeak(text: string, localVoice: string): Promise<SpeakOutcome> {
  const voiceLine = localVoice
    ? `$s.SelectVoice('${psQuote(localVoice)}') ;`
    : "";
  const script =
    `Add-Type -AssemblyName System.Speech ; ` +
    `$s = New-Object System.Speech.Synthesis.SpeechSynthesizer ; ` +
    voiceLine +
    `$s.Rate = 1 ; ` +
    `$s.Speak('${psQuote(text)}')`;

  return new Promise((resolve) => {
    let settled = false;
    let child: ChildProcess | null = null;
    const done = (outcome: SpeakOutcome) => {
      if (!settled) {
        settled = true;
        if (child) localSpeakers.delete(child);
        resolve(outcome);
      }
    };
    try {
      child = spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { windowsHide: true, stdio: "ignore" }
      );
      localSpeakers.add(child);
      child.on("error", (err) =>
        done({
          ok: false,
          engine: "local",
          message: `Local voice failed to start: ${String(err?.message ?? err).slice(0, 120)}`,
          fellBack: false,
        })
      );
      child.on("exit", (code) =>
        done(
          code === 0
            ? { ok: true, engine: "local", message: "Spoke with the laptop's built-in voice.", fellBack: true }
            : { ok: false, engine: "local", message: `Local voice exited with code ${code}.`, fellBack: false }
        )
      );
    } catch (e: any) {
      done({ ok: false, engine: "local", message: `Local voice error: ${String(e?.message ?? e).slice(0, 120)}`, fellBack: false });
    }
  });
}

/** Stop every local voice mid-sentence. */
export function stopSpeaking(): number {
  let stopped = 0;
  for (const child of localSpeakers) {
    try {
      child.kill();
      stopped++;
    } catch {
      /* already gone */
    }
  }
  localSpeakers.clear();
  return stopped;
}

/** True when the local SAPI engine can exist (Windows). */
export function localEngineAvailable(): boolean {
  return process.platform === "win32";
}

// ─── The chain ───────────────────────────────────────────────────────────────

/**
 * Speak text through the engine chain: Groq neural voice first (auto/groq),
 * Windows built-in voice as the automatic fallback (auto) or the forced
 * primary (local). Never throws — returns the honest outcome.
 */
export async function speakText(
  rawText: string,
  cfgOverride?: Partial<SpeakConfig>,
  fetchImpl: FetchLike = fetch
): Promise<SpeakOutcome> {
  const cfg = { ...getSpeakConfig(), ...cfgOverride };
  const text = sanitizeForSpeech(rawText);
  if (!text) {
    return { ok: false, engine: "none", message: "Nothing speakable in that text.", fellBack: false };
  }

  // Primary engine choice.
  const primary: "groq" | "local" =
    cfg.engine === "auto"
      ? process.env.GROQ_API_KEY
        ? "groq"
        : "local"
      : cfg.engine;

  if (primary === "groq") {
    const groq = await groqSpeak(text, cfg.voice, fetchImpl);
    if (groq.ok) return groq;
    // auto → fall through to local; forced groq → honest failure.
    if (cfg.engine === "groq") return groq;
    if (!localEngineAvailable()) {
      return { ...groq, message: `${groq.message} (No local voice on this OS.)` };
    }
    const local = await localSpeak(text, cfg.localVoice);
    return {
      ...local,
      message: local.ok ? `Spoke with the laptop's voice — ${groq.message}` : `${groq.message} ${local.message}`,
    };
  }

  // primary === "local"
  if (!localEngineAvailable()) {
    return { ok: false, engine: "none", message: "The built-in voice only exists on Windows.", fellBack: false };
  }
  return localSpeak(text, cfg.localVoice);
}

/** Convenience for a quick smoke test in the sandbox (not used by main). */
export async function groqVoiceProbe(fetchImpl: FetchLike): Promise<string> {
  const cfg = getSpeakConfig();
  const out = await groqSpeak("Quip speaking check.", cfg.voice, fetchImpl);
  return out.message;
}

