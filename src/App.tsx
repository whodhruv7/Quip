// Quip V2 — application root.
//
// THREE WINDOW MODES (mirrored in the Electron main process):
//
//   companion — Quip boots as a small desktop companion. ONLY the selected
//               companion sprite is on screen, floating calmly, draggable.
//   panel     — tap the companion: a small panel opens BESIDE it (left),
//               with a square expand button in the top bar.
//   full      — the square expand button opens the full Quip app: a calm
//               two-column layout (companion stage + chat) in Quip's theme.
//
// Closing the panel or the full app always returns to the single companion.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Companion } from "@/components/Companion";
import { TopBar } from "@/components/TopBar";
import { ChatLayout } from "@/components/ChatLayout";
import { ChatWelcome } from "@/components/ChatWelcome";
import { ChatInput } from "@/components/ChatInput";
import { ScanOverlay } from "@/components/ScanOverlay";
import { SettingsPanel } from "@/components/SettingsPanel";
import { WeeklyReflection } from "@/components/WeeklyReflection";
import { ActionApprovalPanel } from "@/components/ActionApprovalPanel";
import { QuipSay } from "@/components/QuipSay";
import { Toaster, pushToast } from "@/components/Toaster";
import { QuestCard } from "@/components/QuestCard";
import { ErrorBar } from "@/components/ErrorBar";
import { HistoryDrawer } from "@/components/HistoryDrawer";
import { CommandPalette, ShortcutsOverlay, buildPaletteActions } from "@/components/CommandPalette";
import { FirstRunTour } from "@/components/FirstRunTour";
import { playSound, setSoundsMuted } from "@/lib/sounds";
import { applyTheme, applyThemeExtras, applyUIScale, applyDensity, applyCompanionTint } from "@/lib/theme";
import { useChat } from "@/hooks/useChat";
import { useWindowDrag } from "@/hooks/useWindowDrag";
import {
  loadPrefs,
  savePrefs,
  loadCurrentMessages,
  saveCurrentMessages,
} from "@/lib/storage";
import { getCompanion } from "@/lib/companion-config";
import type { WindowMode } from "../electron/shared";
import type {
  ChatMessage,
  CompanionId,
  PixState,
} from "@/types";

// ─── Layout constants ───────────────────────────────────────────────────────
const COMPANION_SIZE = 72;          // sprite size in companion/panel modes
const STAGE_COMPANION_SIZE = 168;   // sprite size in the full app stage
const PANEL_GAP = 8;                // gap between panel card and companion
const PANEL_MARGIN = 12;

// UX-047: welcome-back greetings (6 variants per companion, Hinglish-friendly).
const GREETINGS: Record<CompanionId, string[]> = {
  pix: [
    "Wapas aa gaye! Kya karna hai? 😄",
    "Main yahin tha — bolo, kya banayein aaj?",
    "Missed you! Ready for the next thing?",
  ],
  kai: [
    "Welcome back. Shall we continue where we left off?",
    "Aa gaye aap — chaliye, aage badhein.",
    "Good to see you. What shall we look at?",
  ],
  ren: [
    "Back already? I like the energy! ⚡",
    "Naya mission? Bhejo!",
    "The explorer returns — where to next?",
  ],
  bubbles: [
    "Hehe, you're back! 🎈",
    "Yay! Kya karein aaj?",
    "Bubbles missed you! Let's do something fun.",
  ],
  capy: [
    "Easy does it. Welcome back. 🌿",
    "Sab shaant hai. Bolo, kya karna hai?",
    "Slow and steady — what's on your mind?",
  ],
  skales: [
    "Sssup! Back on the desk? 🦎",
    "Wapas aa gaye — kaam shuru karein?",
    "The gecko kept your seat warm. What's the plan?",
  ],
};

