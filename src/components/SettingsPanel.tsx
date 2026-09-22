// Quip V3 — Settings panel.
//
// Full overlay with tabs: AI Brain, General, Desktop, Device, Memory, DNA, Progression.
// General tab now owns the THEME PICKER — 10 palette themes, persisted.
// Desktop tab owns the two power buttons the user asked for:
//   • "Quip Appearance" — brings the companion onto the desktop WITH the
//     Quip logo look and opens the full app page. No terminal, ever.
//   • "Fetch Updates"   — pulls the latest code from the repo, honestly.
// AI Brain tab: paste an API key in-app, test the connection for real,
//   see the live provider status — no more hand-editing .env files.
// Every surface is theme-aware (see index.css `.quip-card` primitives).

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { CompanionId, DeviceProfile, UserKnowledge } from "@/types";
import type { ModelRouterStatus } from "@/types/models";
import type { WindowMode } from "../../electron/shared";
import { CompanionSwitch } from "./CompanionSwitch";
import { ConfirmModal } from "./ConfirmModal";
import { THEMES, applyTheme, currentTheme, isDarkTheme, applyUIScale, applyDensity, applyAccent, applyCompanionTint, savedAccent } from "@/lib/theme";
import { loadPrefs, savePrefs } from "@/lib/storage";
import { setSoundsMuted } from "@/lib/sounds";
import { getCompanion } from "@/lib/companion-config";
import { ProblemDiaryPanel } from "./ProblemDiaryPanel";
import quipLogo from "@/assets/quip-logo.png";
import quipMark from "@/assets/quip-mark.png";

interface SettingsPanelProps {
  open: boolean;
  companionId: CompanionId;
  onCompanionChange: (id: CompanionId) => void;
  onClose: () => void;
  initialTab?: Tab;
}

type Tab = "ai" | "appearance" | "general" | "desktop" | "device" | "memory" | "dna" | "progression" | "problems";

// UX-020 — keyword → tab index for the settings search. First matching entry
// in this order wins; honest and boring on purpose (no fuzzy fake results).
const SETTINGS_SEARCH_INDEX: Array<{ tab: Tab; keywords: string[] }> = [
  { tab: "ai", keywords: ["key", "api", "groq", "model", "provider", "email", "mailwing", "outbox", "smtp", "voice", "speak", "tts", "brain"] },
  { tab: "appearance", keywords: ["theme", "color", "colour", "font", "size", "density", "bubble", "palette", "screen"] },
  { tab: "general", keywords: ["sound", "language", "name", "quick", "reply", "greeting", "companion"] },
  { tab: "desktop", keywords: ["shortcut", "desktop", "permission", "tray", "autonomy", "budget", "check-in", "update", "quit"] },
  { tab: "memory", keywords: ["memory", "knowledge", "forget"] },
  { tab: "problems", keywords: ["problem", "error", "diary", "failure"] },
  { tab: "dna", keywords: ["dna", "tone", "communication"] },
  { tab: "progression", keywords: ["progress", "level", "xp", "cosmetic", "unlock"] },
  { tab: "device", keywords: ["device", "hardware", "battery", "cpu", "storage"] },
];

function matchSettingsTab(query: string): Tab | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  for (const entry of SETTINGS_SEARCH_INDEX) {
    if (entry.keywords.some((k) => q.includes(k))) return entry.tab;
  }
  return null;
}

// CAP-060: the autonomy budget lives in preload but isn't on the hand-written
// Window API type yet — guarded access keeps tsc green without touching types.
type QuestBudgetAPI = {
  getQuestBudget?: () => Promise<{ budget: number }>;
  setQuestBudget?: (budget: number) => Promise<{ ok: boolean; budget: number; message: string }>;
};

type ProviderId = "openrouter" | "groq" | "cerebras" | "nvidia" | "gemini" | "ollama";

const AI_PROVIDERS: Array<{
  id: ProviderId;
  name: string;
  hint: string;
  keyUrl: string;
  keyPrefix: string;
  modelPlaceholder: string;
  /** No API key — the key box carries the local server URL instead. */
  localOnly?: boolean;
}> = [
  {
    id: "groq",
    name: "Groq",
    hint: "Free key · fastest voice + chat",
    keyUrl: "https://console.groq.com/keys",
    keyPrefix: "gsk_",
    modelPlaceholder: "openai/gpt-oss-120b",
  },
  {
    id: "gemini",
    name: "Gemini",
    hint: "Free key · biggest free daily quota",
    keyUrl: "https://aistudio.google.com/apikey",
    keyPrefix: "AIza",
    modelPlaceholder: "gemini-2.5-flash",
  },
  {
    id: "cerebras",
    name: "Cerebras",
    hint: "Free key · extreme speed",
    keyUrl: "https://cloud.cerebras.ai",
    keyPrefix: "csk-",
    modelPlaceholder: "llama-3.3-70b",
  },
  {
    id: "nvidia",
    name: "NVIDIA",
    hint: "Free key · many models",
    keyUrl: "https://build.nvidia.com",
    keyPrefix: "nvapi-",
    modelPlaceholder: "openai/gpt-oss-20b",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    hint: "Free key · widest model choice",
    keyUrl: "https://openrouter.ai/keys",
    keyPrefix: "sk-or-",
    modelPlaceholder: "google/gemma-4-31b-it:free",
  },
  {
    id: "ollama",
    name: "Ollama",
    hint: "Offline backup · needs the Ollama app",
    keyUrl: "https://ollama.com",
    keyPrefix: "",
    modelPlaceholder: "llama3.2:3b",
    localOnly: true,
  },
];

