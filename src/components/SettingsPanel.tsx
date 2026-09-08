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

const AI_PROVIDERS = [
  {
    id: "openrouter" as const,
    name: "OpenRouter",
    hint: "Free key · minimax-m3",
    keyUrl: "https://openrouter.ai/keys",
    keyPrefix: "sk-or-",
    modelPlaceholder: "minimax/minimax-m3:free",
  },
  {
    id: "groq" as const,
    name: "Groq",
    hint: "Free key · very fast",
    keyUrl: "https://console.groq.com/keys",
    keyPrefix: "gsk_",
    modelPlaceholder: "llama-3.3-70b-versatile",
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
  const [provider, setProvider] = useState<"openrouter" | "groq">("openrouter");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saveResult, setSaveResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Desktop tab state
  const [companionVisible, setCompanionVisible] = useState(true);

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
    window.quip
      .getCompanionVisible()
      .then(setCompanionVisible)
      .catch(() => {});
  }, [open]);

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

            {/* Model input (optional) */}
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-quip-gray">
                Model <span style={{ textTransform: "none", fontWeight: 500 }}>(optional — default is fine)</span>
              </label>
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
              (["pix", "kai", "ren", "bubbles", "capy", "ivy"] as CompanionId[]).map((id) => {
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
