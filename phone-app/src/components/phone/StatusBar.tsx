'use client'

// Quip Phone App — Status Bar
// Clean, minimal, iOS-style.

import { useEffect, useState } from "react";

export function StatusBar() {
  const [time, setTime] = useState("");

  useEffect(() => {
    const update = () => {
      const now = new Date();
      const hours = now.getHours();
      const mins = now.getMinutes().toString().padStart(2, "0");
      setTime(`${hours}:${mins}`);
    };
    update();
    const interval = setInterval(update, 30_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 54,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        padding: "0 30px 8px",
        zIndex: 50,
        pointerEvents: "none",
      }}
    >
      <span
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: "#FFFFFF",
          letterSpacing: -0.3,
        }}
      >
        {time}
      </span>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {/* Signal */}
        <svg width="17" height="11" viewBox="0 0 17 11" fill="none">
          <rect x="0" y="7" width="3" height="4" rx="0.5" fill="#FFFFFF" />
          <rect x="4.5" y="4.5" width="3" height="6.5" rx="0.5" fill="#FFFFFF" />
          <rect x="9" y="2" width="3" height="9" rx="0.5" fill="#FFFFFF" />
          <rect x="13.5" y="0" width="3" height="11" rx="0.5" fill="#FFFFFF" opacity="0.35" />
        </svg>

        {/* WiFi */}
        <svg width="15" height="11" viewBox="0 0 16 12" fill="none">
          <path
            d="M8 11.5a1 1 0 100-2 1 1 0 000 2zM3 5.5C4.4 4.2 6.1 3.5 8 3.5s3.6.7 5 2M0.5 2.5C2.6 0.9 5.2 0 8 0s5.4.9 7.5 2.5"
            stroke="#FFFFFF"
            strokeWidth="1.5"
            strokeLinecap="round"
            fill="none"
          />
        </svg>

        {/* Battery */}
        <div style={{ display: "flex", alignItems: "center", gap: 1 }}>
          <div
            style={{
              width: 25,
              height: 12,
              borderRadius: 3.5,
              border: "1px solid rgba(255,255,255,0.35)",
              padding: 1.5,
              display: "flex",
              alignItems: "center",
            }}
          >
            <div
              style={{
                width: "78%",
                height: "100%",
                borderRadius: 1.5,
                background: "#FFFFFF",
              }}
            />
          </div>
          <div
            style={{
              width: 1.5,
              height: 4,
              background: "rgba(255,255,255,0.35)",
              borderRadius: "0 1px 1px 0",
            }}
          />
        </div>
      </div>
    </div>
  );
}
