// Quip V2 — Bootstrap scan overlay.
//
// Shown on first launch while the bootstrap pipeline runs (device-scan,
// world-model, model-router). Calm, premium animation. Disappears when done.

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { BootstrapProgress } from "@/types";
import { getCompanion } from "@/lib/companion-config";

interface ScanOverlayProps {
  companionId: string;
  onProgress?: (p: BootstrapProgress) => void;
  onDone?: () => void;
}

const STAGE_LABELS: Record<string, string> = {
  "health-check": "Warming up",
  "device-scan": "Scanning your device",
  environment: "Reading environment",
  "world-model": "Building world model",
  "model-router": "Connecting to AI",
  window: "Opening Quip",
  ready: "Ready",
  idle: "Starting",
  failed: "Something went wrong",
};

export function ScanOverlay({ companionId, onProgress, onDone }: ScanOverlayProps) {
  const [progress, setProgress] = useState<BootstrapProgress | null>(null);
  const [visible, setVisible] = useState(true);
  const theme = getCompanion(companionId as any);

  useEffect(() => {
    // Fast fallback: 1.2s max — app should feel instant
    const fallback = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDone?.(), 150);
    }, 1200);

    const off = window.quip.onBootstrapProgress((p) => {
      setProgress(p);
      onProgress?.(p);
      if (p.done) {
        clearTimeout(fallback);
        setTimeout(() => {
          setVisible(false);
          setTimeout(() => onDone?.(), 200);
        }, 200);
      }
    });
    return () => {
      clearTimeout(fallback);
      off();
    };
  }, [onProgress, onDone]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          className="absolute inset-0 z-50 flex items-center justify-center"
          style={{
            background: "rgba(255,255,255,0.85)",
            backdropFilter: "blur(40px)",
            WebkitBackdropFilter: "blur(40px)",
          }}
        >
          <div className="flex flex-col items-center gap-6">
            {/* Companion glow with pulse */}
            <div className="relative">
              <motion.div
                animate={{
                  scale: [1, 1.15, 1],
                  opacity: [0.5, 0.2, 0.5],
                }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                style={{
                  position: "absolute",
                  inset: "-20px",
                  borderRadius: "50%",
                  background: `radial-gradient(circle, ${theme.primary}40, transparent 70%)`,
                }}
              />
              <motion.div
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 20,
                  background: `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})`,
                  boxShadow: `0 12px 40px ${theme.primary}40`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    background: "rgba(255,255,255,0.95)",
                  }}
                />
              </motion.div>
            </div>

            {/* Stage label */}
            <div className="flex flex-col items-center gap-2">
              <motion.div
                key={progress?.stage ?? "idle"}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: "#111",
                }}
              >
                {STAGE_LABELS[progress?.stage ?? "idle"] ?? "Starting"}
              </motion.div>

              {progress?.message && (
                <motion.div
                  key={progress.message}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3 }}
                  style={{
                    fontSize: 12,
                    color: "#9ca3af",
                  }}
                >
                  {progress.message}
                </motion.div>
              )}
            </div>

            {/* Progress bar */}
            <div
              style={{
                width: 200,
                height: 3,
                borderRadius: 3,
                background: "rgba(0,0,0,0.06)",
                overflow: "hidden",
              }}
            >
              <motion.div
                animate={{ width: `${(progress?.progress ?? 0) * 100}%` }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                style={{
                  height: "100%",
                  borderRadius: 3,
                  background: `linear-gradient(90deg, ${theme.primary}, ${theme.secondary})`,
                }}
              />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