export function SettingsPanel({
  open,
  companionId,
  onCompanionChange,
  onClose,
  initialTab = "general",
}: SettingsPanelProps) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [device, setDevice] = useState<DeviceProfile | null>(null);
  const [memory, setMemory] = useState<UserKnowledge | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [progression, setProgression] = useState<any>(null);
  const [pruning, setPruning] = useState(false);
  const [confirmResetDNA, setConfirmResetDNA] = useState(false);
  const [confirmPrune, setConfirmPrune] = useState(false);
  const [confirmQuit, setConfirmQuit] = useState(false);

  // AI Brain tab state
  const [modelStatus, setModelStatus] = useState<ModelRouterStatus | null>(null);
  const [provider, setProvider] = useState<ProviderId>("groq");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saveResult, setSaveResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [resolving, setResolving] = useState(false);
  const [providerStatuses, setProviderStatuses] = useState<
    Array<{ provider: string; configured: boolean; ok: boolean; latencyMs: number; message: string; kind: string; model: string }>
  | null>(null);
  const [providerConfig, setProviderConfig] = useState<{
    primary: ProviderId;
    enabled: Record<string, boolean>;
    visionModel: string | null;
    chain: string[];
  } | null>(null);
  const [configNote, setConfigNote] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);

  // Model browser state — scroll through every model a provider has.
  const [browsing, setBrowsing] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<Array<{ id: string; ownedBy?: string }>>([]);
  const [modelSearch, setModelSearch] = useState("");
  const [modelBrowserNote, setModelBrowserNote] = useState<string | null>(null);

  // Speech state — the companion's real voice.
  const [speakEnabled, setSpeakEnabled] = useState(true);
  const [speakEngine, setSpeakEngine] = useState<"auto" | "groq" | "edge" | "local">("auto");
  const [speakVoice, setSpeakVoice] = useState("Celeste-PlayAI");
  const [edgeVoice, setEdgeVoice] = useState("en-IN-NeerjaNeural");
  const [speakNote, setSpeakNote] = useState<string | null>(null);

  // Doctor + transport state (V3.1 connectivity round)
  const [doctorRunning, setDoctorRunning] = useState(false);
  const [doctorReport, setDoctorReport] = useState<any>(null);
  const [transport, setTransport] = useState<"auto" | "net" | "node">("auto");

  // Desktop tab state
  const [companionVisible, setCompanionVisible] = useState(true);
  const [checkInsEnabled, setCheckInsEnabled] = useState(true);
  // Permission mode — full backend (engine + IPC) existed with zero UI until
  // this card landed; now the user can actually govern what auto-runs.
  const [permMode, setPermMode] = useState<{ mode: string; label: string } | null>(null);

  // Theme picker state (General tab)
  const [theme, setTheme] = useState<string>(() => currentTheme());
  // UX-002: sound effects toggle (persisted mute state)
  const [soundsOn, setSoundsOn] = useState<boolean>(() => !(loadPrefs().soundsMuted ?? false));

  // Quip Appearance + Fetch Updates state (Desktop tab)
  const [bringing, setBringing] = useState(false);
  const [bringNote, setBringNote] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchResult, setFetchResult] = useState<{ ok: boolean; message: string; needsRestart?: boolean } | null>(null);
  // Desktop shortcut — the real Quip.lnk on the Windows home screen
  const [shortcutBusy, setShortcutBusy] = useState(false);
  const [shortcutResult, setShortcutResult] = useState<{ ok: boolean; message: string } | null>(null);

  // UX-020: settings search — filters (auto-jumps) to the matching tab.
  const [searchQuery, setSearchQuery] = useState("");
  // UX-042/046: UI type scale + chat density (persisted in prefs + theme keys).
  const [uiSize, setUiSize] = useState<"compact" | "comfortable" | "spacious">(() => loadPrefs().uiSize ?? "comfortable");
  const [density, setDensity] = useState<"comfortable" | "compact">(() => loadPrefs().density ?? "comfortable");
  // UX-043/045: accent override + companion re-tint.
  const [accent, setAccent] = useState<string | null>(() => savedAccent());
  const [tintOn, setTintOn] = useState<boolean>(() => loadPrefs().companionTint ?? false);
  // UX-049: custom quick replies (one chip per line, max 8 × 60 chars).
  const [quickReplies, setQuickReplies] = useState<string>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("quip.quickReplies") ?? "[]");
      return Array.isArray(raw) ? raw.filter((r) => typeof r === "string").join("\n") : "";
    } catch {
      return "";
    }
  });
  // UX-050: chat bubble style (QuipSay/ChatMessage read this key).
  const [bubbleStyle, setBubbleStyle] = useState<"glass" | "solid" | "outline">(() => {
    try {
      const v = localStorage.getItem("quip.bubbleStyle");
      return v === "solid" || v === "outline" ? v : "glass";
    } catch {
      return "glass";
    }
  });
  // UX-033: MailWing — configured accounts + the last 12 real sends.
  const [mailOutbox, setMailOutbox] = useState<Array<{ id: string; ts: number; status: "sent" | "failed"; to: string[]; subject: string; detail: string }>>([]);
  const [mailAccounts, setMailAccounts] = useState<Array<{ id: string; label: string; user: string; smtpHost: string; smtpPort: number; secure: boolean; isDefault: boolean; passEncrypted: boolean; lastTestOk?: boolean }>>([]);
  const [mailLoading, setMailLoading] = useState(false);
  // CAP-060: autonomy budget (0 = ask every time, >10 rarely useful).
  const [questBudget, setQuestBudget] = useState<number | null>(null);
  const [budgetDraft, setBudgetDraft] = useState<number | null>(null);
  const [budgetNote, setBudgetNote] = useState<string | null>(null);

  useEffect(() => {
    setTab(initialTab);
    // Fresh open → drop any stale filter so the note never lies about the view.
    setSearchQuery("");
  }, [initialTab, open]);

  // UX-020: as you type, auto-jump to the first tab whose keywords match.
  const searchMatch = matchSettingsTab(searchQuery);
  useEffect(() => {
    if (searchMatch && searchMatch !== tab) setTab(searchMatch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  useEffect(() => {
    if (!open) return;
    window.quip.getDeviceProfile().then(setDevice).catch(() => {});
    window.quip.getMemories().then(setMemory).catch(() => {});
    window.quip.getUserProfile().then(setProfile).catch(() => {});
    window.quip.getCompanionProgression().then(setProgression).catch(() => {});
    window.quip.getModelStatus().then(setModelStatus).catch(() => {});
    window.quip.getProviderConfig().then(setProviderConfig).catch(() => {});
    window.quip.getSpeakConfig().then((c) => {
      setSpeakEnabled(c.enabled);
      setSpeakEngine(c.engine);
      setSpeakVoice(c.voice);
      if ((c as any).edgeVoice) setEdgeVoice((c as any).edgeVoice);
    }).catch(() => {});
    window.quip.getTransportSetting?.().then((t) => setTransport(t.mode)).catch(() => {});
    // Auto-check which provider actually works (real probes, honest badges).
    handleResolveProviders();
    window.quip
      .getCompanionVisible()
      .then(setCompanionVisible)
      .catch(() => {});
    window.quip
      .getCheckInsEnabled()
      .then(setCheckInsEnabled)
      .catch(() => {});
    window.quip
      .getPermissionMode()
      .then(setPermMode)
      .catch(() => {});
    // MailWing outbox + accounts (UX-033) — honest empty states when absent.
    setMailLoading(true);
    window.quip
      .mailwingOutboxGet()
      .then((rows) => setMailOutbox(Array.isArray(rows) ? rows : []))
      .catch(() => {})
      .finally(() => setMailLoading(false));
    window.quip
      .mailwingAccountsList()
      .then((rows) => setMailAccounts(Array.isArray(rows) ? rows : []))
      .catch(() => {});
    // CAP-060 autonomy budget.
    (window.quip as unknown as QuestBudgetAPI).getQuestBudget?.()
      .then((r) => setQuestBudget(typeof r?.budget === "number" ? r.budget : 0))
      .catch(() => {});
  }, [open]);

  const handleSetPermMode = async (mode: string) => {
    try {
      const next = await window.quip.setPermissionMode(mode);
      setPermMode(next);
    } catch {
      /* non-fatal — mode unchanged */
    }
  };

  /** Probe BOTH providers for real (main process) and auto-select the one
   *  that is genuinely CONNECTED — the user never has to guess. */
  const handleResolveProviders = async () => {
    setResolving(true);
    try {
      const statuses = await window.quip.resolveProvider();
      setProviderStatuses(statuses);
      const working = statuses.find((s) => s.ok);
      if (working) {
        setProvider(working.provider);
        if (!model.trim() && working.model) setModel(working.model);
      }
    } catch {
      /* non-fatal — the manual Test connection button still works */
    } finally {
      setResolving(false);
    }
  };

  /** Set which key is THE active brain + which stay off — live, no restart. */
  const handleSetProviderConfig = async (
    primary: ProviderId,
    enabled?: Record<string, boolean>
  ) => {
    setSavingConfig(true);
    setConfigNote(null);
    const nextEnabled = { ...(providerConfig?.enabled ?? {}), ...(enabled ?? {}) };
    try {
      const r = await window.quip.setProviderConfig({ primary, enabled: nextEnabled });
      setConfigNote(r.message);
      if (r.ok) {
        const fresh = await window.quip.getProviderConfig();
        setProviderConfig(fresh);
        const status = await window.quip.getModelStatus();
        setModelStatus(status);
        handleResolveProviders();
      }
    } catch {
      setConfigNote("I couldn't save that — try again.");
    } finally {
      setSavingConfig(false);
    }
  };

  /** Fetch every model the user's key can reach on this provider. */
  const handleBrowseModels = async () => {
    setLoadingModels(true);
    setBrowsing(true);
    setModelBrowserNote(null);
    setDiscoveredModels([]);
    try {
      const r = await window.quip.listProviderModels({ provider, apiKey: apiKey || undefined });
      if (r.ok) {
        setDiscoveredModels(r.models);
        if (r.models.length === 0) setModelBrowserNote("The key connected but the model list came back empty.");
      } else {
        setModelBrowserNote(r.message);
      }
    } catch {
      setModelBrowserNote("I couldn't load the model list — try again.");
    } finally {
      setLoadingModels(false);
    }
  };

  /** Pick one model from the browser — saves it live, no restart. */
  const handleSelectModel = async (modelId: string) => {
    setSaving(true);
    try {
      const r = await window.quip.saveModelKeys({ provider, model: modelId });
      if (r.ok) {
        setModel(modelId);
        setModelBrowserNote(`Selected ${modelId} — it's live now.`);
        setBrowsing(false);
        const status = await window.quip.getModelStatus();
        setModelStatus(status);
      } else {
        setModelBrowserNote(r.message);
      }
    } catch {
      setModelBrowserNote("I couldn't switch the model — try again.");
    } finally {
      setSaving(false);
    }
  };

  /** Voice settings — save live to .env. */
  const handleSetSpeak = async (patch: { enabled?: boolean; engine?: "auto" | "groq" | "edge" | "local"; voice?: string; edgeVoice?: string }) => {
    if (patch.enabled !== undefined) setSpeakEnabled(patch.enabled);
    if (patch.engine !== undefined) setSpeakEngine(patch.engine);
    if (patch.voice !== undefined) setSpeakVoice(patch.voice);
    if (patch.edgeVoice !== undefined) setEdgeVoice(patch.edgeVoice);
    setSpeakNote(null);
    try {
      const r = await window.quip.setSpeakConfig(patch);
      setSpeakNote(r.ok ? "Voice updated." : r.message);
      if (!r.ok) return;
      if (patch.enabled === false) window.quip.ttsStop();
      if (patch.enabled === true && patch.voice === undefined && patch.edgeVoice === undefined) {
        // Tiny confirmation so the user KNOWS the voice works.
        window.quip.ttsSpeak({ text: "Hi! I can speak now." });
      }
    } catch {
      setSpeakNote("I couldn't save the voice settings — try again.");
    }
  };

  /** FULL checkup — network + every provider + voices + journal + env conflicts. */
  const handleRunDoctor = async () => {
    setDoctorRunning(true);
    try {
      const report = await window.quip.runDoctor();
      setDoctorReport(report);
      const fresh = await window.quip.getModelStatus();
      setModelStatus(fresh);
    } catch {
      setDoctorReport({ verdict: "The checkup couldn't run — try again.", providers: [], suggestions: [], journal: [], network: { ok: false, message: "" }, tts: {}, envConflicts: [] });
    } finally {
      setDoctorRunning(false);
    }
  };

  const handleSetTransport = async (mode: "auto" | "net" | "node") => {
    setTransport(mode);
    try {
      await window.quip.setTransportSetting(mode);
    } catch {
      /* non-fatal */
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    setSaveResult(null);
    try {
      const r = await window.quip.testModelConnection({ provider, apiKey: apiKey || undefined, model: model || undefined });
      setTestResult({ ok: r.ok, message: r.message });
    } catch {
      setTestResult({ ok: false, message: "The test couldn't run — try again." });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveKey = async () => {
    setSaving(true);
    setSaveResult(null);
    setTestResult(null);
    try {
      const r = await window.quip.saveModelKeys({ provider, apiKey, model: model || undefined });
      setSaveResult({ ok: r.ok, message: r.message });
      if (r.ok) {
        setApiKey("");
        const fresh = await window.quip.getModelStatus();
        setModelStatus(fresh);
      }
    } catch {
      setSaveResult({ ok: false, message: "Saving failed — try again." });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleVisible = async (visible: boolean) => {
    setCompanionVisible(visible);
    try {
      const actual = await window.quip.setCompanionVisible(visible);
      setCompanionVisible(actual);
    } catch {
      /* keep optimistic state */
    }
  };

  const handleQuit = () => {
    setConfirmQuit(false);
    try {
      window.quip.quitApp();
    } catch {
      /* non-fatal */
    }
  };

  const handleRescan = async () => {
    setRescanning(true);
    try {
      const p = await window.quip.rescanDevice();
      setDevice(p);
    } catch {
      /* ignore */
    } finally {
      setRescanning(false);
    }
  };

  const refreshMemory = async () => {
    try {
      const fresh = await window.quip.getMemories();
      setMemory(fresh);
    } catch {
      /* store read hiccup — keep current view; refresh retries next open */
    }
  };

  const handleForget = async (id: string) => {
    try {
      await window.quip.forgetMemory(id);
      await refreshMemory();
    } catch {
      /* ignore */
    }
  };

  const handlePin = async (id: string) => {
    try {
      await window.quip.pinMemory(id);
      await refreshMemory();
    } catch {
      /* ignore */
    }
  };

  const handlePrune = async () => {
    setConfirmPrune(false);
    setPruning(true);
    try {
      await window.quip.pruneMemories();
      await refreshMemory();
    } catch {
      /* ignore */
    } finally {
      setPruning(false);
    }
  };

  const handleResetDNA = async () => {
    setConfirmResetDNA(false);
    try {
      await window.quip.resetUserProfile();
      const fresh = await window.quip.getUserProfile();
      setProfile(fresh);
    } catch {
      /* ignore — the profile view keeps its previous state */
    }
  };

  /** Theme picker — applies instantly + persists for every future boot. */
  const handleSetTheme = (id: string) => {
    setTheme(id);
    applyTheme(id);
  };

  /** Quip Appearance — companion appears on the desktop + full app page. */
  const handleShowDesktop = async () => {
    setBringing(true);
    setBringNote(null);
    try {
      const r = await window.quip.showQuipDesktop();
      setCompanionVisible(r.visible);
      setBringNote("Quip is on your desktop now — companion and app, together.");
    } catch {
      setBringNote("I couldn't bring Quip up — check if the app is still running.");
    } finally {
      setBringing(false);
    }
  };

  /** Fetch Updates — real git fetch + pull with an honest result. */
  const handleFetchUpdates = async () => {
    setFetching(true);
    setFetchResult(null);
    try {
      const r = await window.quip.fetchUpdates();
      setFetchResult({ ok: r.ok, message: r.message, needsRestart: r.needsRestart });
    } catch {
      setFetchResult({ ok: false, message: "The update check couldn't run — try again." });
    } finally {
      setFetching(false);
    }
  };

  /** Desktop shortcut — real Quip.lnk on the Windows home screen. Double-tap
   *  the icon and Quip appears; the terminal is never needed again. */
  const handleAddShortcut = async () => {
    setShortcutBusy(true);
    setShortcutResult(null);
    try {
      const r = await window.quip.addDesktopShortcut();
      setShortcutResult({ ok: r.ok, message: r.message });
    } catch {
      setShortcutResult({ ok: false, message: "Windows refused the shortcut — restart Quip and try once more." });
    } finally {
      setShortcutBusy(false);
    }
  };

  /** UX-042: UI type scale — applies live via <html data-quip-size>. */
  const handleSetUISize = (size: "compact" | "comfortable" | "spacious") => {
    setUiSize(size);
    applyUIScale(size);
    savePrefs({ uiSize: size });
  };

  /** UX-046: chat density — line spacing via <html data-quip-density>. */
  const handleSetDensity = (d: "comfortable" | "compact") => {
    setDensity(d);
    applyDensity(d);
    savePrefs({ density: d });
  };

  /** UX-043: accent override — null resets to the active theme palette. */
  const handleSetAccent = (color: string | null) => {
    setAccent(color);
    applyAccent(color);
  };

  /** UX-045: companion re-tint — the sprite's primary color becomes the UI accent. */
  const handleToggleTint = () => {
    const next = !tintOn;
    setTintOn(next);
    savePrefs({ companionTint: next });
    applyCompanionTint(next ? getCompanion(companionId).primary : null);
  };

  /** UX-049: quick replies — one chip per line, max 8 chips × 60 chars. */
  const handleQuickRepliesChange = (text: string) => {
    setQuickReplies(text);
    const chips = text
      .split("\n")
      .slice(0, 8)
      .map((l) => l.slice(0, 60))
      .filter((l) => l.trim());
    try {
      localStorage.setItem("quip.quickReplies", JSON.stringify(chips));
    } catch {
      /* non-fatal */
    }
  };

  /** UX-050: bubble style for the chat bubbles (read by QuipSay/ChatMessage). */
  const handleSetBubbleStyle = (style: "glass" | "solid" | "outline") => {
    setBubbleStyle(style);
    try {
      localStorage.setItem("quip.bubbleStyle", style);
    } catch {
      /* non-fatal */
    }
  };

  /** CAP-060: autonomy budget — honest save + the backend's own message. */
  const handleSetQuestBudget = async (value: number) => {
    const clamped = Math.max(0, Math.min(20, Math.round(value)));
    setBudgetDraft(null);
    setQuestBudget(clamped);
    setBudgetNote(null);
    try {
      const r = await (window.quip as unknown as QuestBudgetAPI).setQuestBudget?.(clamped);
      setBudgetNote(r?.message || `Autonomy budget set to ${r?.budget ?? clamped}.`);
    } catch {
      setBudgetNote("Couldn't save the budget — try again.");
    }
  };

  /** UX-033: re-read the outbox on demand. */
  const refreshMailwing = async () => {
    setMailLoading(true);
    try {
      const rows = await window.quip.mailwingOutboxGet();
      setMailOutbox(Array.isArray(rows) ? rows : []);
    } catch {
      /* keep whatever we had — the panel shows the honest last known state */
    } finally {
      setMailLoading(false);
    }
  };

  /** Screen Mode — companion / panel / full app / TRUE full screen. */
  const [screenMode, setScreenMode] = useState<WindowMode>("companion");
  useEffect(() => {
    try {
      window.quip.getWindowMode().then((m) => setScreenMode(m)).catch(() => {});
    } catch {
      /* non-fatal */
    }
  }, []);
  const handleScreenMode = (mode: WindowMode) => {
    setScreenMode(mode);
    try {
      window.quip.setWindowMode(mode);
    } catch {
      /* non-fatal — main may still switch the window */
    }
  };

  if (!open) return null;

  const dark = isDarkTheme(theme);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="quip-settings-surface absolute inset-0 z-40 flex flex-col"
    >
      {/* Header — Quip logo + identity, calm premium */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: `1px solid rgba(var(--quip-line), 0.07)` }}
      >
        <div className="flex items-center gap-2.5">
          <img
            src={quipMark}
            alt="Quip"
            width={30}
            height={30}
            style={{ borderRadius: 10, boxShadow: "0 2px 8px rgba(var(--quip-accent), 0.25)" }}
            draggable={false}
          />
          <div className="flex flex-col">
            <h3 style={{ fontSize: 14.5, fontWeight: 700, color: "rgb(var(--quip-text))", letterSpacing: "-0.01em" }}>
              Settings
            </h3>
            <span data-tone="soft" style={{ fontSize: 9.5, color: "rgba(var(--quip-text-soft), 0.9)", marginTop: 1 }}>
              Make Quip yours — brain, look, and desktop presence
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close settings"
          className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-black/[0.05]"
          style={{ color: "rgba(var(--quip-text-soft), 1)" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* UX-020 — settings search: jumps to the tab that owns the keyword */}
      <div className="px-3 pt-3" style={{ borderBottom: "none" }}>
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setSearchQuery("");
            }
          }}
          placeholder="Search settings — key, theme, density, budget…"
          aria-label="Search settings"
          className="quip-input"
          style={{ padding: "7px 12px", fontSize: 11.5 }}
        />
        {searchQuery.trim() !== "" && (
          <div style={{ fontSize: 9.5, marginTop: 4, color: "rgba(var(--quip-text-soft), 0.95)" }}>
            {searchMatch
              ? <>Filtered to <strong style={{ color: "rgb(var(--quip-accent-deep))" }}>{searchMatch}</strong> — Esc or clear to browse everything.</>
              : "No section matches that — try: key, theme, density, budget, memory, problem…"}
          </div>
        )}
      </div>

      {/* Tabs — animated theme-colored pill */}
      <div
        className="flex gap-1 px-3 py-2 overflow-x-auto"
        style={{ borderBottom: `1px solid rgba(var(--quip-line), 0.05)` }}
      >
        {(["ai", "appearance", "general", "desktop", "device", "memory", "dna", "progression", "problems"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            data-active={tab === t}
            className="quip-tab"
          >
            {tab === t && (
              <motion.span
                layoutId="settings-tab-pill"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 10,
                  background: "rgba(var(--quip-accent), 0.15)",
                  border: "1px solid rgba(var(--quip-accent), 0.35)",
                }}
              />
            )}
            <span style={{ position: "relative" }}>
              {t === "dna" ? "Communication DNA" : t === "ai" ? "AI Brain" : t === "problems" ? "Problems" : t}
            </span>
          </button>
        ))}
      </div>

      {/* Body — with tab transition */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.15 }}
          >
        {tab === "ai" && (
          <div className="flex flex-col gap-4">
            {/* Live status */}
            {modelStatus && (
              <div
                className="flex items-center justify-between rounded-xl px-3 py-2.5"
                style={{
                  background: modelStatus.healthy ? "rgba(var(--quip-ok), 0.07)" : "rgba(var(--quip-bad), 0.06)",
                  border: `1px solid ${modelStatus.healthy ? "rgba(var(--quip-ok), 0.22)" : "rgba(var(--quip-bad), 0.22)"}`,
                }}
              >
                <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ background: modelStatus.healthy ? "rgb(var(--quip-ok))" : "rgb(var(--quip-bad))" }}
                  />
                  <div className="flex flex-col" style={{ minWidth: 0 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: "rgb(var(--quip-text))" }}>
                      {modelStatus.active?.label ?? "No provider"}
                    </span>
                    <span style={{ fontSize: 9.5, color: "rgba(var(--quip-text-soft), 0.95)" }}>
                      {modelStatus.healthy ? "Connected and ready" : "No working key yet"}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div style={{ fontSize: 11, color: "rgba(var(--quip-text-soft), 0.95)" }}>
              Paste a free API key below — Quip saves it for you. No file editing needed.
            </div>

            {/* ONE-CLICK CHECKUP — real probes of network + every provider + voices */}
            <div
              className="rounded-xl px-3 py-2.5"
              style={{ border: "1px solid rgba(var(--quip-line), 0.08)", background: "rgba(var(--quip-line), 0.02)" }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-col" style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: "rgb(var(--quip-text))" }}>Full checkup</span>
                  <span style={{ fontSize: 9.5, color: "rgba(var(--quip-text-soft), 0.95)" }}>
                    Tests the network path, every provider's key AND model, the voice engines — and tells you exactly what's wrong.
                  </span>
                </div>
                <button
                  onClick={handleRunDoctor}
                  disabled={doctorRunning}
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: "#fff",
                    background: doctorRunning ? "rgba(var(--quip-line), 0.25)" : "rgb(var(--quip-accent-deep))",
                    border: "none",
                    borderRadius: 8,
                    padding: "6px 12px",
                    cursor: doctorRunning ? "default" : "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {doctorRunning ? "Checking…" : "Run checkup"}
                </button>
              </div>
              {doctorReport && (
                <div className="mt-2 flex flex-col gap-1.5">
                  <div
                    className="rounded-lg px-2.5 py-1.5"
                    style={{
                      fontSize: 10.5,
                      fontWeight: 600,
                      color: doctorReport.network?.ok === false ? "rgb(var(--quip-bad))" : "rgb(var(--quip-text))",
                      background: "rgba(var(--quip-line), 0.04)",
                    }}
                  >
                    {doctorReport.verdict}
                  </div>
                  {/* Network status — shown either way, so "ok" is evidence too */}
                  {doctorReport.network && (
                    <div style={{ fontSize: 9.5, color: doctorReport.network.ok ? "rgb(var(--quip-ok))" : "rgb(var(--quip-bad))" }}>
                      {doctorReport.network.ok ? "✓ Network reachable" : "✗ Network blocked"}
                      {doctorReport.network.message ? ` — ${doctorReport.network.message}` : ""}
                    </div>
                  )}
                  {/* Per-provider rows — ok / latency / failure kind, honestly */}
                  {(doctorReport.providers ?? []).length > 0 && (
                    <div className="flex flex-col gap-1">
                      {(doctorReport.providers as Array<{ provider: string; label: string; ok: boolean; configured: boolean; enabled: boolean; latencyMs: number; kind: string; parkedForMs: number }>).map((p) => (
                        <div key={p.provider} className="flex items-center gap-2" style={{ minWidth: 0 }}>
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ background: p.ok ? "rgb(var(--quip-ok))" : p.configured ? "rgb(var(--quip-bad))" : "rgba(var(--quip-line), 0.25)" }}
                          />
                          <span style={{ fontSize: 10, fontWeight: 600, color: "rgb(var(--quip-text))" }}>
                            {p.label || p.provider}
                          </span>
                          <span style={{ fontSize: 9.5, color: p.ok ? "rgb(var(--quip-ok))" : "rgba(var(--quip-text-soft), 0.95)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {p.ok
                              ? `ok · ${Math.round(p.latencyMs)}ms`
                              : !p.enabled
                                ? "turned off"
                                : p.kind}
                          </span>
                          {!p.ok && p.parkedForMs > 0 && (
                            <span style={{ fontSize: 9, color: "rgb(var(--quip-warn))", whiteSpace: "nowrap" }}>
                              parked {Math.round(p.parkedForMs / 1000)}s
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {doctorReport.network?.ok === false && doctorReport.network?.message && (
                    <div style={{ fontSize: 9.5, color: "rgb(var(--quip-bad))" }}>{doctorReport.network.message}</div>
                  )}
                  {(doctorReport.envConflicts ?? []).length > 0 && (
                    <div style={{ fontSize: 9.5, color: "rgb(var(--quip-warn))" }}>
                      ⚠ Two different keys found for: {doctorReport.envConflicts.map((c: any) => c.key).join(", ")} — the Settings key now always wins.
                    </div>
                  )}
                  {(doctorReport.suggestions ?? []).slice(0, 6).map((s: string, i: number) => (
                    <div key={i} style={{ fontSize: 9.5, color: "rgb(var(--quip-text))" }}>• {s}</div>
                  ))}
                  {(doctorReport.journal ?? []).length > 0 && (
                    <details>
                      <summary style={{ fontSize: 9.5, color: "rgba(var(--quip-text-soft), 0.95)", cursor: "pointer" }}>Recent connection attempts</summary>
                      <div style={{ fontSize: 9, color: "rgba(var(--quip-text-soft), 0.95)", whiteSpace: "pre-wrap", fontFamily: "monospace", marginTop: 4 }}>
                        {doctorReport.journal
                          .map((e: any) => `${e.ok ? "✓" : "✗"} ${new Date(e.ts).toLocaleTimeString()} ${e.provider} (${Math.round(e.latencyMs)}ms)${e.note ? ` — ${e.note}` : ""}`)
                          .join("\n")}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>

            {/* Auto-resolve: REAL probes of both providers, honest badges */}
            <div
              className="rounded-xl px-3 py-2.5"
              style={{ border: "1px solid rgba(var(--quip-line), 0.08)", background: "rgba(var(--quip-line), 0.02)" }}
            >
              <div className="flex items-center justify-between gap-2">
                <span style={{ fontSize: 11, fontWeight: 600, color: "rgb(var(--quip-text))" }}>
                  Which provider works?
                </span>
                <button
                  onClick={handleResolveProviders}
                  disabled={resolving}
                  style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: "rgb(var(--quip-accent-deep))",
                    background: "rgba(var(--quip-accent), 0.14)",
                    border: "none",
                    borderRadius: 7,
                    padding: "3px 10px",
                    cursor: resolving ? "default" : "pointer",
                  }}
                >
                  {resolving ? "Checking…" : "Check again"}
                </button>
              </div>
              {providerStatuses && providerStatuses.length > 0 && (
                <div className="mt-2 flex flex-col gap-1.5">
                  {providerStatuses.map((s) => (
                    <div key={s.provider} className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: s.ok ? "rgb(var(--quip-ok))" : s.configured ? "rgb(var(--quip-bad))" : "rgba(var(--quip-line), 0.25)" }}
                      />
                      <span style={{ fontSize: 10.5, color: "rgb(var(--quip-text))", fontWeight: 600, textTransform: "capitalize" }}>
                        {s.provider}
                      </span>
                      <span style={{ fontSize: 10, color: s.ok ? "rgb(var(--quip-ok))" : "rgba(var(--quip-text-soft), 0.95)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {s.ok
                          ? `Connected ✓ (${s.latencyMs}ms)`
                          : s.message}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Provider priority + kill switches — which key is THE brain */}
            <div
              className="rounded-xl px-3 py-2.5"
              style={{ border: "1px solid rgba(var(--quip-line), 0.08)", background: "rgba(var(--quip-line), 0.02)" }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: "rgb(var(--quip-text))", marginBottom: 6 }}>
                Which key should be active?
              </div>
              <div className="flex flex-col gap-1.5">
                {AI_PROVIDERS.map((p) => {
                  const isPrimary = (providerConfig?.primary ?? "groq") === p.id;
                  const isEnabled = providerConfig?.enabled?.[p.id] ?? true;
                  const status = providerStatuses?.find((s) => s.provider === p.id);
                  return (
                    <div key={p.id} className="flex items-center justify-between gap-2">
                      <button
                        onClick={() => handleSetProviderConfig(p.id)}
                        disabled={savingConfig || !isEnabled}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1 transition-all"
                        style={{
                          border: `1.5px solid ${isPrimary ? "rgba(var(--quip-accent), 0.65)" : "rgba(var(--quip-line), 0.09)"}`,
                          background: isPrimary ? "rgba(var(--quip-accent), 0.09)" : "transparent",
                          cursor: isEnabled && !savingConfig ? "pointer" : "default",
                          opacity: isEnabled ? 1 : 0.45,
                        }}
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: isPrimary ? "rgb(var(--quip-accent-deep))" : "rgba(var(--quip-line), 0.2)" }}
                        />
                        <span style={{ fontSize: 11, fontWeight: 600, color: "rgb(var(--quip-text))" }}>{p.name}</span>
                        <span style={{ fontSize: 9.5, color: isPrimary ? "rgb(var(--quip-accent-deep))" : "rgba(var(--quip-text-soft), 0.85)", whiteSpace: "nowrap" }}>
                          {isPrimary ? "PRIMARY" : "make primary"}
                        </span>
                        {status?.ok && (
                          <span className="ml-auto shrink-0" style={{ fontSize: 9, color: "rgb(var(--quip-ok))" }}>
                            ✓ {status.latencyMs}ms
                          </span>
                        )}
                      </button>
                      <button
                        onClick={() => handleSetProviderConfig(isPrimary ? "groq" : (providerConfig?.primary ?? "groq"), { [p.id]: !isEnabled })}
                        disabled={savingConfig || (isPrimary && isEnabled)}
                        title={isPrimary && isEnabled ? "Make another provider primary first" : ""}
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: isEnabled ? "rgb(var(--quip-ok))" : "rgba(var(--quip-text-soft), 0.95)",
                          background: isEnabled ? "rgba(var(--quip-ok), 0.1)" : "rgba(var(--quip-line), 0.05)",
                          border: "none",
                          borderRadius: 7,
                          padding: "3px 10px",
                          cursor: savingConfig || (isPrimary && isEnabled) ? "default" : "pointer",
                          opacity: isPrimary && isEnabled ? 0.5 : 1,
                        }}
                      >
                        {isEnabled ? "ON" : "OFF"}
                      </button>
                    </div>
                  );
                })}
              </div>
              {providerConfig?.visionModel && (
                <div style={{ fontSize: 9.5, color: "rgba(var(--quip-text-soft), 0.95)", marginTop: 6 }}>
                  Screen vision runs on {providerConfig.visionModel} — no extra key needed.
                </div>
              )}
              {configNote && (
                <div style={{ fontSize: 10, color: "rgb(var(--quip-text))", marginTop: 6 }}>{configNote}</div>
              )}
            </div>

            {/* Provider picker */}
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-quip-gray">
                Provider
              </label>
              <div className="flex gap-2">
                {AI_PROVIDERS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setProvider(p.id);
                      setTestResult(null);
                      setSaveResult(null);
                      setBrowsing(false);
                      setDiscoveredModels([]);
                      setModelSearch("");
                      setModelBrowserNote(null);
                    }}
                    className="flex-1 rounded-xl px-3 py-2.5 text-left transition-all"
                    style={{
                      border: `1.5px solid ${provider === p.id ? "rgba(var(--quip-accent), 0.65)" : "rgba(var(--quip-line), 0.09)"}`,
                      background: provider === p.id ? "rgba(var(--quip-accent), 0.09)" : "rgba(var(--quip-line), 0.02)",
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 600, color: "rgb(var(--quip-text))" }}>{p.name}</div>
                    <div style={{ fontSize: 9.5, color: "rgba(var(--quip-text-soft), 0.95)", marginTop: 1 }}>{p.hint}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Key input (Ollama: local URL instead — no key needed) */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-quip-gray">
                  {AI_PROVIDERS.find((p) => p.id === provider)!.localOnly ? "Local server URL (optional)" : "API key"}
                </label>
                <a
                  href={AI_PROVIDERS.find((p) => p.id === provider)!.keyUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 10.5, color: "rgb(var(--quip-accent-deep))", textDecoration: "underline" }}
                >
                  {AI_PROVIDERS.find((p) => p.id === provider)!.localOnly ? "Get Ollama ↗" : "Get a free key ↗"}
                </a>
              </div>
              <input
                type={AI_PROVIDERS.find((p) => p.id === provider)!.localOnly ? "text" : "password"}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setSaveResult(null);
                  setTestResult(null);
                }}
                placeholder={
                  AI_PROVIDERS.find((p) => p.id === provider)!.localOnly
                    ? "http://127.0.0.1:11434/v1 (leave empty for the default)"
                    : `${AI_PROVIDERS.find((p) => p.id === provider)!.keyPrefix}…`
                }
                spellCheck={false}
                autoComplete="off"
                className="w-full rounded-xl px-3 py-2.5 outline-none transition-all focus:ring-2"
                style={{
                  fontSize: 12,
                  border: "1.5px solid rgba(var(--quip-line), 0.1)",
                  background: "rgba(var(--quip-line), 0.03)",
                  color: "rgb(var(--quip-text))",
                  // @ts-expect-error CSS var
                  "--tw-ring-color": "rgba(var(--quip-accent), 0.4)",
                }}
              />
            </div>

            {/* Model picker — browse EVERY model the provider has */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-quip-gray">
                  Model
                </label>
                <button
                  onClick={handleBrowseModels}
                  disabled={loadingModels}
                  style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: "rgb(var(--quip-accent-deep))",
                    background: "rgba(var(--quip-accent), 0.14)",
                    border: "none",
                    borderRadius: 7,
                    padding: "3px 10px",
                    cursor: loadingModels ? "default" : "pointer",
                  }}
                >
                  {loadingModels ? "Loading models…" : "Browse all models"}
                </button>
              </div>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={AI_PROVIDERS.find((p) => p.id === provider)!.modelPlaceholder}
                spellCheck={false}
                className="w-full rounded-xl px-3 py-2.5 outline-none transition-all focus:ring-2"
                style={{
                  fontSize: 12,
                  border: "1.5px solid rgba(var(--quip-line), 0.1)",
                  background: "rgba(var(--quip-line), 0.03)",
                  color: "rgb(var(--quip-text))",
                  // @ts-expect-error CSS var
                  "--tw-ring-color": "rgba(var(--quip-accent), 0.4)",
                }}
              />
              {browsing && (
                <div
                  className="mt-2 rounded-xl px-2.5 py-2"
                  style={{ border: "1px solid rgba(var(--quip-line), 0.09)", background: "rgba(var(--quip-line), 0.03)" }}
                >
                  {discoveredModels.length > 0 && (
                    <>
                      <input
                        type="text"
                        value={modelSearch}
                        onChange={(e) => setModelSearch(e.target.value)}
                        placeholder={`Search ${discoveredModels.length} models…`}
                        spellCheck={false}
                        className="mb-2 w-full rounded-lg px-2.5 py-1.5 outline-none"
                        style={{
                          fontSize: 11,
                          border: "1px solid rgba(var(--quip-line), 0.1)",
                          background: "rgba(var(--quip-line), 0.02)",
                          color: "rgb(var(--quip-text))",
                        }}
                      />
                      <div
                        className="flex flex-col overflow-y-auto"
                        style={{ maxHeight: 180, gap: 2 }}
                      >
                        {discoveredModels
                          .filter((m) =>
                            !modelSearch.trim() ||
                            m.id.toLowerCase().includes(modelSearch.toLowerCase()) ||
                            (m.ownedBy ?? "").toLowerCase().includes(modelSearch.toLowerCase())
                          )
                          .map((m) => {
                            const selected = model.trim() === m.id;
                            return (
                              <button
                                key={m.id}
                                onClick={() => handleSelectModel(m.id)}
                                disabled={saving}
                                className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors"
                                style={{
                                  background: selected ? "rgba(var(--quip-accent), 0.16)" : "transparent",
                                  border: "none",
                                  cursor: "pointer",
                                }}
                              >
                                <span
                                  className="truncate"
                                  style={{
                                    fontSize: 10.5,
                                    fontFamily: "monospace",
                                    color: selected ? "rgb(var(--quip-accent-deep))" : "rgb(var(--quip-text))",
                                    fontWeight: selected ? 700 : 400,
                                  }}
                                >
                                  {m.id}
                                </span>
                                {selected ? (
                                  <span style={{ fontSize: 9, fontWeight: 700, color: "rgb(var(--quip-accent-deep))", whiteSpace: "nowrap" }}>IN USE</span>
                                ) : (
                                  <span style={{ fontSize: 9, color: "rgba(var(--quip-text-soft), 0.85)", whiteSpace: "nowrap" }}>
                                    {m.ownedBy ?? ""}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                      </div>
                    </>
                  )}
                  {modelBrowserNote && (
                    <div style={{ fontSize: 10, color: "rgb(var(--quip-text))", padding: "2px 4px" }}>{modelBrowserNote}</div>
                  )}
                  {discoveredModels.length > 0 && (
                    <button
                      onClick={() => setBrowsing(false)}
                      style={{ fontSize: 9.5, color: "rgba(var(--quip-text-soft), 0.85)", background: "none", border: "none", cursor: "pointer", marginTop: 4 }}
                    >
                      Close list
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Voice — the companion SPEAKS */}
            <div
              className="rounded-xl px-3 py-2.5"
              style={{ border: "1px solid rgba(var(--quip-line), 0.08)", background: "rgba(var(--quip-line), 0.02)" }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-col" style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: "rgb(var(--quip-text))" }}>
                    Let Quip speak replies out loud
                  </span>
                  <span style={{ fontSize: 9.5, color: "rgba(var(--quip-text-soft), 0.95)" }}>
                    Groq neural voice first — falls back to this laptop's built-in voice, so it can always talk.
                  </span>
                </div>
                <button
                  onClick={() => handleSetSpeak({ enabled: !speakEnabled })}
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: speakEnabled ? "rgb(var(--quip-ok))" : "rgba(var(--quip-text-soft), 0.95)",
                    background: speakEnabled ? "rgba(var(--quip-ok), 0.1)" : "rgba(var(--quip-line), 0.05)",
                    border: "none",
                    borderRadius: 7,
                    padding: "3px 10px",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {speakEnabled ? "ON" : "OFF"}
                </button>
              </div>
              {speakEnabled && (
                <div className="mt-2 flex flex-col gap-1.5">
                  <div className="flex items-center gap-1.5">
                    {(["auto", "groq", "edge", "local"] as const).map((e) => (
                      <button
                        key={e}
                        onClick={() => handleSetSpeak({ engine: e })}
                        style={{
                          fontSize: 9.5,
                          fontWeight: 600,
                          color: speakEngine === e ? "rgb(var(--quip-accent-deep))" : "rgba(var(--quip-text-soft), 0.95)",
                          background: speakEngine === e ? "rgba(var(--quip-accent), 0.16)" : "rgba(var(--quip-line), 0.04)",
                          border: "none",
                          borderRadius: 6,
                          padding: "2px 8px",
                          cursor: "pointer",
                        }}
                      >
                        {e === "auto" ? "Auto" : e === "groq" ? "Groq voice" : e === "edge" ? "Free neural" : "Laptop voice"}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {[["Celeste-PlayAI", "Celeste"], ["Fritz-PlayAI", "Fritz"], ["Nera-PlayAI", "Nera"], ["Gail-PlayAI", "Gail"]].map(([v, label]) => (
                      <button
                        key={v}
                        onClick={() => handleSetSpeak({ voice: v })}
                        style={{
                          fontSize: 9,
                          fontWeight: 600,
                          color: speakVoice === v ? "rgb(var(--quip-accent-deep))" : "rgba(var(--quip-text-soft), 0.85)",
                          background: speakVoice === v ? "rgba(var(--quip-accent), 0.16)" : "transparent",
                          border: `1px solid ${speakVoice === v ? "rgba(var(--quip-accent), 0.5)" : "rgba(var(--quip-line), 0.08)"}`,
                          borderRadius: 6,
                          padding: "2px 7px",
                          cursor: "pointer",
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {/* Free Edge neural voices — Hinglish reads naturally here */}
                  <div className="flex items-center gap-1.5">
                    <span style={{ fontSize: 9, color: "rgba(var(--quip-text-soft), 0.85)", whiteSpace: "nowrap" }}>Free:</span>
                    {[["en-IN-NeerjaNeural", "Neerja (Hinglish)"], ["en-US-AriaNeural", "Aria"], ["en-US-GuyNeural", "Guy"]].map(([v, label]) => (
                      <button
                        key={v}
                        onClick={() => handleSetSpeak({ edgeVoice: v })}
                        style={{
                          fontSize: 9,
                          fontWeight: 600,
                          color: edgeVoice === v ? "rgb(var(--quip-accent-deep))" : "rgba(var(--quip-text-soft), 0.85)",
                          background: edgeVoice === v ? "rgba(var(--quip-accent), 0.16)" : "transparent",
                          border: `1px solid ${edgeVoice === v ? "rgba(var(--quip-accent), 0.5)" : "rgba(var(--quip-line), 0.08)"}`,
                          borderRadius: 6,
                          padding: "2px 7px",
                          cursor: "pointer",
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {speakNote && <div style={{ fontSize: 9.5, color: "rgb(var(--quip-text))", marginTop: 4 }}>{speakNote}</div>}
            </div>

            {/* Network transport — the escape hatch when a VPN/AV breaks ONE
                network stack (the other one usually still works). */}
            <div
              className="rounded-xl px-3 py-2.5"
              style={{ border: "1px solid rgba(var(--quip-line), 0.08)", background: "rgba(var(--quip-line), 0.02)" }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-col" style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: "rgb(var(--quip-text))" }}>Network route</span>
                  <span style={{ fontSize: 9.5, color: "rgba(var(--quip-text-soft), 0.95)" }}>
                    Auto tries both stacks. Behind a VPN/proxy/antivirus, pinning the other one often fixes "can't connect".
                  </span>
                </div>
                <div className="flex gap-1">
                  {(["auto", "net", "node"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => handleSetTransport(m)}
                      style={{
                        fontSize: 9.5,
                        fontWeight: 600,
                        color: transport === m ? "rgb(var(--quip-accent-deep))" : "rgba(var(--quip-text-soft), 0.95)",
                        background: transport === m ? "rgba(var(--quip-accent), 0.16)" : "rgba(var(--quip-line), 0.04)",
                        border: "none",
                        borderRadius: 6,
                        padding: "3px 8px",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {m === "auto" ? "Auto" : m === "net" ? "System" : "Direct"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={handleTestConnection}
                disabled={testing}
                className="flex-1 rounded-xl px-4 py-2.5 text-[12px] font-medium transition-all disabled:opacity-50"
                style={{ background: "rgba(var(--quip-line), 0.06)", color: "rgb(var(--quip-text))" }}
              >
                {testing ? "Testing…" : "Test connection"}
              </button>
              <button
                onClick={handleSaveKey}
                disabled={saving || !apiKey.trim()}
                className="flex-1 rounded-xl px-4 py-2.5 text-[12px] font-semibold text-white transition-all disabled:opacity-50"
                style={{ background: saving || !apiKey.trim() ? "rgba(var(--quip-line), 0.25)" : "linear-gradient(135deg, rgb(var(--quip-accent)), rgb(var(--quip-accent-2)))" }}
              >
                {saving ? "Saving…" : "Save key"}
              </button>
            </div>

            {/* Honest results */}
            {testResult && (
              <div
                className="rounded-xl px-3 py-2.5"
                style={{
                  fontSize: 11,
                  background: testResult.ok ? "rgba(var(--quip-ok), 0.08)" : "rgba(var(--quip-bad), 0.07)",
                  border: `1px solid ${testResult.ok ? "rgba(var(--quip-ok), 0.24)" : "rgba(var(--quip-bad), 0.24)"}`,
                  color: testResult.ok ? "rgb(var(--quip-ok))" : "rgb(var(--quip-bad))",
                }}
              >
                {testResult.ok ? "✓ " : "✗ "}{testResult.message}
              </div>
            )}
            {saveResult && (
              <div
                className="rounded-xl px-3 py-2.5"
                style={{
                  fontSize: 11,
                  background: saveResult.ok ? "rgba(var(--quip-ok), 0.08)" : "rgba(var(--quip-bad), 0.07)",
                  border: `1px solid ${saveResult.ok ? "rgba(var(--quip-ok), 0.24)" : "rgba(var(--quip-bad), 0.24)"}`,
                  color: saveResult.ok ? "rgb(var(--quip-ok))" : "rgb(var(--quip-bad))",
                }}
              >
                {saveResult.ok ? "✓ " : "✗ "}{saveResult.message}
              </div>
            )}

            {/* UX-033: MailWing — the mail brain's accounts + real outbox */}
            <div
              className="rounded-xl px-3 py-2.5"
              style={{ border: "1px solid rgba(var(--quip-line), 0.08)", background: "rgba(var(--quip-line), 0.02)" }}
            >
              <div className="flex items-center justify-between gap-2">
                <span style={{ fontSize: 11.5, fontWeight: 600, color: "rgb(var(--quip-text))" }}>MailWing outbox</span>
                <button
                  onClick={refreshMailwing}
                  disabled={mailLoading}
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: "rgb(var(--quip-accent-deep))",
                    background: "rgba(var(--quip-accent), 0.14)",
                    border: "none",
                    borderRadius: 7,
                    padding: "3px 10px",
                    cursor: mailLoading ? "default" : "pointer",
                  }}
                >
                  {mailLoading ? "Checking…" : "Refresh"}
                </button>
              </div>

              {/* Configured accounts — label, user, host:port, encryption badge */}
              {mailAccounts.length > 0 && (
                <div className="mt-2 flex flex-col gap-1.5">
                  {mailAccounts.map((a) => (
                    <div key={a.id} className="flex items-center gap-2" style={{ minWidth: 0 }}>
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: a.lastTestOk === false ? "rgb(var(--quip-bad))" : a.lastTestOk === true ? "rgb(var(--quip-ok))" : "rgba(var(--quip-line), 0.25)" }}
                      />
                      <span style={{ fontSize: 10, fontWeight: 600, color: "rgb(var(--quip-text))", whiteSpace: "nowrap" }}>
                        {a.label}{a.isDefault ? " · default" : ""}
                      </span>
                      <span style={{ fontSize: 9.5, color: "rgba(var(--quip-text-soft), 0.95)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {a.user} — {a.smtpHost}:{a.smtpPort}
                      </span>
                      <span
                        className="ml-auto shrink-0"
                        style={{
                          fontSize: 8.5,
                          fontWeight: 700,
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                          padding: "1px 6px",
                          borderRadius: 6,
                          color: a.passEncrypted ? "rgb(var(--quip-ok))" : "rgb(var(--quip-warn))",
                          background: a.passEncrypted ? "rgba(var(--quip-ok), 0.1)" : "rgba(var(--quip-warn), 0.12)",
                        }}
                      >
                        {a.passEncrypted ? "encrypted" : "no password"}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Last 12 real sends — status pills, honest empty state */}
              {mailOutbox.length === 0 ? (
                <div style={{ fontSize: 10, marginTop: 8, color: "rgba(var(--quip-text-soft), 0.95)" }}>
                  {mailLoading ? "Checking the outbox…" : "Nothing sent yet — Quip hasn't mailed anyone."}
                </div>
              ) : (
                <div className="mt-2 flex flex-col gap-1.5">
                  {mailOutbox.slice(0, 12).map((o) => (
                    <div key={o.id} className="flex items-center gap-2" style={{ minWidth: 0 }}>
                      <span
                        className="shrink-0"
                        style={{
                          fontSize: 8.5,
                          fontWeight: 700,
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                          padding: "1px 7px",
                          borderRadius: 7,
                          color: o.status === "sent" ? "rgb(var(--quip-ok))" : "rgb(var(--quip-bad))",
                          background: o.status === "sent" ? "rgba(var(--quip-ok), 0.1)" : "rgba(var(--quip-bad), 0.1)",
                        }}
                      >
                        {o.status}
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 600, color: "rgb(var(--quip-text))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {o.subject || "(no subject)"}
                      </span>
                      <span style={{ fontSize: 9.5, color: "rgba(var(--quip-text-soft), 0.95)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        to {o.to.join(", ")}
                      </span>
                      <span className="ml-auto shrink-0" style={{ fontSize: 9, color: "rgba(var(--quip-text-soft), 0.95)" }}>
                        {new Date(o.ts).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "appearance" && (
          <div className="flex flex-col gap-4">
            {/* Brand hero — the mascot with its clean rounded cuts */}
            <div
              className="relative overflow-hidden rounded-2xl px-4 py-5"
              style={{
                background:
                  "radial-gradient(120% 140% at 20% 0%, rgba(var(--quip-accent), 0.28) 0%, rgba(var(--quip-accent-2), 0.10) 42%, rgba(var(--quip-line), 0.04) 100%)",
                border: "1px solid rgba(var(--quip-accent), 0.30)",
              }}
            >
              <div className="flex items-center gap-4">
                <img
                  src={quipLogo}
                  alt="Quip logo"
                  width={76}
                  height={76}
                  draggable={false}
                  style={{
                    borderRadius: 24,
                    boxShadow: "0 8px 28px rgba(var(--quip-accent), 0.35)",
                    flexShrink: 0,
                  }}
                />
                <div className="flex min-w-0 flex-col">
                  <span style={{ fontSize: 17, fontWeight: 700, color: "rgb(var(--quip-text))", letterSpacing: -0.3 }}>
                    Quip
                  </span>
                  <span data-tone="soft" style={{ fontSize: 10.5, color: "rgba(var(--quip-text-soft), 0.95)", marginTop: 2, lineHeight: 1.45 }}>
                    Your desktop companion — one tap on the sprite opens this panel, expand any time for the full app.
                  </span>
                </div>
              </div>
            </div>

            {/* Bring Quip to the desktop — one tap, no terminal */}
            <div
              className="flex items-center justify-between gap-3 rounded-2xl px-4 py-4"
              style={{
                border: companionVisible ? "1px solid rgba(var(--quip-accent), 0.45)" : "1px solid rgba(var(--quip-line), 0.09)",
                background: companionVisible ? "rgba(var(--quip-accent), 0.10)" : "rgba(var(--quip-line), 0.035)",
              }}
            >
              <div className="flex min-w-0 flex-col">
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "rgb(var(--quip-text))" }}>
                  {companionVisible ? "Quip is on your desktop" : "Bring Quip to my desktop"}
                </span>
                <span data-tone="soft" style={{ fontSize: 10.5, color: "rgba(var(--quip-text-soft), 0.95)", marginTop: 2 }}>
                  {companionVisible
                    ? "The companion is floating right now — tap it to chat."
                    : "One tap puts the companion back on your screen. No terminal needed."}
                </span>
                {bringNote && (
                  <span style={{ fontSize: 10, marginTop: 4, color: "rgba(var(--quip-text-soft), 0.9)" }}>{bringNote}</span>
                )}
              </div>
              <button
                onClick={handleShowDesktop}
                disabled={bringing}
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#fff",
                  opacity: bringing ? 0.6 : 1,
                  background: "linear-gradient(135deg, rgb(var(--quip-accent)), rgb(var(--quip-accent-3)))",
                  border: "none",
                  borderRadius: 10,
                  padding: "8px 14px",
                  cursor: bringing ? "wait" : "pointer",
                  flexShrink: 0,
                }}
              >
                {bringing ? "Bringing…" : "Show Quip"}
              </button>
            </div>

            {/* Screen Mode — all four, one tap each (Mode 3 = TRUE full screen) */}
            <div
              className="rounded-2xl px-4 py-4"
              style={{ border: "1px solid rgba(var(--quip-line), 0.09)", background: "rgba(var(--quip-line), 0.035)" }}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: "rgb(var(--quip-text))" }}>Screen mode</span>
              <div className="mt-2.5 grid grid-cols-4 gap-2">
                {([
                  { id: "companion", label: "Companion" },
                  { id: "panel", label: "Panel" },
                  { id: "full", label: "Full App" },
                  { id: "fullscreen", label: "Full Screen" },
                ] as Array<{ id: WindowMode; label: string }>).map((m) => {
                  const active = screenMode === m.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => handleScreenMode(m.id)}
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        color: active ? "#fff" : "rgb(var(--quip-text-soft))",
                        background: active
                          ? "linear-gradient(135deg, rgb(var(--quip-accent)), rgb(var(--quip-accent-3)))"
                          : "rgba(var(--quip-line), 0.05)",
                        border: active ? "none" : "1px solid rgba(var(--quip-line), 0.10)",
                        borderRadius: 10,
                        padding: "8px 4px",
                        cursor: "pointer",
                      }}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
              <span data-tone="soft" style={{ fontSize: 10, color: "rgba(var(--quip-text-soft), 0.9)", marginTop: 6, display: "block" }}>
                Full Screen takes the whole display — Esc or the same button brings the app back.
              </span>
            </div>

            {/* Palette pointer — the full picker lives in General */}
            <div
              className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3"
              style={{ border: "1px solid rgba(var(--quip-line), 0.09)", background: "rgba(var(--quip-line), 0.035)" }}
            >
              <div className="flex min-w-0 flex-col">
                <span style={{ fontSize: 12, fontWeight: 700, color: "rgb(var(--quip-text))" }}>Theme & palette</span>
                <span data-tone="soft" style={{ fontSize: 10, color: "rgba(var(--quip-text-soft), 0.95)", marginTop: 2 }}>
                  10 palettes — Cloud, Aqua, Bubblegum, Violet, Mint, Sunset, Ocean, Forest, Midnight, Carbon — in General.
                </span>
              </div>
              <button
                onClick={() => setTab("general")}
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "rgb(var(--quip-accent-deep))",
                  background: "rgba(var(--quip-accent), 0.14)",
                  border: "none",
                  borderRadius: 10,
                  padding: "8px 14px",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                Open themes
              </button>
            </div>

            {/* UX-050: bubble style — how chat bubbles render (QuipSay reads it) */}
            <div
              className="rounded-2xl px-4 py-4"
              style={{ border: "1px solid rgba(var(--quip-line), 0.09)", background: "rgba(var(--quip-line), 0.035)" }}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: "rgb(var(--quip-text))" }}>Bubble style</span>
              <div className="mt-2.5 grid grid-cols-3 gap-2">
                {([
                  { id: "glass", label: "Glass", desc: "Frosted, translucent" },
                  { id: "solid", label: "Solid", desc: "Opaque, max readability" },
                  { id: "outline", label: "Outline", desc: "Border-only, lightest" },
                ] as Array<{ id: "glass" | "solid" | "outline"; label: string; desc: string }>).map((s) => {
                  const active = bubbleStyle === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => handleSetBubbleStyle(s.id)}
                      aria-pressed={active}
                      style={{
                        textAlign: "left",
                        borderRadius: 12,
                        padding: "9px 11px",
                        cursor: "pointer",
                        border: active ? "1.5px solid rgba(var(--quip-accent), 0.7)" : "1px solid rgba(var(--quip-line), 0.1)",
                        background: active ? "rgba(var(--quip-accent), 0.09)" : "rgba(var(--quip-line), 0.03)",
                      }}
                    >
                      <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: active ? "rgb(var(--quip-accent-deep))" : "rgb(var(--quip-text))" }}>
                        {s.label}
                      </span>
                      <span style={{ display: "block", fontSize: 9.5, color: "rgba(var(--quip-text-soft), 0.95)", marginTop: 2 }}>
                        {s.desc}
                      </span>
                    </button>
                  );
                })}
              </div>
              <span data-tone="soft" style={{ fontSize: 10, color: "rgba(var(--quip-text-soft), 0.9)", marginTop: 6, display: "block" }}>
                Applies to chat bubbles and the companion's speech bubble.
              </span>
            </div>
          </div>
        )}

        {tab === "general" && (
          <div className="flex flex-col gap-5">
            {/* UX-002: sound effects — per-companion pitched blips, honest toggle */}
            <div
              className="flex items-center justify-between rounded-xl px-3 py-2.5"
              style={{ background: "rgba(var(--quip-line), 0.03)", border: "1px solid rgba(var(--quip-line), 0.09)" }}
            >
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: "rgb(var(--quip-text))" }}>Sound effects</div>
                <div style={{ fontSize: 10, color: "rgba(var(--quip-text-soft), 0.9)", marginTop: 1 }}>
                  Send, success, failure and quest blips — each companion has its own pitch.
                </div>
              </div>
              <button
                onClick={() => {
                  const next = !(loadPrefs().soundsMuted ?? false);
                  savePrefs({ soundsMuted: next });
                  setSoundsMuted(next);
                  setSoundsOn(!next);
                }}
                aria-pressed={!soundsOn}
                aria-label="Toggle sound effects"
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  padding: "4px 12px",
                  borderRadius: 999,
                  cursor: "pointer",
                  border: "none",
                  color: soundsOn ? "#fff" : "rgba(var(--quip-text-soft), 0.95)",
                  background: soundsOn ? "linear-gradient(135deg, rgb(var(--quip-accent)), rgb(var(--quip-accent-3)))" : "rgba(var(--quip-line), 0.08)",
                }}
              >
                {soundsOn ? "On" : "Muted"}
              </button>
            </div>
            {/* Theme picker — the palette, the user's way. Applies live. */}
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide" style={{ color: "rgba(var(--quip-text-soft), 1)" }}>
                Theme
              </label>
              <div className="grid grid-cols-5 gap-2">
                {THEMES.map((t) => {
                  const active = theme === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => handleSetTheme(t.id)}
                      title={`${t.label} theme`}
                      className="flex flex-col items-center gap-1.5 rounded-xl px-1 py-2 transition-all"
                      style={{
                        border: `1.5px solid ${active ? "rgba(var(--quip-accent), 0.75)" : "rgba(var(--quip-line), 0.08)"}`,
                        background: active ? "rgba(var(--quip-accent), 0.09)" : "rgba(var(--quip-line), 0.02)",
                        cursor: "pointer",
                      }}
                    >
                      <span
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 9,
                          background: `linear-gradient(135deg, ${t.swatch[0]}, ${t.swatch[1]})`,
                          boxShadow: active
                            ? "0 2px 10px rgba(var(--quip-accent), 0.45)"
                            : "0 1px 4px rgba(0,0,0,0.18)",
                          border: "1px solid rgba(255,255,255,0.25)",
                        }}
                      />
                      <span style={{ fontSize: 9, fontWeight: active ? 700 : 500, color: active ? "rgb(var(--quip-text))" : "rgba(var(--quip-text-soft), 1)" }}>
                        {t.label}
                      </span>
                    </button>
                  );
                })}
              </div>
              {dark && (
                <div data-tone="soft" style={{ fontSize: 9.5, color: "rgba(var(--quip-text-soft), 0.9)", marginTop: 6 }}>
                  Dark themes glow best at night — everything re-colors instantly.
                </div>
              )}
            </div>

            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide" style={{ color: "rgba(var(--quip-text-soft), 1)" }}>
                Companion
              </label>
              <CompanionSwitch activeId={companionId} onSelect={onCompanionChange} />
            </div>

            {/* UX-042: UI type scale — chat text grows/shrinks everywhere */}
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide" style={{ color: "rgba(var(--quip-text-soft), 1)" }}>
                Text size
              </label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { id: "compact", label: "Compact", desc: "Small & dense" },
                  { id: "comfortable", label: "Comfortable", desc: "The default" },
                  { id: "spacious", label: "Spacious", desc: "Easy on the eyes" },
                ] as Array<{ id: "compact" | "comfortable" | "spacious"; label: string; desc: string }>).map((s) => {
                  const active = uiSize === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => handleSetUISize(s.id)}
                      aria-pressed={active}
                      style={{
                        textAlign: "left",
                        borderRadius: 12,
                        padding: "9px 11px",
                        cursor: "pointer",
                        border: active ? "1.5px solid rgba(var(--quip-accent), 0.7)" : "1px solid rgba(var(--quip-line), 0.1)",
                        background: active ? "rgba(var(--quip-accent), 0.09)" : "rgba(var(--quip-line), 0.03)",
                      }}
                    >
                      <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: active ? "rgb(var(--quip-accent-deep))" : "rgb(var(--quip-text))" }}>
                        {s.label}
                      </span>
                      <span style={{ display: "block", fontSize: 9.5, color: "rgba(var(--quip-text-soft), 0.95)", marginTop: 2 }}>
                        {s.desc}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* UX-046: chat density — line spacing inside messages */}
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide" style={{ color: "rgba(var(--quip-text-soft), 1)" }}>
                Chat density
              </label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { id: "comfortable", label: "Comfortable", desc: "Relaxed line spacing" },
                  { id: "compact", label: "Compact", desc: "Tighter lines, more on screen" },
                ] as Array<{ id: "comfortable" | "compact"; label: string; desc: string }>).map((s) => {
                  const active = density === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => handleSetDensity(s.id)}
                      aria-pressed={active}
                      style={{
                        textAlign: "left",
                        borderRadius: 12,
                        padding: "9px 11px",
                        cursor: "pointer",
                        border: active ? "1.5px solid rgba(var(--quip-accent), 0.7)" : "1px solid rgba(var(--quip-line), 0.1)",
                        background: active ? "rgba(var(--quip-accent), 0.09)" : "rgba(var(--quip-line), 0.03)",
                      }}
                    >
                      <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: active ? "rgb(var(--quip-accent-deep))" : "rgb(var(--quip-text))" }}>
                        {s.label}
                      </span>
                      <span style={{ display: "block", fontSize: 9.5, color: "rgba(var(--quip-text-soft), 0.95)", marginTop: 2 }}>
                        {s.desc}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* UX-043: accent color — swatches + custom + honest reset */}
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide" style={{ color: "rgba(var(--quip-text-soft), 1)" }}>
                Accent color
              </label>
              <div className="flex flex-wrap items-center gap-2">
                {["#6FD6FF", "#7B8CFF", "#B98AFF", "#F472D6", "#34D399", "#F97316", "#E8B98A", "#A3E635"].map((hex) => {
                  const active = (accent ?? "").toLowerCase() === hex.toLowerCase();
                  return (
                    <button
                      key={hex}
                      onClick={() => handleSetAccent(hex)}
                      aria-label={`Accent color ${hex}`}
                      aria-pressed={active}
                      title={hex}
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 9,
                        cursor: "pointer",
                        background: hex,
                        border: active ? "2px solid rgb(var(--quip-text))" : "1px solid rgba(var(--quip-line), 0.2)",
                        boxShadow: active ? "0 2px 10px rgba(var(--quip-accent), 0.45)" : "none",
                        padding: 0,
                      }}
                    />
                  );
                })}
                <input
                  type="color"
                  aria-label="Custom accent color"
                  title="Custom accent color"
                  value={accent && /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : "#6fd6ff"}
                  onChange={(e) => handleSetAccent(e.target.value)}
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 9,
                    border: "1px dashed rgba(var(--quip-line), 0.3)",
                    background: "transparent",
                    cursor: "pointer",
                    padding: 0,
                  }}
                />
                {accent && (
                  <button
                    onClick={() => handleSetAccent(null)}
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: "rgb(var(--quip-text-soft))",
                      background: "rgba(var(--quip-line), 0.06)",
                      border: "none",
                      borderRadius: 8,
                      padding: "4px 10px",
                      cursor: "pointer",
                    }}
                  >
                    Reset to theme
                  </button>
                )}
              </div>
              <div data-tone="soft" style={{ fontSize: 9.5, color: "rgba(var(--quip-text-soft), 0.9)", marginTop: 5 }}>
                {accent
                  ? `Custom accent applied (${accent}) — it overrides the theme until reset.`
                  : "Following the theme palette — pick a swatch to override it."}
              </div>
            </div>

            {/* UX-045: companion re-tint — the sprite colors the UI */}
            <div
              className="flex items-center justify-between gap-3 rounded-xl px-3 py-3"
              style={{ border: "1px solid rgba(var(--quip-line), 0.08)", background: "rgba(var(--quip-line), 0.02)" }}
            >
              <div className="flex flex-col" style={{ minWidth: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "rgb(var(--quip-text))" }}>
                  Companion re-tints the UI
                </span>
                <span style={{ fontSize: 10.5, color: "rgba(var(--quip-text-soft), 0.95)", marginTop: 2 }}>
                  {tintOn
                    ? `${getCompanion(companionId).name}'s color (${getCompanion(companionId).primary}) is now the UI accent.`
                    : "Off — the theme (or your custom accent) stays in charge."}
                </span>
              </div>
              <button
                role="switch"
                aria-checked={tintOn}
                aria-label="Companion re-tints the UI"
                onClick={handleToggleTint}
                className="relative shrink-0 rounded-full transition-colors"
                style={{
                  width: 44,
                  height: 25,
                  background: tintOn ? "linear-gradient(135deg, rgb(var(--quip-accent)), rgb(var(--quip-accent-3)))" : "rgba(var(--quip-line), 0.18)",
                }}
              >
                <motion.span
                  layout
                  transition={{ type: "spring", stiffness: 500, damping: 32 }}
                  style={{
                    position: "absolute",
                    top: 3,
                    left: tintOn ? 22 : 3,
                    width: 19,
                    height: 19,
                    borderRadius: "50%",
                    background: "#fff",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
                  }}
                />
              </button>
            </div>

            {/* UX-049: custom quick replies — A1's ChatInput renders the chips */}
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide" style={{ color: "rgba(var(--quip-text-soft), 1)" }}>
                Custom quick replies
              </label>
              <textarea
                className="quip-input"
                aria-label="Custom quick replies, one chip per line"
                rows={3}
                value={quickReplies}
                onChange={(e) => handleQuickRepliesChange(e.target.value)}
                placeholder={"One chip per line, e.g.\nSummarize this\nDraft a reply"}
                style={{ padding: "8px 10px", fontSize: 11, resize: "vertical", lineHeight: 1.5 }}
              />
              <div style={{ fontSize: 9.5, color: "rgba(var(--quip-text-soft), 0.95)", marginTop: 4 }}>
                Max 8 chips, 60 characters each — shown above the composer.
              </div>
              {(() => {
                const chips = quickReplies.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 8);
                if (chips.length === 0) return null;
                return (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {chips.map((c, i) => (
                      <span
                        key={i}
                        style={{
                          fontSize: 9.5,
                          fontWeight: 600,
                          color: "rgb(var(--quip-text))",
                          background: "rgba(var(--quip-accent), 0.12)",
                          border: "1px solid rgba(var(--quip-accent), 0.3)",
                          borderRadius: 8,
                          padding: "3px 9px",
                        }}
                      >
                        {c.slice(0, 60)}
                      </span>
                    ))}
                  </div>
                );
              })()}
            </div>

            {/* UX-018: global summon hotkey — lives in General so it's findable */}
            <div style={{ fontSize: 10.5, color: "rgba(var(--quip-text-soft), 0.95)" }}>
              <strong style={{ color: "rgb(var(--quip-text))", fontFamily: "ui-monospace, monospace" }}>Ctrl+Shift+Space</strong>{" "}
              — summon/hide Quip from anywhere, even while another app is focused.
            </div>
          </div>
        )}

        {tab === "desktop" && (
          <div className="flex flex-col gap-4">
            {/* ── QUIP APPEARANCE — the one-tap "bring Quip to my desktop".
                Companion appears with its logo look + the full app page
                opens. No terminal, no hunting. ── */}
            <div
              className="rounded-2xl p-3"
              style={{
                border: "1px solid rgba(var(--quip-accent), 0.3)",
                background: "linear-gradient(135deg, rgba(var(--quip-accent), 0.10), rgba(var(--quip-accent-2), 0.08))",
              }}
            >
              <div className="flex items-center gap-3">
                <img
                  src={quipLogo}
                  alt="Quip logo"
                  width={52}
                  height={52}
                  style={{ borderRadius: 14, boxShadow: "0 4px 14px rgba(var(--quip-accent), 0.35)", flexShrink: 0 }}
                  draggable={false}
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span style={{ fontSize: 13, fontWeight: 700, color: "rgb(var(--quip-text))" }}>
                    Quip Appearance
                  </span>
                  <span data-tone="soft" style={{ fontSize: 10, color: "rgba(var(--quip-text-soft), 0.95)", marginTop: 1 }}>
                    Bring Quip onto your desktop — companion shows up with its logo and the app opens right away. No terminal.
                  </span>
                </div>
                <button
                  onClick={handleShowDesktop}
                  disabled={bringing}
                  className="quip-btn-accent shrink-0 rounded-xl px-4 py-2.5 text-[12px] font-bold"
                >
                  {bringing ? "Bringing…" : "Show Quip"}
                </button>
              </div>
              {bringNote && (
                <div
                  className="mt-2 rounded-lg px-2.5 py-1.5"
                  style={{
                    fontSize: 10.5,
                    background: "rgba(var(--quip-ok), 0.09)",
                    color: dark ? "rgb(var(--quip-ok))" : "rgb(var(--quip-ok))",
                    border: "1px solid rgba(var(--quip-ok), 0.25)",
                  }}
                >
                  ✓ {bringNote}
                </div>
              )}
            </div>

            {/* ── FETCH UPDATES — pull the latest Quip code, honestly. ── */}
            <div className="quip-card px-3 py-3">
              <div className="flex items-center gap-3">
                <img
                  src={quipMark}
                  alt="Quip"
                  width={40}
                  height={40}
                  style={{ borderRadius: 11, boxShadow: "0 2px 8px rgba(var(--quip-accent), 0.28)", flexShrink: 0 }}
                  draggable={false}
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "rgb(var(--quip-text))" }}>
                    Fetch Updates
                  </span>
                  <span data-tone="soft" style={{ fontSize: 10, color: "rgba(var(--quip-text-soft), 0.95)", marginTop: 1 }}>
                    When the repo gets new code, fetch it here — one tap, no terminal.
                  </span>
                </div>
                <button
                  onClick={handleFetchUpdates}
                  disabled={fetching}
                  className="shrink-0 rounded-xl px-4 py-2.5 text-[12px] font-bold transition-all"
                  style={{
                    color: "rgb(var(--quip-accent-deep))",
                    background: "rgba(var(--quip-accent), 0.14)",
                    border: "1.5px solid rgba(var(--quip-accent), 0.45)",
                    cursor: fetching ? "default" : "pointer",
                    opacity: fetching ? 0.6 : 1,
                  }}
                >
                  {fetching ? "Fetching…" : "Fetch now"}
                </button>
              </div>
              {fetchResult && (
                <div
                  className="mt-2 rounded-lg px-2.5 py-1.5"
                  style={{
                    fontSize: 10.5,
                    background: fetchResult.ok ? "rgba(var(--quip-ok), 0.09)" : "rgba(var(--quip-bad), 0.08)",
                    color: fetchResult.ok
                      ? "rgb(var(--quip-ok))"
                      : "rgb(var(--quip-bad))",
                    border: `1px solid ${fetchResult.ok ? "rgba(var(--quip-ok), 0.25)" : "rgba(var(--quip-bad), 0.25)"}`,
                  }}
                >
                  {fetchResult.ok ? "✓ " : "✗ "}{fetchResult.message}
                  {fetchResult.needsRestart && (
                    <button
                      onClick={() => window.quip.quitApp()}
                      style={{
                        marginLeft: 8,
                        fontSize: 10,
                        fontWeight: 700,
                        color: "rgb(var(--quip-accent-deep))",
                        background: "rgba(var(--quip-accent), 0.14)",
                        border: "none",
                        borderRadius: 6,
                        padding: "2px 8px",
                        cursor: "pointer",
                      }}
                    >
                      Restart now
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Desktop shortcut — the REAL app icon on the home screen.
                Double-tap it anywhere and Quip appears; no terminal, ever. */}
            <div
              className="flex items-center justify-between gap-3 rounded-xl px-3 py-3"
              style={{
                border: shortcutResult?.ok ? "1px solid rgba(var(--quip-ok), 0.35)" : "1px solid rgba(var(--quip-line), 0.08)",
                background: "rgba(var(--quip-line), 0.02)",
              }}
            >
              <div className="flex min-w-0 flex-col">
                <span style={{ fontSize: 12, fontWeight: 600, color: "rgb(var(--quip-text))" }}>
                  Quip icon on my desktop
                </span>
                <span style={{ fontSize: 10.5, color: "rgba(var(--quip-text-soft), 0.95)", marginTop: 2 }}>
                  One real icon on your home screen — double-tap it and Quip appears. No terminal, ever.
                </span>
                {shortcutResult && (
                  <span
                    style={{
                      fontSize: 10,
                      marginTop: 4,
                      color: shortcutResult.ok ? "rgb(var(--quip-ok))" : "rgb(var(--quip-bad))",
                    }}
                  >
                    {shortcutResult.ok ? "✓ " : "✗ "}{shortcutResult.message}
                  </span>
                )}
              </div>
              <button
                onClick={handleAddShortcut}
                disabled={shortcutBusy}
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#fff",
                  opacity: shortcutBusy ? 0.6 : 1,
                  background: "linear-gradient(135deg, rgb(var(--quip-accent)), rgb(var(--quip-accent-3)))",
                  border: "none",
                  borderRadius: 10,
                  padding: "8px 14px",
                  cursor: shortcutBusy ? "wait" : "pointer",
                  flexShrink: 0,
                }}
              >
                {shortcutBusy ? "Creating…" : "Create shortcut"}
              </button>
            </div>

            {/* Companion visibility — the setting the user asked for */}
            <div
              className="flex items-center justify-between gap-3 rounded-xl px-3 py-3"
              style={{ border: "1px solid rgba(var(--quip-line), 0.08)", background: "rgba(var(--quip-line), 0.02)" }}
            >
              <div className="flex flex-col" style={{ minWidth: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "rgb(var(--quip-text))" }}>
                  Keep companion on my screen
                </span>
                <span style={{ fontSize: 10.5, color: "rgba(var(--quip-text-soft), 0.95)", marginTop: 2 }}>
                  Always visible until you turn it off here. Nothing floating when off.
                </span>
              </div>
              <button
                role="switch"
                aria-checked={companionVisible}
                aria-label="Keep companion on my screen"
                onClick={() => handleToggleVisible(!companionVisible)}
                className="relative shrink-0 rounded-full transition-colors"
                style={{
                  width: 44,
                  height: 25,
                  background: companionVisible ? "linear-gradient(135deg, rgb(var(--quip-accent)), rgb(var(--quip-accent-3)))" : "rgba(var(--quip-line), 0.18)",
                }}
              >
                <motion.span
                  layout
                  transition={{ type: "spring", stiffness: 500, damping: 32 }}
                  style={{
                    position: "absolute",
                    top: 3,
                    left: companionVisible ? 22 : 3,
                    width: 19,
                    height: 19,
                    borderRadius: "50%",
                    background: "#fff",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
                  }}
                />
              </button>
            </div>

            <div style={{ fontSize: 10.5, color: "rgba(var(--quip-text-soft), 0.85)" }}>
              The cross button (X) only clears the app screen — your companion stays on the desktop.
              Quip leaves the screen only when you quit it right here.
            </div>

            {/* Proactive check-ins — main-process reminder engine, user-controlled */}
            <div
              className="flex items-center justify-between gap-3 rounded-xl px-3 py-3"
              style={{ border: "1px solid rgba(var(--quip-line), 0.08)", background: "rgba(var(--quip-line), 0.02)" }}
            >
              <div className="flex flex-col" style={{ minWidth: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "rgb(var(--quip-text))" }}>
                  Let Quip check in on me
                </span>
                <span style={{ fontSize: 10.5, color: "rgba(var(--quip-text-soft), 0.95)", marginTop: 2 }}>
                  Small cute reminders now and then. Never at night, never spammy.
                </span>
              </div>
              <button
                role="switch"
                aria-checked={checkInsEnabled}
                aria-label="Let Quip check in on me"
                onClick={async () => {
                  try {
                    const next = await window.quip.setCheckInsEnabled(!checkInsEnabled);
                    setCheckInsEnabled(next);
                  } catch {
                    /* non-fatal */
                  }
                }}
                className="relative shrink-0 rounded-full transition-colors"
                style={{
                  width: 44,
                  height: 25,
                  background: checkInsEnabled ? "linear-gradient(135deg, rgb(var(--quip-accent)), rgb(var(--quip-accent-3)))" : "rgba(var(--quip-line), 0.18)",
                }}
              >
                <motion.span
                  layout
                  transition={{ type: "spring", stiffness: 500, damping: 32 }}
                  style={{
                    position: "absolute",
                    top: 3,
                    left: checkInsEnabled ? 22 : 3,
                    width: 19,
                    height: 19,
                    borderRadius: "50%",
                    background: "#fff",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
                  }}
                />
              </button>
            </div>

            {/* Permission mode — what Quip may auto-run without asking */}
            <div
              className="rounded-xl px-3 py-3"
              style={{ border: "1px solid rgba(var(--quip-line), 0.08)", background: "rgba(var(--quip-line), 0.02)" }}
            >
              <div className="flex flex-col" style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "rgb(var(--quip-text))" }}>
                  Ask before actions
                </span>
                <span style={{ fontSize: 10.5, color: "rgba(var(--quip-text-soft), 0.95)", marginTop: 2 }}>
                  How much Quip may do on its own. Opening apps and reading your screen is always
                  included; deleting, sending or buying always asks first in every mode.
                </span>
              </div>
              <div className="flex gap-2">
                {[
                  { id: "ask_every_time", label: "Ask everything" },
                  { id: "approve_task", label: "Smart (default)" },
                  { id: "full_access", label: "Full trust" },
                ].map((m) => {
                  const active = permMode?.mode === m.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => handleSetPermMode(m.id)}
                      aria-pressed={active}
                      className="flex-1 rounded-lg px-2 py-2 text-[10.5px] font-semibold transition-all"
                      style={{
                        border: `1px solid ${active ? "rgb(var(--quip-accent))" : "rgba(var(--quip-line), 0.14)"}`,
                        background: active ? "rgba(var(--quip-accent), 0.12)" : "transparent",
                        color: active ? "rgb(var(--quip-accent-deep))" : "rgb(var(--quip-text-soft))",
                      }}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 10, color: "rgba(var(--quip-text-soft), 0.8)", marginTop: 6 }}>
                {permMode?.mode === "ask_every_time"
                  ? "Quip asks before every action that changes anything."
                  : permMode?.mode === "full_access"
                    ? "Quip runs most actions without asking. Risky ones still get a gate."
                    : "Quip runs everyday actions (open, search, read) on its own; sends, deletes and purchases always ask."}
              </div>
            </div>

            {/* CAP-060: autonomy budget — how often the SAME destructive
                confirmation may auto-approve inside one quest. */}
            <div
              className="rounded-xl px-3 py-3"
              style={{ border: "1px solid rgba(var(--quip-line), 0.08)", background: "rgba(var(--quip-line), 0.02)" }}
            >
              <div className="flex flex-col" style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "rgb(var(--quip-text))" }}>
                  Autonomy budget
                </span>
                <span style={{ fontSize: 10.5, color: "rgba(var(--quip-text-soft), 0.95)", marginTop: 2 }}>
                  How many times the SAME destructive confirmation may auto-approve inside one quest (0 = ask every time).
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => handleSetQuestBudget(Math.max(0, (questBudget ?? 0) - 1))}
                  disabled={questBudget === null || questBudget <= 0}
                  aria-label="Decrease autonomy budget"
                  style={{
                    width: 26,
                    height: 26,
                    fontSize: 13,
                    fontWeight: 700,
                    lineHeight: 1,
                    color: "rgb(var(--quip-text))",
                    background: "rgba(var(--quip-line), 0.06)",
                    border: "1px solid rgba(var(--quip-line), 0.12)",
                    borderRadius: 8,
                    cursor: questBudget !== null && questBudget > 0 ? "pointer" : "default",
                    opacity: questBudget !== null && questBudget > 0 ? 1 : 0.4,
                  }}
                >
                  −
                </button>
                <span
                  aria-live="polite"
                  style={{
                    minWidth: 34,
                    textAlign: "center",
                    fontSize: 14,
                    fontWeight: 700,
                    color: "rgb(var(--quip-text))",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {questBudget === null ? "…" : budgetDraft ?? questBudget}
                </span>
                <button
                  onClick={() => handleSetQuestBudget(Math.min(20, (questBudget ?? 0) + 1))}
                  disabled={questBudget === null || questBudget >= 20}
                  aria-label="Increase autonomy budget"
                  style={{
                    width: 26,
                    height: 26,
                    fontSize: 13,
                    fontWeight: 700,
                    lineHeight: 1,
                    color: "rgb(var(--quip-text))",
                    background: "rgba(var(--quip-line), 0.06)",
                    border: "1px solid rgba(var(--quip-line), 0.12)",
                    borderRadius: 8,
                    cursor: questBudget !== null && questBudget < 20 ? "pointer" : "default",
                    opacity: questBudget !== null && questBudget < 20 ? 1 : 0.4,
                  }}
                >
                  +
                </button>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={1}
                  value={budgetDraft ?? Math.min(questBudget ?? 0, 10)}
                  aria-label="Autonomy budget slider"
                  onChange={(e) => setBudgetDraft(Number(e.target.value))}
                  onMouseUp={() => budgetDraft !== null && handleSetQuestBudget(budgetDraft)}
                  onTouchEnd={() => budgetDraft !== null && handleSetQuestBudget(budgetDraft)}
                  onKeyUp={() => budgetDraft !== null && handleSetQuestBudget(budgetDraft)}
                  style={{ flex: 1, accentColor: "rgb(var(--quip-accent))", cursor: "pointer" }}
                />
                <span style={{ fontSize: 9, color: "rgba(var(--quip-text-soft), 0.9)", whiteSpace: "nowrap" }}>
                  slider caps at 10
                </span>
              </div>
              <div style={{ fontSize: 9.5, color: (questBudget ?? 0) === 0 ? "rgb(var(--quip-accent-deep))" : "rgba(var(--quip-text-soft), 0.9)", marginTop: 6 }}>
                {(questBudget ?? 0) === 0
                  ? "Ask every time — nothing destructive happens without you."
                  : `Quip may reuse your approval up to ${questBudget} time(s) per quest, then asks again.`}
              </div>
              {budgetNote && (
                <div
                  className="mt-2 rounded-lg px-2.5 py-1.5"
                  style={{
                    fontSize: 10,
                    color: "rgb(var(--quip-text))",
                    background: "rgba(var(--quip-ok), 0.08)",
                    border: "1px solid rgba(var(--quip-ok), 0.22)",
                  }}
                >
                  {budgetNote}
                </div>
              )}
            </div>

            {/* The ONLY real quit */}
            <button
              onClick={() => setConfirmQuit(true)}
              className="w-full rounded-xl px-4 py-2.5 text-[12px] font-semibold text-white transition-all"
              style={{ background: "rgba(var(--quip-bad), 0.85)" }}
            >
              Quit Quip completely
            </button>
          </div>
        )}

        {tab === "device" && (
          <div className="flex flex-col gap-3">
            {device ? (
              <>
                <DataRow label="Platform" value={`${device.platformLabel} ${device.osVersion}`} />
                <DataRow label="Hostname" value={device.hostname} />
                <DataRow label="CPU" value={`${device.cpuModel} (${device.cpuCores} cores)`} />
                <DataRow label="Memory" value={`${device.totalMemoryGB} GB total`} />
                <DataRow label="Storage" value={`${device.storage.usedGB} / ${device.storage.totalGB} GB used`} />
                <DataRow label="Display" value={`${device.primaryResolution.width}×${device.primaryResolution.height} @ ${device.scaleFactor}x`} />
                <DataRow label="Monitors" value={String(device.monitorCount)} />
                <DataRow label="Default browser" value={device.defaultBrowser ?? "None detected"} />
                <DataRow label="Default editor" value={device.defaultEditor ?? "None detected"} />
                <DataRow label="Apps detected" value={String(device.apps.length)} />

                <button
                  onClick={handleRescan}
                  disabled={rescanning}
                  className="mt-2 w-full rounded-xl px-4 py-2 text-[12px] font-medium text-white transition-all disabled:opacity-50"
                  style={{
                    background: rescanning ? "rgba(var(--quip-line), 0.25)" : "linear-gradient(135deg, rgb(var(--quip-accent)), rgb(var(--quip-accent-2)))",
                  }}
                >
                  {rescanning ? "Scanning…" : "Rescan device"}
                </button>
              </>
            ) : (
              <div style={{ fontSize: 12, color: "rgba(var(--quip-text-soft), 0.85)" }}>No device profile yet.</div>
            )}
          </div>
        )}

        {tab === "memory" && (
          <div className="flex flex-col gap-2">
            {/* Prune button */}
            {memory && memory.memories.length > 5 && (
              <button
                onClick={() => setConfirmPrune(true)}
                disabled={pruning}
                className="mb-2 w-full rounded-xl px-4 py-2 text-[11px] font-medium text-white transition-all disabled:opacity-50"
                style={{ background: pruning ? "rgba(var(--quip-line), 0.25)" : "rgba(var(--quip-bad), 0.8)" }}
              >
                {pruning ? "Pruning…" : `Prune low-importance memories (${memory.memories.length})`}
              </button>
            )}

            {memory && memory.memories.length > 0 ? (
              memory.memories.map((m) => (
                <div
                  key={m.id}
                  className="flex items-start justify-between gap-2 rounded-lg px-3 py-2"
                  style={{
                    background: "rgba(var(--quip-line), 0.03)",
                    border: "1px solid rgba(var(--quip-line), 0.06)",
                  }}
                >
                  <div className="flex flex-col" style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "rgb(var(--quip-text))" }}>
                      {m.key}
                    </span>
                    <span style={{ fontSize: 11, color: "rgba(var(--quip-text-soft), 0.95)", wordBreak: "break-word" }}>
                      {m.value}
                    </span>
                    <span style={{ fontSize: 9, color: "rgba(var(--quip-text-soft), 0.85)", marginTop: 2 }}>
                      {m.kind} · {m.importance} · ×{m.weight}
                      {m.weight >= 10 ? " · 📌 pinned" : ""}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      onClick={() => handlePin(m.id)}
                      className="text-[10px] text-quip-gray transition-colors hover:text-blue-500"
                    >
                      {m.weight >= 10 ? "unpin" : "pin"}
                    </button>
                    <button
                      onClick={() => handleForget(m.id)}
                      className="text-[10px] text-quip-gray transition-colors hover:text-red-500"
                    >
                      forget
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div style={{ fontSize: 12, color: "rgba(var(--quip-text-soft), 0.85)" }}>
                No memories yet. Quip learns as you talk — after every ~10 messages it extracts facts about you automatically.
              </div>
            )}
          </div>
        )}

        {tab === "dna" && (
          <div className="flex flex-col gap-3">
            {profile ? (
              <>
                <div style={{ fontSize: 11, color: "rgba(var(--quip-text-soft), 0.95)", marginBottom: 4 }}>
                  Quip observes how you communicate and adapts its style to match yours.
                  This is your Communication DNA.
                </div>
                <DNABar
                  label="Response length"
                  value={profile.preferredResponseLength}
                  max={300}
                  unit="words"
                  display={
                    profile.preferredResponseLength < 30 ? "very short" :
                    profile.preferredResponseLength < 80 ? "short" :
                    profile.preferredResponseLength < 150 ? "medium" : "detailed"
                  }
                />
                <DNABar
                  label="Formality"
                  value={profile.formality * 100}
                  max={100}
                  unit="%"
                  display={profile.formality < 0.3 ? "casual" : profile.formality < 0.7 ? "balanced" : "formal"}
                />
                <DNABar
                  label="Emoji usage"
                  value={profile.emojiUsage * 100}
                  max={100}
                  unit="%"
                  display={profile.emojiUsage < 0.1 ? "rarely" : profile.emojiUsage < 0.4 ? "occasionally" : "frequently"}
                />
                <DNABar
                  label="Humor level"
                  value={profile.humorLevel * 100}
                  max={100}
                  unit="%"
                  display={profile.humorLevel < 0.3 ? "serious" : profile.humorLevel < 0.6 ? "light humor" : "humor welcome"}
                />
                <DataRow label="Avg message length" value={`${Math.round(profile.avgMessageLength)} chars`} />
                <DataRow label="Total interactions" value={String(profile.totalInteractions)} />
                <DataRow label="Code in responses" value={profile.wantsCodeInResponses ? "yes" : "no"} />

                {profile.topTopics && profile.topTopics.length > 0 && (
                  <div>
                    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-quip-gray">
                      Top topics
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {profile.topTopics.slice(0, 8).map((t: any) => (
                        <span
                          key={t.topic}
                          className="rounded-full px-2.5 py-1 text-[10px] font-medium"
                          style={{
                            background: "rgba(var(--quip-accent), 0.14)",
                            color: "rgb(var(--quip-accent-deep))",
                          }}
                        >
                          {t.topic} · {t.count}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  onClick={() => setConfirmResetDNA(true)}
                  className="mt-3 w-full rounded-xl px-4 py-2 text-[11px] font-medium text-quip-gray transition-all"
                  style={{ background: "rgba(var(--quip-line), 0.05)" }}
                >
                  Reset Communication DNA
                </button>
              </>
            ) : (
              <div style={{ fontSize: 12, color: "rgba(var(--quip-text-soft), 0.85)" }}>
                No profile yet. Quip builds this as you chat.
              </div>
            )}
          </div>
        )}

        {tab === "progression" && (
          <div className="flex flex-col gap-4">
            <div style={{ fontSize: 11, color: "rgba(var(--quip-text-soft), 0.95)" }}>
              Your companions grow with you. As you talk, complete tasks, and create memories together, they unlock cosmetic upgrades.
            </div>
            {progression ? (
              (["pix", "kai", "ren", "bubbles", "capy", "skales"] as CompanionId[]).map((id) => {
                const p = progression[id];
                if (!p) return null;
                const depthPct = Math.round(p.depth * 100);
                return (
                  <div
                    key={id}
                    className="rounded-xl p-3"
                    style={{
                      background: "rgba(var(--quip-line), 0.03)",
                      border: "1px solid rgba(var(--quip-line), 0.06)",
                    }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span style={{ fontSize: 13, fontWeight: 600, color: "rgb(var(--quip-text))", textTransform: "capitalize" }}>
                        {id}
                      </span>
                      <span style={{ fontSize: 10, color: "rgba(var(--quip-text-soft), 0.85)" }}>
                        {depthPct}% depth
                      </span>
                    </div>

                    {/* Depth bar */}
                    <div
                      style={{
                        height: 6,
                        background: "rgba(var(--quip-line), 0.07)",
                        borderRadius: 3,
                        overflow: "hidden",
                        marginBottom: 8,
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${depthPct}%`,
                          background: `linear-gradient(90deg, ${getCompanion(companionId).primary}, ${getCompanion(companionId).secondary})`,
                          borderRadius: 3,
                          transition: "width 0.5s",
                        }}
                      />
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <Stat label="Conversations" value={p.conversations} />
                      <Stat label="Messages" value={p.totalMessages} />
                      <Stat label="Tasks" value={p.tasksCompleted} />
                      <Stat label="Memories" value={p.memoriesCreated} />
                    </div>

                    {/* Unlocked cosmetics */}
                    {p.unlockedCosmetics && p.unlockedCosmetics.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {p.unlockedCosmetics.map((c: any) => (
                          <span
                            key={c.id}
                            className="rounded-full px-2.5 py-1 text-[10px] font-medium"
                            style={{
                              background: "rgba(var(--quip-ok), 0.12)",
                              color: "rgb(var(--quip-ok))",
                            }}
                          >
                            ✨ {c.name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 10, color: "rgba(var(--quip-text-soft), 0.85)", marginTop: 4 }}>
                        No cosmetics unlocked yet — keep talking!
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div style={{ fontSize: 12, color: "rgba(var(--quip-text-soft), 0.85)" }}>
                No progression data yet.
              </div>
            )}
          </div>
        )}

        {tab === "problems" && (
          <ProblemDiaryPanel
            companionId={companionId}
            onOpenAI={() => setTab("ai")}
          />
        )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Confirmation modals for destructive actions */}
      <ConfirmModal
        open={confirmResetDNA}
        title="Reset Communication DNA?"
        message="This will erase everything Quip has learned about your communication style. Quip will start learning from scratch. This cannot be undone."
        confirmLabel="Reset"
        onConfirm={handleResetDNA}
        onCancel={() => setConfirmResetDNA(false)}
      />
      <ConfirmModal
        open={confirmPrune}
        title="Prune memories?"
        message="This will permanently delete low-importance memories older than 30 days. Pinned and high-importance memories are kept. This cannot be undone."
        confirmLabel="Prune"
        onConfirm={handlePrune}
        onCancel={() => setConfirmPrune(false)}
      />
      <ConfirmModal
        open={confirmQuit}
        title="Quit Quip?"
        message="This closes Quip completely — the companion and the app disappear until you open Quip again. Your memories and settings are kept."
        confirmLabel="Quit"
        onConfirm={handleQuit}
        onCancel={() => setConfirmQuit(false)}
      />
    </motion.div>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ fontSize: 11, color: "rgba(var(--quip-text-soft), 0.85)" }}>{label}</span>
      <span
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: "rgb(var(--quip-text))",
          textAlign: "right",
          maxWidth: "60%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function DNABar({ label, value, max, unit, display, companionId = "pix" }: { label: string; value: number; max: number; unit: string; display: string; companionId?: CompanionId }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span style={{ fontSize: 11, color: "rgba(var(--quip-text-soft), 0.95)" }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 500, color: "rgb(var(--quip-text))" }}>{display}</span>
      </div>
      <div
        style={{
          height: 6,
          background: "rgba(var(--quip-line), 0.07)",
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${getCompanion(companionId).primary}, ${getCompanion(companionId).secondary})`,
            borderRadius: 3,
            transition: "width 0.5s",
          }}
        />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="rounded-lg px-2 py-1.5"
      style={{ background: "rgba(var(--quip-line), 0.04)" }}
    >
      <div style={{ fontSize: 9, color: "rgba(var(--quip-text-soft), 0.85)", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "rgb(var(--quip-text))" }}>{value}</div>
    </div>
  );
}
