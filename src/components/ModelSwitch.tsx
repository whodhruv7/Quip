// Quip V2 — Model status display.
//
// Shows the active model + fallback. Read-only (model is chosen by .env).

import { useEffect, useState } from "react";
import type { ModelRouterStatus } from "@/types";

export function ModelSwitch() {
  const [status, setStatus] = useState<ModelRouterStatus | null>(null);

  useEffect(() => {
    window.quip.getModelStatus().then(setStatus).catch(() => {});
  }, []);

  if (!status) {
    return (
      <div style={{ fontSize: 11, color: "#9ca3af", padding: "8px 0" }}>
        Loading model info…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Active model */}
      <div
        className="flex items-center justify-between rounded-lg px-3 py-2"
        style={{
          background: "rgba(34,197,94,0.06)",
          border: "1px solid rgba(34,197,94,0.15)",
        }}
      >
        <div className="flex items-center gap-2">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: "#22c55e" }}
          />
          <div className="flex flex-col">
            <span style={{ fontSize: 11, fontWeight: 600, color: "#111" }}>
              {status.active.label}
            </span>
            <span style={{ fontSize: 9, color: "#9ca3af" }}>Active</span>
          </div>
        </div>
      </div>

      {/* Fallback */}
      {status.fallback && (
        <div
          className="flex items-center justify-between rounded-lg px-3 py-2"
          style={{
            background: "rgba(0,0,0,0.02)",
            border: "1px solid rgba(0,0,0,0.04)",
            opacity: status.fallback.available ? 1 : 0.5,
          }}
        >
          <div className="flex items-center gap-2">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background: status.fallback.available ? "#f59e0b" : "#d1d5db",
              }}
            />
            <div className="flex flex-col">
              <span style={{ fontSize: 11, fontWeight: 500, color: "#6b7280" }}>
                {status.fallback.label}
              </span>
              <span style={{ fontSize: 9, color: "#9ca3af" }}>
                {status.fallback.available ? "Fallback ready" : "Not configured"}
              </span>
            </div>
          </div>
        </div>
      )}

      {!status.healthy && (
        <div
          className="rounded-lg px-3 py-2"
          style={{
            background: "rgba(239,68,68,0.06)",
            border: "1px solid rgba(239,68,68,0.15)",
            fontSize: 10,
            color: "#dc2626",
          }}
        >
          No AI provider configured. Add GROQ_API_KEY to .env.
        </div>
      )}
    </div>
  );
}
