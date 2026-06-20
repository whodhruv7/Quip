// Quip V2 — Settings panel.
//
// Full overlay with: companion picker, model info, device info, memory viewer,
// rescan button, permissions.

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { CompanionId, DeviceProfile, UserKnowledge } from "@/types";
import { CompanionSwitch } from "./CompanionSwitch";
import { ModelSwitch } from "./ModelSwitch";

interface SettingsPanelProps {
  open: boolean;
  companionId: CompanionId;
  onCompanionChange: (id: CompanionId) => void;
  onClose: () => void;
}

type Tab = "general" | "device" | "memory";

export function SettingsPanel({
  open,
  companionId,
  onCompanionChange,
  onClose,
}: SettingsPanelProps) {
  const [tab, setTab] = useState<Tab>("general");
  const [device, setDevice] = useState<DeviceProfile | null>(null);
  const [memory, setMemory] = useState<UserKnowledge | null>(null);
  const [rescanning, setRescanning] = useState(false);

  useEffect(() => {
    if (!open) return;
    window.quip.getDeviceProfile().then(setDevice).catch(() => {});
    window.quip.getMemories().then(setMemory).catch(() => {});
  }, [open]);

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

  const handleForget = async (id: string) => {
    await window.quip.forgetMemory(id);
    const fresh = await window.quip.getMemories();
    setMemory(fresh);
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
        backdropFilter: "blur(30px)",
        WebkitBackdropFilter: "blur(30px)",
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
      <div className="flex gap-1 px-4 py-2">
        {(["general", "device", "memory"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="rounded-lg px-3 py-1.5 text-[11px] font-medium capitalize transition-all"
            style={
              tab === t
                ? { background: "rgba(0,0,0,0.06)", color: "#111" }
                : { color: "#9ca3af" }
            }
          >
            {t}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {tab === "general" && (
          <div className="flex flex-col gap-5">
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-quip-gray">
                Companion
              </label>
              <CompanionSwitch activeId={companionId} onSelect={onCompanionChange} />
            </div>
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-quip-gray">
                AI Model
              </label>
              <ModelSwitch />
            </div>
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
                <DataRow label="Display" value={`${device.primaryResolution.width}×${device.primaryResolution.height} @ ${device.scaleFactor}x`} />
                <DataRow label="Monitors" value={String(device.monitorCount)} />
                <DataRow label="Default browser" value={device.defaultBrowser ?? "None detected"} />
                <DataRow label="Default editor" value={device.defaultEditor ?? "None detected"} />
                <DataRow
                  label="Apps detected"
                  value={String(device.apps.length)}
                />

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
                  <div className="flex flex-col">
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#111" }}>
                      {m.key}
                    </span>
                    <span style={{ fontSize: 11, color: "#6b7280" }}>{m.value}</span>
                    <span style={{ fontSize: 9, color: "#9ca3af", marginTop: 2 }}>
                      {m.kind} · {m.importance} · ×{m.weight}
                    </span>
                  </div>
                  <button
                    onClick={() => handleForget(m.id)}
                    className="text-[10px] text-quip-gray transition-colors hover:text-red-500"
                  >
                    forget
                  </button>
                </div>
              ))
            ) : (
              <div style={{ fontSize: 12, color: "#9ca3af" }}>
                No memories yet. Quip learns as you talk.
              </div>
            )}
          </div>
        )}
      </div>
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
