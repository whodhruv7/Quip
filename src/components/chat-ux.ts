// Quip — shared chat-UX helpers (renderer UX wave 2-a).
// ─────────────────────────────────────────────────────────────────────────────
// Tiny dependency-free utilities shared across the chat components:
//   - prefersReducedMotion()   OS setting check (respects prefers-reduced-motion)
//   - dispatchQuickTask(text)  the "make Quip DO this" contract — App listens
//                              for "quip:quick-task" and sends it through the
//                              SAME pipeline as typing (App.tsx).
//   - loadQuickReplies()       user-defined quick replies written by Settings
//                              (localStorage "quip.quickReplies"). Missing or
//                              invalid → [] — callers silently render nothing.
//   - useUxStyles()            one-time global <style> with the keyframes used
//                              by typing patterns / skeletons / search pulse /
//                              the voice orb. Idempotent; survives unmounts.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect } from "react";

/** True when the OS asks for reduced motion. Safe outside the renderer. */
export function prefersReducedMotion(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch {
    return false;
  }
}

/** Dispatch a task string through the normal chat pipeline. */
export function dispatchQuickTask(text: string): void {
  try {
    window.dispatchEvent(new CustomEvent<string>("quip:quick-task", { detail: text }));
  } catch {
    /* non-fatal — the event is best-effort */
  }
}

const QUICK_REPLIES_KEY = "quip.quickReplies";

/** User's custom quick replies (JSON array of strings). Invalid → []. */
export function loadQuickReplies(): string[] {
  try {
    const raw = localStorage.getItem(QUICK_REPLIES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .map((x) => x.trim())
      .slice(0, 8);
  } catch {
    return [];
  }
}

const UX_STYLE_ID = "quip-ux-styles";

const UX_KEYFRAMES = `
@keyframes quipTypingBounce { 0%, 80%, 100% { transform: translateY(0); opacity: .45; } 40% { transform: translateY(-3px); opacity: 1; } }
@keyframes quipTypingFade { 0%, 100% { opacity: .2; } 50% { opacity: 1; } }
@keyframes quipTypingBar { 0%, 100% { transform: scaleY(.35); } 50% { transform: scaleY(1); } }
@keyframes quipTypingRipple { 0% { transform: scale(.45); opacity: .7; } 100% { transform: scale(1.8); opacity: 0; } }
@keyframes quipTypingBreath { 0%, 100% { transform: scale(.8); opacity: .4; } 50% { transform: scale(1.2); opacity: .95; } }
@keyframes quipTypingWave { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
@keyframes quipSkeletonShimmer { 0% { background-position: -160px 0; } 100% { background-position: 160px 0; } }
@keyframes quipSearchPulse { 0% { box-shadow: 0 0 0 0 rgba(var(--quip-accent), 0.55); } 100% { box-shadow: 0 0 0 14px rgba(var(--quip-accent), 0); } }
@keyframes quipOrbBar { 0%, 100% { transform: scaleY(.3); } 50% { transform: scaleY(1); } }
.quip-search-hit { outline: 2px solid rgba(var(--quip-accent), 0.6); outline-offset: -2px; border-radius: 12px; animation: quipSearchPulse .8s ease-out 2; }
`;

/** Inject the shared keyframes exactly once (global <style> in <head>). */
export function ensureQuipUxStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(UX_STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = UX_STYLE_ID;
  el.textContent = UX_KEYFRAMES;
  document.head.appendChild(el);
}

/** React hook form of ensureQuipUxStyles — call from any component that
 *  renders one of the animated chat-UX pieces. */
export function useUxStyles(): void {
  useEffect(() => {
    ensureQuipUxStyles();
  }, []);
}