export default function App() {
  const [companionId, setCompanionId] = useState<CompanionId>(() => loadPrefs().companionId);
  const [viewMode, setViewMode] = useState<WindowMode>("companion");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reflectionOpen, setReflectionOpen] = useState(false);
  const [scanDone, setScanDone] = useState(() => loadPrefs().scanned ?? false);
  const [hovering, setHovering] = useState(false);
  const [moodSpeed, setMoodSpeed] = useState(1);
  const [cosmetics, setCosmetics] = useState<string[]>([]);
  const [unlockToast, setUnlockToast] = useState<string | null>(null);

  // UX-012: pinned message strip above the composer (persisted in prefs).
  const [pinnedMessage, setPinnedMessage] = useState<{ id: string; text: string } | null>(() => loadPrefs().pinnedMessage ?? null);
  const [pinExpanded, setPinExpanded] = useState(false);
  // UX-031: first-run tour — shown once after the first scan completes.
  const [tourOpen, setTourOpen] = useState(false);

  const [restoredMessages, setRestoredMessages] = useState<ChatMessage[]>(() =>
    loadCurrentMessages(companionId)
  );
  const [quipSay, setQuipSay] = useState<string | null>(null);

  const { messages, busy: chatBusy, error, errorKind, taskOutcome, send, newChat, clearError, approvalRequest, resolveApproval, taskProgress, cancelTask, streamingProvider, retryLast, sessions, openSession } =
    useChat(companionId, restoredMessages);

  // ── History drawer (archived chats) ──
  const [historyOpen, setHistoryOpen] = useState(false);

  // Settings can open straight to a tab (e.g. "ai" from the no-key banner).
  const [settingsTab, setSettingsTab] = useState<"ai" | "general" | "problems" | "appearance">("general");
  const openSettings = useCallback((tab: "ai" | "general" | "problems" | "appearance" = "general") => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, []);

  // ── Care routines: themed reminders, each with its own signature sound ──
  useEffect(() => {
    const off = window.quip.onCareEvent((ev) => {
      playSound(ev.sound, companionId);
      pushToast({ title: ev.title, body: ev.body, kind: "info", ttl: 9000 });
    });
    return off;
  }, [companionId]);

  // ── App watcher: the user opened a new app → Quip offers help ──
  useEffect(() => {
    const off = window.quip.onAppNotice((n) => {
      playSound("askhelp", companionId);
      setQuipSay(`${n.appName}? Need any help?`);
      pushToast({
        title: `${n.appName} opened`,
        body: "Need any help with this one?",
        kind: "quest",
        ttl: 10000,
        actions: [
          { label: "Open it", onClick: () => { void window.quip.focusApp(n.appName); } },
          { label: "I'm good", onClick: () => {} },
        ],
      });
    });
    return off;
  }, [companionId]);

  // ── Ghost Cursor theme sync — the magical hand wears the active theme ──
  useEffect(() => {
    const push = () => {
      try {
        const cs = getComputedStyle(document.documentElement);
        const accent = cs.getPropertyValue("--quip-accent").trim();
        const accent2 = cs.getPropertyValue("--quip-accent-2").trim();
        if (accent && accent2) {
          window.quip.setGhostCursorStyle({ accent, accent2, companion: companionId });
        }
      } catch {
        /* cosmetic only */
      }
    };
    push();
    window.addEventListener("quip:theme-changed", push);
    return () => window.removeEventListener("quip:theme-changed", push);
  }, [companionId]);

  // ─── Autonomy UX: palette, shortcuts, sounds, watch toasts ─────────
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useEffect(() => {
    try {
      setSoundsMuted(loadPrefs().soundsMuted ?? false);
    } catch {
      /* default unmuted */
    }
  }, []);
  // Downloads-watch auto-moves → honest toast for every auto-move (UX-030).
  useEffect(() => {
    const off = (window as any).quip?.onWatchEvent?.((e: { dir: string; moved: { name: string; to: string }[] }) => {
      if (!e?.moved?.length) return;
      pushToast({
        title: `Auto-organized ${e.moved.length} new file(s)`,
        body: e.moved.slice(0, 3).map((m) => `${m.name} → ${m.to.split(/[\\/]/).slice(-2).join("/")}`).join("\n"),
        kind: "success",
      });
      playSound("notify", companionId);
    });
    return () => off?.();
  }, [companionId]);
  // Palette quick-task → the SAME pipeline as typing (send through useChat).
  useEffect(() => {
    const onQuickTask = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (typeof detail === "string" && detail.trim()) send(detail.trim());
    };
    window.addEventListener("quip:quick-task", onQuickTask);
    return () => window.removeEventListener("quip:quick-task", onQuickTask);
  }, [send]);

  // ─── Appearance extras: type scale, density, accent override, tint ─────
  // Applied once at boot (persisted in prefs + theme.ts localStorage keys).
  useEffect(() => {
    const p = loadPrefs();
    if (p.uiSize) applyUIScale(p.uiSize);
    if (p.density) applyDensity(p.density);
    applyThemeExtras();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Companion tint follows the active companion while the toggle is ON.
  useEffect(() => {
    if (!loadPrefs().companionTint) return;
    applyCompanionTint(getCompanion(companionId).primary);
  }, [companionId]);

  // ─── UX-018: tray integration — window.quip.onAutoTask ─────────────────
  // task === ""  → tray "New task": surface the composer and focus it.
  // non-empty    → sent through the SAME chat pipeline as typing.
  useEffect(() => {
    type AutoTaskAPI = { onAutoTask?: (cb: (payload: { task: string }) => void) => () => void };
    let off: (() => void) | undefined;
    try {
      off = (window.quip as unknown as AutoTaskAPI).onAutoTask?.((payload) => {
        const task = String(payload?.task ?? "");
        // Bigger stays bigger; companion grows to the panel so it's visible.
        setViewMode((m) => (m === "companion" ? "panel" : m));
        if (task === "") {
          try {
            window.dispatchEvent(new CustomEvent("quip:focus-composer"));
          } catch {
            /* non-fatal */
          }
        } else {
          send(task);
        }
      });
    } catch {
      /* non-fatal — tray auto-task unavailable */
    }
    return () => off?.();
  }, [send]);

  // ─── UX-029: error toast with a real Retry action ──────────────────────
  // Only for retryable failures; "no-key" keeps its Add-key button banner.
  const lastErrorToasted = useRef<string | null>(null);
  useEffect(() => {
    if (!error || errorKind === "no-key") return;
    if (lastErrorToasted.current === error) return; // one toast per failure
    lastErrorToasted.current = error;
    pushToast({
      title: "That didn't go through",
      body: error,
      kind: "error",
      ttl: 9000,
      actions: [{ label: "Retry", onClick: () => retryLast() }],
    });
  }, [error, errorKind, retryLast]);
  useEffect(() => {
    if (!error) lastErrorToasted.current = null;
  }, [error]);

  // ─── UX-047: welcome-back greeting after ≥5 minutes away ───────────────
  const hiddenAtRef = useRef<number | null>(null);
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAtRef.current = Date.now();
        return;
      }
      const awayMs = hiddenAtRef.current ? Date.now() - hiddenAtRef.current : 0;
      hiddenAtRef.current = null;
      if (awayMs >= 5 * 60_000) {
        const lines = GREETINGS[companionId] ?? GREETINGS.pix;
        // Text only — no extra animation, which also respects reduced motion.
        setQuipSay(lines[Math.floor(Math.random() * lines.length)]);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [companionId]);

  // ─── UX-031: first-run tour — once, right after the first scan ─────────
  useEffect(() => {
    if (scanDone && loadPrefs().tourDone !== true) setTourOpen(true);
  }, [scanDone]);
  const handleTourFinish = useCallback(() => {
    setTourOpen(false);
    savePrefs({ tourDone: true });
    try {
      window.dispatchEvent(new CustomEvent("quip:focus-composer"));
    } catch {
      /* non-fatal */
    }
  }, []);

  // ─── UX-012: pin / unpin helpers ────────────────────────────────────────
  const pinMessage = useCallback((m: { id: string; content: string }) => {
    const p = { id: m.id, text: m.content };
    setPinnedMessage(p);
    setPinExpanded(false);
    savePrefs({ pinnedMessage: p });
  }, []);
  const unpinMessage = useCallback(() => {
    setPinnedMessage(null);
    setPinExpanded(false);
    savePrefs({ pinnedMessage: null });
    try {
      window.dispatchEvent(new CustomEvent("quip:focus-composer"));
    } catch {
      /* non-fatal */
    }
  }, []);
  const handlePinLastReply = useCallback(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        pinMessage(messages[i]);
        return;
      }
    }
  }, [messages, pinMessage]);

  // ─── UX-011: export the conversation as a Markdown download ────────────
  const handleExportChat = useCallback(() => {
    if (messages.length === 0) return;
    const md = messages
      .map((m) => `**${m.role === "user" ? "You" : "Quip"}** (${new Date(m.ts).toLocaleString()}):\n\n${m.content}\n\n---`)
      .join("\n");
    try {
      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const d = new Date();
      const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      a.href = url;
      a.download = `quip-chat-${stamp}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      pushToast({ title: "Conversation exported", body: `quip-chat-${stamp}.md saved to your Downloads folder.`, kind: "success" });
    } catch {
      pushToast({ title: "Export failed", body: "The Markdown file could not be created — try again.", kind: "error" });
    }
  }, [messages]);

  // Global keys: Ctrl+K palette, "?" shortcuts (never while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement | null)?.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.key === "?" && !typing) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const paletteActions = useMemo(
    () =>
      buildPaletteActions({
        setTheme: (t) => {
          applyTheme(t as any);
          savePrefs({ theme: t as any });
        },
        cyclePermissionMode: () => {
          try {
            window.quip.cyclePermissionMode().then((res: { mode: string; label: string }) => {
              pushToast({ title: "Permission mode", body: res.label || String(res.mode).replace(/_/g, " "), kind: "info" });
            });
          } catch {
            /* non-fatal */
          }
        },
        openSettings: () => openSettings("general"),
        clearChat: () => newChat(),
      }),
    [openSettings, newChat]
  );

  // ─── Window mode sync (renderer state ↔ Electron window) ────────────────
  useEffect(() => {
    let alive = true;
    try {
      window.quip
        .getWindowMode()
        .then((m) => { if (alive) setViewMode(m); })
        .catch(() => {});
    } catch {
      /* non-fatal */
    }
    let offMode: (() => void) | undefined;
    try {
      offMode = window.quip.onWindowModeChanged((m) => {
        if (alive) setViewMode(m);
      });
    } catch {
      /* non-fatal — mode sync unavailable */
    }
    return () => { alive = false; offMode?.(); };
  }, []);

  const enterMode = useCallback((mode: WindowMode) => {
    setViewMode(mode);
    try {
      window.quip.setWindowMode(mode);
    } catch {
      /* non-fatal — renderer still switches layout */
    }
  }, []);

  // ─── Tap the companion: companion ⇄ panel ──────────────────────────────
  const drag = useWindowDrag(viewMode !== "full");
  const lastTap = useRef(0);

  const handleCompanionTap = useCallback(() => {
    if (drag.totalMoved() > 5) return; // it was a drag, not a tap
    const now = Date.now();
    if (now - lastTap.current < 150) return;
    lastTap.current = now;
    enterMode(viewMode === "companion" ? "panel" : "companion");
  }, [drag, enterMode, viewMode]);

  // ─── Approval requests must be VISIBLE ──────────────────────────────────
  // If a task needs confirmation while Quip is in companion-only mode, open
  // the panel so the user can actually see and answer it (otherwise the
  // request would time out unanswered).
  useEffect(() => {
    if (approvalRequest && viewMode === "companion") {
      enterMode("panel");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approvalRequest]);

  // ─── First run: open the panel so the scan overlay has room ────────────
  useEffect(() => {
    if (!scanDone) enterMode("panel");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Esc exits true full screen (never the app) ──────────────────────────
  useEffect(() => {
    if (viewMode !== "fullscreen") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") enterMode("full");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewMode, enterMode]);

  // ─── Close (X) — always returns to the single desktop companion ────────
  const handleClose = useCallback(() => {
    saveCurrentMessages(companionId, messages);
    setSettingsOpen(false);
    setReflectionOpen(false);
    enterMode("companion");
  }, [companionId, messages, enterMode]);

  // ─── New chat ────────────────────────────────────────────────────────────
  const handleNewChat = useCallback(() => {
    newChat();
    setRestoredMessages([]);
    saveCurrentMessages(companionId, []);
  }, [companionId, newChat]);

  // ─── Switch companion ────────────────────────────────────────────────────
  const switchCompanion = useCallback((id: CompanionId) => {
    saveCurrentMessages(companionId, messages);
    setCompanionId(id);
    savePrefs({ companionId: id });
    try {
      window.quip.setCompanion(id);
    } catch {
      /* non-fatal */
    }
    const restored = loadCurrentMessages(id);
    setRestoredMessages(restored);
  }, [companionId, messages]);

  // ─── On mount: tell main which companion is active ──────────────────────
  useEffect(() => {
    try {
      window.quip.setCompanion(companionId);
    } catch {
      /* non-fatal */
    }
  }, [companionId]);

  // ─── Fetch mood + cosmetics ─────────────────────────────────────────────
  useEffect(() => {
    let active = true;
    const fetchMood = async () => {
      try {
        const mood = await window.quip.getCompanionMood(companionId);
        if (active && mood && typeof (mood as any).energy === "number") {
          setMoodSpeed(0.5 + (mood as any).energy);
        }
      } catch {
        /* non-fatal */
      }
    };
    const fetchCosmetics = async () => {
      try {
        const prog = await window.quip.getCompanionProgression();
        if (active && prog) {
          const p = (prog as any)[companionId];
          if (p?.unlockedCosmetics) {
            setCosmetics(p.unlockedCosmetics.map((c: any) => c.id));
          }
        }
      } catch {
        /* non-fatal */
      }
    };
    fetchMood();
    fetchCosmetics();
    const interval = setInterval(fetchMood, 60_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [companionId]);

  // ─── Listen for cosmetic unlocks ─────────────────────────────────────────
  useEffect(() => {
    const off = window.quip.onCosmeticUnlock((unlock: any) => {
      if (unlock && unlock.companion === companionId) {
        setUnlockToast(unlock.name);
        setCosmetics((prev) => [...prev, unlock.id]);
        setTimeout(() => setUnlockToast(null), 4000);
        window.quip.getCompanionProgression().then((prog) => {
          if (prog) {
            const p = (prog as any)[companionId];
            if (p?.unlockedCosmetics) {
              setCosmetics(p.unlockedCosmetics.map((c: any) => c.id));
            }
          }
        }).catch(() => {});
      }
    });
    return off;
  }, [companionId]);

  // ─── Companion animation state ───────────────────────────────────────────
  const isResponding =
    chatBusy &&
    messages.some((m) => m.role === "assistant" && m.streaming && m.content.length > 0);
  // Sound feedback: respond-end → success/error blip (companion-pitched).
  const wasResponding = useRef(false);
  useEffect(() => {
    if (wasResponding.current && !isResponding) {
      const last = messages[messages.length - 1];
      playSound(last?.error ? "error" : "success", companionId);
    }
    wasResponding.current = isResponding;
  }, [isResponding, messages, companionId]);
  // Fresh task outcome (≤2s old) wins: success jump, concerned shake, or a
  // gentle cancelled droop. A re-render timer clears the pose at exactly 2s
  // so the sprite never sticks in a celebratory/guilty expression until some
  // unrelated state happens to change (the audit's stuck-pose bug).
  const [, forceTick] = useReducer((x: number) => x + 1, 0);
  const outcomeFlash: "success" | "error" | "cancelled" | null =
    taskOutcome && Date.now() - taskOutcome.at < 2000
      ? taskOutcome.cancelled
        ? "cancelled"
        : taskOutcome.success
          ? "success"
          : "error"
      : null;
  useEffect(() => {
    if (!taskOutcome) return;
    const remaining = 2000 - (Date.now() - taskOutcome.at);
    if (remaining <= 0) {
      forceTick();
      return;
    }
    const t = setTimeout(forceTick, remaining);
    return () => clearTimeout(t);
  }, [taskOutcome]);
  const pixState: PixState = outcomeFlash
    ? outcomeFlash
    : approvalRequest
      ? "waiting"
      : taskProgress
        ? taskProgress.phase === "planning"
          ? "planning"
          : taskProgress.phase === "observing"
            ? "observing"
            : taskProgress.phase === "verifying"
              ? "verifying"
              : taskProgress.phase === "waiting_permission"
                ? "waiting"
                : taskProgress.phase === "recovering"
                  ? "observing"
                  : "working"
        : chatBusy
          ? isResponding
            ? "responding"
            : "thinking"
          : hovering
            ? "hover"
            : "idle";

  const theme = getCompanion(companionId);

  // ─── QuipSay: newest proactive message floats as an on-screen bubble ────
  const latestProactive = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && m.proactive) return m.content;
      if (i < messages.length - 3) break; // only look at recent tail
    }
    return null;
  }, [messages]);

  useEffect(() => {
    if (latestProactive) setQuipSay(latestProactive);
  }, [latestProactive]);

  // Cute reactions — after a verified success, failure, or cancellation the
  // companion says something tiny. Real events only (driven by taskOutcome).
  useEffect(() => {
    if (!taskOutcome) return;
    const lines = taskOutcome.cancelled
      ? ["Okay, stopped 👍", "Cancelled — ready when you are."]
      : taskOutcome.success
        ? ["That worked! ✨", "Done — and verified 😌", "Another one handled 🙌"]
        : ["Hmm, that didn't work 😅", "I couldn't finish that one — ask me what happened."];
    setQuipSay(lines[Math.floor(Math.random() * lines.length)]);
  }, [taskOutcome?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Shared chat body (used by both panel and full layouts) ──────────────
  const chatBody = (
    <>
      {error && (
        <div
          style={{
            padding: "8px 12px",
            fontSize: 11,
            color: "rgb(var(--quip-bad))",
            background: "rgba(var(--quip-bad), 0.10)",
            borderBottom: "1px solid rgba(var(--quip-bad), 0.18)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span style={{ flex: 1 }}>{error}</span>
          {errorKind === "no-key" ? (
            <button
              onClick={() => openSettings("ai")}
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                color: "#fff",
                padding: "4px 10px",
                borderRadius: 7,
                background: "linear-gradient(135deg, rgb(var(--quip-accent)), rgb(var(--quip-accent-3)))",
                border: "none",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Add AI key →
            </button>
          ) : (
            <button
              onClick={clearError}
              style={{
                fontSize: 10,
                color: "rgb(var(--quip-bad))",
                padding: "2px 6px",
                borderRadius: 4,
                background: "rgba(var(--quip-bad), 0.10)",
                border: "none",
                cursor: "pointer",
              }}
              aria-label="Dismiss error"
            >
              ✕
            </button>
          )}
        </div>
      )}

      <div className="relative flex flex-1 flex-col overflow-hidden">
        {messages.length === 0 ? (
          <ChatWelcome
            companionId={companionId}
            onSuggestionClick={send}
            onOpenKeySetup={() => openSettings("ai")}
          />
        ) : (
          <ChatLayout messages={messages} busy={chatBusy} onRetry={retryLast} />
        )}
      </div>

      {/* Live task progress — step x/y with what is actually running */}
      <AnimatePresence>
        {taskProgress && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            style={{
              margin: "0 12px 6px",
              padding: "7px 12px",
              borderRadius: 12,
              background: `${theme.primary}0f`,
              border: `1px solid ${theme.primary}2e`,
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 11.5,
              color: "rgb(var(--quip-text))",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: theme.primary,
                flexShrink: 0,
                animation: "quipPulse 1.2s ease-in-out infinite",
              }}
            />
            <span
              style={{
                fontWeight: 600,
                color: theme.primary,
                flexShrink: 0,
              }}
            >
              {taskProgress.step > 0
                ? `Step ${taskProgress.step}/${taskProgress.total}`
                : "Thinking…"}
            </span>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
              }}
            >
              {taskProgress.description}
            </span>
            <button
              onClick={cancelTask}
              style={{
                flexShrink: 0,
                fontSize: 10.5,
                fontWeight: 600,
                color: "rgb(var(--quip-text-soft))",
                background: "rgba(var(--quip-line), 0.06)",
                border: "none",
                borderRadius: 7,
                padding: "3px 10px",
                cursor: "pointer",
              }}
              aria-label="Stop this task"
            >
              Stop
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {approvalRequest && (
          <ActionApprovalPanel
            request={approvalRequest}
            companionColor={theme.primary}
            onResolve={resolveApproval}
          />
        )}
      </AnimatePresence>

      {/* Live provider chip — which brain is answering (or being tried).
          Makes failover VISIBLE instead of looking like a hang. */}
      <AnimatePresence>
        {streamingProvider && chatBusy && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            style={{
              margin: "0 12px 6px",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 10.5,
              fontWeight: 600,
              color: streamingProvider.confirmed ? "rgb(var(--quip-accent-deep))" : "rgb(var(--quip-text-soft))",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: streamingProvider.confirmed ? "rgb(var(--quip-ok, 34, 197, 94))" : "rgba(var(--quip-line), 0.25)",
                animation: streamingProvider.confirmed ? "none" : "quipPulse 1s ease-in-out infinite",
              }}
            />
            {streamingProvider.confirmed
              ? `${streamingProvider.provider} is answering`
              : `trying ${streamingProvider.provider}…`}
          </motion.div>
        )}
      </AnimatePresence>

      {/* UX-012 — pinned message strip: keeps one reply at hand, persisted */}
      {(pinnedMessage || messages.length > 0) && (
        <div
          style={{
            margin: "0 12px 6px",
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            borderRadius: 12,
            border: "1px solid rgba(var(--quip-accent), 0.3)",
            background: "rgba(var(--quip-accent), 0.07)",
            padding: "5px 10px",
            fontSize: 11,
          }}
        >
          {pinnedMessage ? (
            <>
              <span aria-hidden style={{ flexShrink: 0, lineHeight: "16px" }}>📌</span>
              <span
                className="quip-pin-text"
                role="button"
                tabIndex={0}
                aria-expanded={pinExpanded}
                aria-label={pinExpanded ? "Collapse pinned message" : "Expand pinned message"}
                onClick={() => setPinExpanded((v) => !v)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setPinExpanded((v) => !v);
                  }
                }}
                style={{
                  flex: 1,
                  lineHeight: "16px",
                  color: "rgb(var(--quip-text))",
                  maxHeight: pinExpanded ? 88 : undefined,
                  overflowY: pinExpanded ? "auto" : undefined,
                  whiteSpace: pinExpanded ? "pre-wrap" : "nowrap",
                  overflow: pinExpanded ? "auto" : "hidden",
                  textOverflow: pinExpanded ? undefined : "ellipsis",
                }}
              >
                {pinnedMessage.text}
              </span>
              <button
                onClick={unpinMessage}
                aria-label="Unpin message"
                style={{
                  flexShrink: 0,
                  fontSize: 10,
                  fontWeight: 600,
                  color: "rgb(var(--quip-text-soft))",
                  background: "rgba(var(--quip-line), 0.06)",
                  border: "none",
                  borderRadius: 7,
                  padding: "2px 8px",
                  cursor: "pointer",
                }}
              >
                Unpin
              </button>
            </>
          ) : (
            <span style={{ flex: 1, fontSize: 10.5, color: "rgba(var(--quip-text-soft), 0.95)", lineHeight: "16px" }}>
              Pin a reply to keep it at hand while you work.
            </span>
          )}
          {messages.length > 0 && (
            <button
              onClick={handlePinLastReply}
              aria-label="Pin last reply"
              style={{
                flexShrink: 0,
                fontSize: 10,
                fontWeight: 600,
                color: "rgb(var(--quip-accent-deep))",
                background: "rgba(var(--quip-accent), 0.12)",
                border: "1px solid rgba(var(--quip-accent), 0.3)",
                borderRadius: 7,
                padding: "2px 8px",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Pin last reply
            </button>
          )}
        </div>
      )}

      <ChatInput onSend={send} busy={chatBusy} companionId={companionId} />
    </>
  );

  const topBar = (
    <TopBar
      companionId={companionId}
      onCompanionChange={switchCompanion}
      onSettingsToggle={() => openSettings("general")}
      onReflectionToggle={() => setReflectionOpen(true)}
      onNewChat={handleNewChat}
      onClose={handleClose}
      mode={viewMode === "full" ? "full" : viewMode === "fullscreen" ? "fullscreen" : "panel"}
      onToggleExpand={() => enterMode(viewMode === "full" ? "panel" : "full")}
      onToggleFullscreen={() => enterMode(viewMode === "fullscreen" ? "full" : "fullscreen")}
      onBrainClick={() => openSettings("ai")}
      onExport={messages.length > 0 ? handleExportChat : undefined}
      onHistory={() => setHistoryOpen(true)}
    />
  );

  const overlays = (
    <>
      <HistoryDrawer
        open={historyOpen}
        sessions={sessions}
        companionId={companionId}
        onClose={() => setHistoryOpen(false)}
        onOpenSession={openSession}
        onNewChat={handleNewChat}
      />
      <SettingsPanel
        open={settingsOpen}
        companionId={companionId}
        onCompanionChange={switchCompanion}
        initialTab={settingsTab}
        onClose={() => setSettingsOpen(false)}
      />
      <AnimatePresence>
        {reflectionOpen && (
          <WeeklyReflection
            companionId={companionId}
            onClose={() => setReflectionOpen(false)}
          />
        )}
      </AnimatePresence>
      {!scanDone && viewMode !== "companion" && (
        <ScanOverlay
          companionId={companionId}
          onDone={() => {
            setScanDone(true);
            savePrefs({ scanned: true });
          }}
        />
      )}
    </>
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "transparent",
        pointerEvents: "none",
      }}
    >
      {/* ═══ COMPANION MODE — only the sprite, floating calmly ═══════════ */}
      {viewMode === "companion" && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "flex-end",
            padding: "8px 10px 10px 8px",
          }}
        >
          <div
            role="button"
            aria-label={`${theme.name} companion — tap to open Quip`}
            tabIndex={0}
            style={{
              position: "relative",
              width: COMPANION_SIZE + 8,
              height: COMPANION_SIZE + 16,
              pointerEvents: "auto",
              cursor: "grab",
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleCompanionTap();
              }
            }}
            onPointerEnter={() => setHovering(true)}
            onPointerLeave={() => setHovering(false)}
            onPointerDown={drag.onPointerDown}
            onPointerMove={drag.onPointerMove}
            onPointerUp={(e) => {
              drag.onPointerUp(e);
              handleCompanionTap();
            }}
          >
            <Companion
              id={companionId}
              state={pixState}
              size={COMPANION_SIZE}
              unlockedCosmetics={cosmetics}
              moodSpeed={moodSpeed}
            />

            <AnimatePresence>
              {chatBusy && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  style={{
                    position: "absolute",
                    bottom: -4,
                    left: "50%",
                    transform: "translateX(-50%)",
                    whiteSpace: "nowrap",
                    fontSize: 10,
                    fontWeight: 500,
                    color: theme.primary,
                    background: "rgb(var(--chrome-bg) / 0.95)",
                    padding: "2px 8px",
                    borderRadius: 10,
                    boxShadow: `0 2px 8px ${theme.primary}18`,
                    border: `1px solid ${theme.primary}20`,
                  }}
                >
                  {isResponding ? "typing…" : "thinking…"}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Compact proactive bubble above the companion */}
          <QuipSay
            message={quipSay}
            companionColor={theme.primary}
            onDismiss={() => setQuipSay(null)}
            compact
          />
        </div>
      )}

      {/* ═══ PANEL MODE — small panel beside the companion ═══════════════ */}
      {viewMode === "panel" && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "stretch",
            gap: PANEL_GAP,
            padding: PANEL_MARGIN,
          }}
        >
          {/* Small panel — left side */}
          <motion.div
            key="chat-panel"
            initial={{ opacity: 0, x: -16, scale: 0.98 }}
            animate={{
              opacity: 1,
              x: 0,
              scale: 1,
              transition: { type: "spring", stiffness: 380, damping: 30, mass: 0.7 },
            }}
            style={{
              pointerEvents: "auto",
              flex: 1,
              minWidth: 0,
              borderRadius: 20,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              // OPAQUE + theme-driven: the desktop behind must NEVER show
              // through the chat surface, in every palette (the user's ask).
              background: "rgb(var(--quip-bg))",
              border: "1px solid rgba(var(--quip-line), 0.10)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
            }}
          >
            {topBar}
            {chatBody}
            {overlays}
          </motion.div>

          {/* Companion docked at the bottom-right, always visible */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              alignItems: "center",
              width: COMPANION_SIZE + 20,
              flexShrink: 0,
              paddingBottom: 2,
            }}
          >
            <div
              role="button"
              aria-label={`${theme.name} — tap to collapse Quip`}
              tabIndex={0}
              style={{
                position: "relative",
                width: COMPANION_SIZE + 8,
                height: COMPANION_SIZE + 16,
                pointerEvents: "auto",
                cursor: "grab",
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleCompanionTap();
                }
              }}
              onPointerEnter={() => setHovering(true)}
              onPointerLeave={() => setHovering(false)}
              onPointerDown={drag.onPointerDown}
              onPointerMove={drag.onPointerMove}
              onPointerUp={(e) => {
                drag.onPointerUp(e);
                handleCompanionTap();
              }}
            >
              <Companion
                id={companionId}
                state={pixState}
                size={COMPANION_SIZE}
                unlockedCosmetics={cosmetics}
                moodSpeed={moodSpeed}
              />
            </div>
          </div>
        </div>
      )}

      {/* ═══ FULL MODE — the full Quip app ════════════════════════════════ */}
      {viewMode === "full" && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            padding: 14,
          }}
        >
          <motion.div
            key="full-app"
            initial={{ opacity: 0, scale: 0.985 }}
            animate={{
              opacity: 1,
              scale: 1,
              transition: { type: "spring", stiffness: 320, damping: 30, mass: 0.8 },
            }}
            style={{
              pointerEvents: "auto",
              height: "100%",
              borderRadius: 24,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              // OPAQUE + theme-driven (no desktop show-through, no white glass).
              background: "rgb(var(--quip-bg))",
              border: "1px solid rgba(var(--quip-line), 0.10)",
              boxShadow: "0 30px 80px rgba(0,0,0,0.22)",
            }}
          >
            {topBar}

            <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
              {/* Companion stage — calm, roomy */}
              <div
                style={{
                  width: 300,
                  flexShrink: 0,
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  background:
                    `radial-gradient(circle at 50% 30%, ${theme.auraA} 0%, transparent 70%)`,
                  borderRight: "1px solid rgba(var(--quip-line), 0.07)",
                }}
              >
                <Companion
                  id={companionId}
                  state={pixState}
                  size={STAGE_COMPANION_SIZE}
                  unlockedCosmetics={cosmetics}
                  moodSpeed={moodSpeed}
                />
                <div style={{ textAlign: "center" }}>
                  <div
                    style={{
                      fontSize: 16,
                      fontWeight: 600,
                      color: "rgb(var(--quip-text))",
                      letterSpacing: -0.2,
                    }}
                  >
                    {theme.name}
                  </div>
                  <div style={{ fontSize: 12, color: "rgb(var(--quip-text-soft))", marginTop: 2 }}>
                    {theme.subtitle}
                  </div>
                </div>
                {chatBusy && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      color: theme.primary,
                      background: "rgba(var(--quip-line), 0.06)",
                      padding: "3px 10px",
                      borderRadius: 10,
                      border: `1px solid ${theme.primary}25`,
                    }}
                  >
                    {isResponding ? "typing…" : "thinking…"}
                  </motion.div>
                )}
                <QuipSay
                  message={quipSay}
                  companionColor={theme.primary}
                  onDismiss={() => setQuipSay(null)}
                />
              </div>

              {/* Chat column */}
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {chatBody}
              </div>
            </div>

            {overlays}
          </motion.div>
        </div>
      )}

      {/* ═══ TRUE FULL SCREEN MODE — the whole display, edge to edge ═════ */}
      {viewMode === "fullscreen" && (
        <div
          style={{
            position: "fixed",
            inset: 0,
          }}
        >
          <motion.div
            key="fullscreen-app"
            initial={{ opacity: 0, scale: 1.01 }}
            animate={{
              opacity: 1,
              scale: 1,
              transition: { type: "spring", stiffness: 340, damping: 32, mass: 0.8 },
            }}
            style={{
              pointerEvents: "auto",
              height: "100%",
              width: "100%",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              // Whole display, zero inset, fully themed + opaque.
              background: "rgb(var(--quip-bg))",
            }}
          >
            {topBar}

            <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
              <div
                style={{
                  width: 320,
                  flexShrink: 0,
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 12,
                  background:
                    `radial-gradient(circle at 50% 30%, ${theme.auraA} 0%, transparent 70%)`,
                  borderRight: "1px solid rgba(var(--quip-line), 0.07)",
                }}
              >
                <Companion
                  id={companionId}
                  state={pixState}
                  size={200}
                  unlockedCosmetics={cosmetics}
                  moodSpeed={moodSpeed}
                />
                <div style={{ textAlign: "center" }}>
                  <div
                    style={{
                      fontSize: 17,
                      fontWeight: 600,
                      color: "rgb(var(--quip-text))",
                      letterSpacing: -0.2,
                    }}
                  >
                    {theme.name}
                  </div>
                  <div style={{ fontSize: 12.5, color: "rgb(var(--quip-text-soft))", marginTop: 2 }}>
                    {theme.subtitle}
                  </div>
                </div>
                {chatBusy && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    style={{
                      fontSize: 11.5,
                      fontWeight: 500,
                      color: theme.primary,
                      background: "rgba(var(--quip-line), 0.06)",
                      padding: "3px 10px",
                      borderRadius: 10,
                      border: `1px solid ${theme.primary}25`,
                    }}
                  >
                    {isResponding ? "typing…" : "thinking…"}
                  </motion.div>
                )}
                <QuipSay
                  message={quipSay}
                  companionColor={theme.primary}
                  onDismiss={() => setQuipSay(null)}
                />
              </div>

              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {chatBody}
              </div>
            </div>

            {overlays}
          </motion.div>
        </div>
      )}

      {/* Cosmetic unlock toast */}
      <ErrorBar mode={viewMode} onOpenProblems={() => openSettings("problems")} />
      <Toaster />
      <QuestCard />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        actions={paletteActions}
        onTask={(msg) => {
          send(msg);
          if (viewMode === "companion") enterMode("panel");
        }}
      />
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      {/* UX-031: first-run tour — shows once, then prefs.tourDone ends it */}
      <FirstRunTour open={tourOpen} onFinish={handleTourFinish} />
      <AnimatePresence>
        {unlockToast && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            style={{
              position: "absolute",
              bottom: 130,
              right: 20,
              zIndex: 200,
              pointerEvents: "none",
              background: "rgb(var(--chrome-bg) / 0.95)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              borderRadius: 12,
              padding: "10px 16px",
              boxShadow: "0 10px 30px rgba(0,0,0,0.16)",
              border: "1px solid rgba(var(--quip-line), 0.10)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ fontSize: 18 }}>✨</span>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "rgb(var(--chrome-text))" }}>
                New unlock!
              </span>
              <span style={{ fontSize: 11, color: "rgb(var(--chrome-soft))" }}>
                {unlockToast}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
