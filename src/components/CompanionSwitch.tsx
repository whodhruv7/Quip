// Quip V2 — Companion switcher (large visual picker).
//
// Shows all 3 companions with their themes. Used inside SettingsPanel.

import { motion } from "framer-motion";
import type { CompanionId } from "@/types";
import { COMPANIONS } from "@/lib/companion-config";

interface CompanionSwitchProps {
  activeId: CompanionId;
  onSelect: (id: CompanionId) => void;
}

export function CompanionSwitch({ activeId, onSelect }: CompanionSwitchProps) {
  return (
    <div className="flex gap-2">
      {COMPANIONS.map((c) => {
        const active = c.id === activeId;
        return (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            className="relative flex flex-1 flex-col items-center gap-2 rounded-xl p-3 transition-all"
            style={{
              background: active ? `${c.primary}10` : "rgb(var(--chrome-line) / 0.03)",
              border: active
                ? `1.5px solid ${c.primary}44`
                : "1.5px solid rgb(var(--chrome-line) / 0.06)",
            }}
          >
            {/* Avatar */}
            <motion.div
              animate={active ? { scale: [1, 1.08, 1] } : {}}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: `linear-gradient(135deg, ${c.primary}, ${c.secondary})`,
                boxShadow: active ? `0 6px 20px ${c.primary}30` : "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  background: "rgb(var(--chrome-bg) / 0.95)",
                }}
              />
            </motion.div>
            <div className="flex flex-col items-center">
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: active ? "rgb(var(--quip-text))" : "rgb(var(--quip-text-soft))",
                }}
              >
                {c.name}
              </span>
              <span
                style={{
                  fontSize: 9,
                  color: "rgb(var(--quip-text-soft))",
                  marginTop: 1,
                }}
              >
                {c.subtitle}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
