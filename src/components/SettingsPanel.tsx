// Quip V2 — Settings panel.
//
// Full overlay with tabs: AI Brain, General, Device, Memory, DNA, Progression.
// AI Brain tab: paste an API key in-app, test the connection for real,
//   see the live provider status — no more hand-editing .env files.
// Desktop tab: companion visibility (stays on screen until YOU turn it off)
//   and the ONLY real Quit button.
// Memory tab: view all memories, pin/unpin, forget, prune.
// DNA tab: view communication style profile from relationship engine.
// Progression tab: view companion depth + unlocked cosmetics.

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { CompanionId, DeviceProfile, UserKnowledge } from "@/types";
import type { ModelRouterStatus } from "@/types/models";
import { CompanionSwitch } from "./CompanionSwitch";
import { ConfirmModal } from "./ConfirmModal";

interface SettingsPanelProps {
  open: boolean;
  companionId: CompanionId;
  onCompanionChange: (id: CompanionId) => void;
  onClose: () => void;
  initialTab?: Tab;
}

type Tab = "ai" | "general" | "desktop" | "device" | "memory" | "dna" | "progression";

type ProviderId = "openrouter" | "groq" | "cerebras" | "nvidia";

const AI_PROVIDERS: Array<{
  id: ProviderId;
  name: string;
  hint: string;
  keyUrl: string;
  keyPrefix: string;
  modelPlaceholder: string;
}> = [
  {
    id: "groq",
    name: "Groq",
    hint: "Free key · fastest voice + chat",
    keyUrl: "https://console.groq.com/keys",
    keyPrefix: "gsk_",
    modelPlaceholder: "llama-3.3-70b-versatile",
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
    modelPlaceholder: "meta/llama-3.3-70b-instruct",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    hint: "Free key · widest model choice",
    keyUrl: "https://openrouter.ai/keys",
    keyPrefix: "sk-or-",
    modelPlaceholder: "minimax/minimax-m3:free",
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
  const [speakEngine, setSpeakEngine] = useState<"auto" | "groq" | "local">("auto");
  const [speakVoice, setSpeakVoice] = useState("Celeste-PlayAI");
  const [speakNote, setSpeakNote] = useState<string | null>(null);

  // Desktop tab state
  const [companionVisible, setCompanionVisible] = useState(true);
  const [checkInsEnabled, setCheckInsEnabled] = useState(true);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab, open]);

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
    }).catch(() => {});
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
  }, [open]);

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
  const handleSetSpeak = async (patch: { enabled?: boolean; engine?: "auto" | "groq" | "local"; voice?: string }) => {
    if (patch.enabled !== undefined) setSpeakEnabled(patch.enabled);
    if (patch.engine !== undefined) setSpeakEngine(patch.engine);
    if (patch.voice !== undefined) setSpeakVoice(patch.voice);
    setSpeakNote(null);
    try {
      const r = await window.quip.setSpeakConfig(patch);
      setSpeakNote(r.ok ? "Voice updated." : r.message);
      if (!r.ok) return;
      if (patch.enabled === false) window.quip.ttsStop();
      if (patch.enabled === true && patch.voice === undefined) {
        // Tiny confirmation so the user KNOWS the voice works.
        window.quip.ttsSpeak({ text: "Hi! I can speak now." });
      }
    } catch {
      setSpeakNote("I couldn't save the voice settings — try again.");
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
    const fresh = await window.quip.getMemories();
    setMemory(fresh);
  };

  const handleForget = async (id: string) => {
    await window.quip.forgetMemory(id);
    await refreshMemory();
  };

  const handlePin = async (id: string) => {
    await window.quip.pinMemory(id);
    await refreshMemory();
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
    await window.quip.resetUserProfile();
    const fresh = await window.quip.getUserProfile();
    setProfile(fresh);
  };

  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-40 flex flex-col"
      style={{
        background: "rgba(255,255,255,0.92)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: "1px solid rgba(0,0,0,0.04)" }}
      >
        <h3 style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>Settings</h3>
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-quip-gray transition-colors hover:bg-black/[0.04]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-4 py-2 overflow-x-auto">
        {(["ai", "general", "desktop", "device", "memory", "dna", "progression"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="rounded-lg px-3 py-1.5 text-[11px] font-medium capitalize transition-all whitespace-nowrap"
            style={
              tab === t
                ? { background: "rgba(0,0,0,0.06)", color: "#111" }
                : { color: "#9ca3af" }
            }
          >
            {t === "dna" ? "Communication DNA" : t === "ai" ? "AI Brain" : t}
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
                  background: modelStatus.healthy ? "rgba(34,197,94,0.06)" : "rgba(239,68,68,0.05)",
                  border: `1px solid ${modelStatus.healthy ? "rgba(34,197,94,0.18)" : "rgba(239,68,68,0.18)"}`,
                }}
              >
                <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ background: modelStatus.healthy ? "#22c55e" : "#ef4444" }}
                  />
                  <div className="flex flex-col" style={{ minWidth: 0 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: "#111" }}>
                      {modelStatus.active?.label ?? "No provider"}
                    </span>
                    <span style={{ fontSize: 9.5, color: "#6b7280" }}>
                      {modelStatus.healthy ? "Connected and ready" : "No working key yet"}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div style={{ fontSize: 11, color: "#6b7280" }}>
              Paste a free API key below — Quip saves it for you. No file editing needed.
            </div>

            {/* Auto-resolve: REAL probes of both providers, honest badges */}
            <div
              className="rounded-xl px-3 py-2.5"
              style={{ border: "1px solid rgba(0,0,0,0.06)", background: "rgba(0,0,0,0.015)" }}
            >
              <div className="flex items-center justify-between gap-2">
                <span style={{ fontSize: 11, fontWeight: 600, color: "#374151" }}>
                  Which provider works?
                </span>
                <button
                  onClick={handleResolveProviders}
                  disabled={resolving}
                  style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: "#0c6b8f",
                    background: "rgba(111,214,255,0.12)",
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
                        style={{ background: s.ok ? "#22c55e" : s.configured ? "#ef4444" : "#d1d5db" }}
                      />
                      <span style={{ fontSize: 10.5, color: "#374151", fontWeight: 600, textTransform: "capitalize" }}>
                        {s.provider}
                      </span>
                      <span style={{ fontSize: 10, color: s.ok ? "#15803d" : "#6b7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
              style={{ border: "1px solid rgba(0,0,0,0.06)", background: "rgba(0,0,0,0.015)" }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
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
                          border: `1.5px solid ${isPrimary ? "rgba(111,214,255,0.65)" : "rgba(0,0,0,0.07)"}`,
                          background: isPrimary ? "rgba(111,214,255,0.08)" : "transparent",
                          cursor: isEnabled && !savingConfig ? "pointer" : "default",
                          opacity: isEnabled ? 1 : 0.45,
                        }}
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: isPrimary ? "#0c6b8f" : "rgba(0,0,0,0.15)" }}
                        />
                        <span style={{ fontSize: 11, fontWeight: 600, color: "#111" }}>{p.name}</span>
                        <span style={{ fontSize: 9.5, color: isPrimary ? "#0c6b8f" : "#9ca3af", whiteSpace: "nowrap" }}>
                          {isPrimary ? "PRIMARY" : "make primary"}
                        </span>
                        {status?.ok && (
                          <span className="ml-auto shrink-0" style={{ fontSize: 9, color: "#15803d" }}>
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
                          color: isEnabled ? "#15803d" : "#6b7280",
                          background: isEnabled ? "rgba(34,197,94,0.08)" : "rgba(0,0,0,0.04)",
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
                <div style={{ fontSize: 9.5, color: "#6b7280", marginTop: 6 }}>
                  Screen vision runs on {providerConfig.visionModel} — no extra key needed.
                </div>
              )}
              {configNote && (
                <div style={{ fontSize: 10, color: "#374151", marginTop: 6 }}>{configNote}</div>
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
                      border: `1.5px solid ${provider === p.id ? "rgba(111,214,255,0.65)" : "rgba(0,0,0,0.07)"}`,
                      background: provider === p.id ? "rgba(111,214,255,0.08)" : "rgba(0,0,0,0.015)",
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#111" }}>{p.name}</div>
                    <div style={{ fontSize: 9.5, color: "#6b7280", marginTop: 1 }}>{p.hint}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Key input */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-quip-gray">
                  API key
                </label>
                <a
                  href={AI_PROVIDERS.find((p) => p.id === provider)!.keyUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 10.5, color: "#0c6b8f", textDecoration: "underline" }}
                >
                  Get a free key ↗
                </a>
              </div>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setSaveResult(null);
                  setTestResult(null);
                }}
                placeholder={`${AI_PROVIDERS.find((p) => p.id === provider)!.keyPrefix}…`}
                spellCheck={false}
                autoComplete="off"
                className="w-full rounded-xl px-3 py-2.5 outline-none transition-all focus:ring-2"
                style={{
                  fontSize: 12,
                  border: "1.5px solid rgba(0,0,0,0.08)",
                  background: "rgba(255,255,255,0.85)",
                  color: "#111",
                  // @ts-expect-error CSS var
                  "--tw-ring-color": "rgba(111,214,255,0.4)",
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
                    color: "#0c6b8f",
                    background: "rgba(111,214,255,0.12)",
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
                  border: "1.5px solid rgba(0,0,0,0.08)",
                  background: "rgba(255,255,255,0.85)",
                  color: "#111",
                  // @ts-expect-error CSS var
                  "--tw-ring-color": "rgba(111,214,255,0.4)",
                }}
              />
              {browsing && (
                <div
                  className="mt-2 rounded-xl px-2.5 py-2"
                  style={{ border: "1px solid rgba(0,0,0,0.07)", background: "rgba(255,255,255,0.7)" }}
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
                          border: "1px solid rgba(0,0,0,0.08)",
                          background: "rgba(0,0,0,0.015)",
                          color: "#111",
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
                                  background: selected ? "rgba(111,214,255,0.14)" : "transparent",
                                  border: "none",
                                  cursor: "pointer",
                                }}
                              >
                                <span
                                  className="truncate"
                                  style={{
                                    fontSize: 10.5,
                                    fontFamily: "monospace",
                                    color: selected ? "#0c6b8f" : "#374151",
                                    fontWeight: selected ? 700 : 400,
                                  }}
                                >
                                  {m.id}
                                </span>
                                {selected ? (
                                  <span style={{ fontSize: 9, fontWeight: 700, color: "#0c6b8f", whiteSpace: "nowrap" }}>IN USE</span>
                                ) : (
                                  <span style={{ fontSize: 9, color: "#9ca3af", whiteSpace: "nowrap" }}>
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
                    <div style={{ fontSize: 10, color: "#374151", padding: "2px 4px" }}>{modelBrowserNote}</div>
                  )}
                  {discoveredModels.length > 0 && (
                    <button
                      onClick={() => setBrowsing(false)}
                      style={{ fontSize: 9.5, color: "#9ca3af", background: "none", border: "none", cursor: "pointer", marginTop: 4 }}
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
              style={{ border: "1px solid rgba(0,0,0,0.06)", background: "rgba(0,0,0,0.015)" }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-col" style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: "#111" }}>
                    Let Quip speak replies out loud
                  </span>
                  <span style={{ fontSize: 9.5, color: "#6b7280" }}>
                    Groq neural voice first — falls back to this laptop's built-in voice, so it can always talk.
                  </span>
                </div>
                <button
                  onClick={() => handleSetSpeak({ enabled: !speakEnabled })}
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: speakEnabled ? "#15803d" : "#6b7280",
                    background: speakEnabled ? "rgba(34,197,94,0.08)" : "rgba(0,0,0,0.04)",
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
                    {(["auto", "groq", "local"] as const).map((e) => (
                      <button
                        key={e}
                        onClick={() => handleSetSpeak({ engine: e })}
                        style={{
                          fontSize: 9.5,
                          fontWeight: 600,
                          color: speakEngine === e ? "#0c6b8f" : "#6b7280",
                          background: speakEngine === e ? "rgba(111,214,255,0.14)" : "rgba(0,0,0,0.03)",
                          border: "none",
                          borderRadius: 6,
                          padding: "2px 8px",
                          cursor: "pointer",
                        }}
                      >
                        {e === "auto" ? "Auto" : e === "groq" ? "Groq voice" : "Laptop voice"}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {["Celeste-PlayAI", "Fritz-PlayAI", "Nera-PlayAI", "Gail-PlayAI"].map((v) => (
                      <button
                        key={v}
                        onClick={() => handleSetSpeak({ voice: v })}
                        style={{
                          fontSize: 9,
                          fontWeight: 600,
                          color: speakVoice === v ? "#0c6b8f" : "#9ca3af",
                          background: speakVoice === v ? "rgba(111,214,255,0.14)" : "transparent",
                          border: `1px solid ${speakVoice === v ? "rgba(111,214,255,0.5)" : "rgba(0,0,0,0.06)"}`,
                          borderRadius: 6,
                          padding: "2px 7px",
                          cursor: "pointer",
                        }}
                      >
                        {v.replace("-PlayAI", "")}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {speakNote && <div style={{ fontSize: 9.5, color: "#374151", marginTop: 4 }}>{speakNote}</div>}
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={handleTestConnection}
                disabled={testing}
                className="flex-1 rounded-xl px-4 py-2.5 text-[12px] font-medium transition-all disabled:opacity-50"
                style={{ background: "rgba(0,0,0,0.05)", color: "#111" }}
              >
                {testing ? "Testing…" : "Test connection"}
              </button>
              <button
                onClick={handleSaveKey}
                disabled={saving || !apiKey.trim()}
                className="flex-1 rounded-xl px-4 py-2.5 text-[12px] font-semibold text-white transition-all disabled:opacity-50"
                style={{ background: saving || !apiKey.trim() ? "#9ca3af" : "linear-gradient(135deg, #6FD6FF, #FF9FEF)" }}
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
                  background: testResult.ok ? "rgba(34,197,94,0.07)" : "rgba(239,68,68,0.06)",
                  border: `1px solid ${testResult.ok ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
                  color: testResult.ok ? "#15803d" : "#dc2626",
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
                  background: saveResult.ok ? "rgba(34,197,94,0.07)" : "rgba(239,68,68,0.06)",
                  border: `1px solid ${saveResult.ok ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
                  color: saveResult.ok ? "#15803d" : "#dc2626",
                }}
              >
                {saveResult.ok ? "✓ " : "✗ "}{saveResult.message}
              </div>
            )}
          </div>
        )}

        {tab === "general" && (
          <div className="flex flex-col gap-5">
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-quip-gray">
                Companion
              </label>
              <CompanionSwitch activeId={companionId} onSelect={onCompanionChange} />
            </div>
          </div>
        )}

        {tab === "desktop" && (
          <div className="flex flex-col gap-4">
            {/* Companion visibility — the setting the user asked for */}
            <div
              className="flex items-center justify-between gap-3 rounded-xl px-3 py-3"
              style={{ border: "1px solid rgba(0,0,0,0.06)", background: "rgba(0,0,0,0.015)" }}
            >
              <div className="flex flex-col" style={{ minWidth: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#111" }}>
                  Keep companion on my screen
                </span>
                <span style={{ fontSize: 10.5, color: "#6b7280", marginTop: 2 }}>
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
                  background: companionVisible ? "linear-gradient(135deg, #6FD6FF, #8AB4FF)" : "rgba(0,0,0,0.14)",
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

            <div style={{ fontSize: 10.5, color: "#9ca3af" }}>
              Closing the window (Alt+F4) only hides Quip — it keeps running in the
              system tray. Quitting fully is right here.
            </div>

            {/* Proactive check-ins — main-process reminder engine, user-controlled */}
            <div
              className="flex items-center justify-between gap-3 rounded-xl px-3 py-3"
              style={{ border: "1px solid rgba(0,0,0,0.06)", background: "rgba(0,0,0,0.015)" }}
            >
              <div className="flex flex-col" style={{ minWidth: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#111" }}>
                  Let Quip check in on me
                </span>
                <span style={{ fontSize: 10.5, color: "#6b7280", marginTop: 2 }}>
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
                  background: checkInsEnabled ? "linear-gradient(135deg, #6FD6FF, #8AB4FF)" : "rgba(0,0,0,0.14)",
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

            {/* The ONLY real quit */}
            <button
              onClick={() => setConfirmQuit(true)}
              className="w-full rounded-xl px-4 py-2.5 text-[12px] font-semibold text-white transition-all"
              style={{ background: "rgba(239,68,68,0.85)" }}
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
                    background: rescanning ? "#9ca3af" : "linear-gradient(135deg, #6FD6FF, #FF9FEF)",
                  }}
                >
                  {rescanning ? "Scanning…" : "Rescan device"}
                </button>
              </>
            ) : (
              <div style={{ fontSize: 12, color: "#9ca3af" }}>No device profile yet.</div>
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
                style={{ background: pruning ? "#9ca3af" : "rgba(239,68,68,0.8)" }}
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
                    background: "rgba(0,0,0,0.02)",
                    border: "1px solid rgba(0,0,0,0.04)",
                  }}
                >
                  <div className="flex flex-col" style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#111" }}>
                      {m.key}
                    </span>
                    <span style={{ fontSize: 11, color: "#6b7280", wordBreak: "break-word" }}>
                      {m.value}
                    </span>
                    <span style={{ fontSize: 9, color: "#9ca3af", marginTop: 2 }}>
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
              <div style={{ fontSize: 12, color: "#9ca3af" }}>
                No memories yet. Quip learns as you talk — after every ~10 messages it extracts facts about you automatically.
              </div>
            )}
          </div>
        )}

        {tab === "dna" && (
          <div className="flex flex-col gap-3">
            {profile ? (
              <>
                <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>
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
                            background: "rgba(111,214,255,0.12)",
                            color: "#0c6b8f",
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
                  style={{ background: "rgba(0,0,0,0.04)" }}
                >
                  Reset Communication DNA
                </button>
              </>
            ) : (
              <div style={{ fontSize: 12, color: "#9ca3af" }}>
                No profile yet. Quip builds this as you chat.
              </div>
            )}
          </div>
        )}

        {tab === "progression" && (
          <div className="flex flex-col gap-4">
            <div style={{ fontSize: 11, color: "#6b7280" }}>
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
                      background: "rgba(0,0,0,0.02)",
                      border: "1px solid rgba(0,0,0,0.04)",
                    }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#111", textTransform: "capitalize" }}>
                        {id}
                      </span>
                      <span style={{ fontSize: 10, color: "#9ca3af" }}>
                        {depthPct}% depth
                      </span>
                    </div>

                    {/* Depth bar */}
                    <div
                      style={{
                        height: 6,
                        background: "rgba(0,0,0,0.06)",
                        borderRadius: 3,
                        overflow: "hidden",
                        marginBottom: 8,
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${depthPct}%`,
                          background: "linear-gradient(90deg, #6FD6FF, #FF9FEF)",
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
                              background: "rgba(34,197,94,0.1)",
                              color: "#15803d",
                            }}
                          >
                            ✨ {c.name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 4 }}>
                        No cosmetics unlocked yet — keep talking!
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div style={{ fontSize: 12, color: "#9ca3af" }}>
                No progression data yet.
              </div>
            )}
          </div>
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
      <span style={{ fontSize: 11, color: "#9ca3af" }}>{label}</span>
      <span
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: "#111",
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

function DNABar({ label, value, max, unit, display }: { label: string; value: number; max: number; unit: string; display: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span style={{ fontSize: 11, color: "#6b7280" }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 500, color: "#111" }}>{display}</span>
      </div>
      <div
        style={{
          height: 6,
          background: "rgba(0,0,0,0.06)",
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: "linear-gradient(90deg, #6FD6FF, #FF9FEF)",
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
      style={{ background: "rgba(0,0,0,0.03)" }}
    >
      <div style={{ fontSize: 9, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>{value}</div>
    </div>
  );
}
