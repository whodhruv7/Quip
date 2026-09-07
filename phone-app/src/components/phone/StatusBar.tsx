'use client'

// Quip Phone App — Status Bar
// Clean, minimal, iOS-style.

import { useEffect, useState } from "react";

const UPDATE_INTERVAL_MS = 30_000;
const STATUS_HEIGHT = 54;
const PADDING_X = 30;
const PADDING_B = 8;
const Z_INDEX = 50;
const FONT_SIZE = 15;
const FONT_WEIGHT = 600;
const LETTER_SPACING = -0.3;

export function StatusBar() {
  const [time, setTime] = useState("");

  useEffect(() => {
    const update = () => {
      try {
        const now = new Date();
        const hours = now.getHours();
        const mins = now.getMinutes().toString().padStart(2, "0");
        setTime(`${hours}:${mins}`);
      } catch (err) {
        console.error("Failed to parse time:", err);
      }
    };

    update();
    const interval = setInterval(update, UPDATE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: STATUS_HEIGHT,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        padding: `0 ${PADDING_X}px ${PADDING_B}px`,
        zIndex: Z_INDEX,
        pointerEvents: "none",
      }}
    >
      <span
        style={{
          fontSize: FONT_SIZE,
          fontWeight: FONT_WEIGHT,
          color: "#FFFFFF",
          letterSpacing: LETTER_SPACING,
        }}
      >
        {time}
      </span>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <SignalIcon />
        <WiFiIcon />
        <BatteryIcon />
      </div>
    </div>
  );
}

function SignalIcon() {
  return (
    <svg width="17" height="11" viewBox="0 0 17 11" fill="none">
      <rect x="0" y="7" width="3" height="4" rx="0.5" fill="#FFFFFF" />
      <rect x="4.5" y="4.5" width="3" height="6.5" rx="0.5" fill="#FFFFFF" />
      <rect x="9" y="2" width="3" height="9" rx="0.5" fill="#FFFFFF" />
      <rect x="13.5" y="0" width="3" height="11" rx="0.5" fill="#FFFFFF" opacity="0.35" />
    </svg>
  );
}

function WiFiIcon() {
  return (
    <svg width="15" height="11" viewBox="0 0 16 12" fill="none">
      <path
        d="M8 11.5a1 1 0 100-2 1 1 0 000 2zM3 5.5C4.4 4.2 6.1 3.5 8 3.5s3.6.7 5 2M0.5 2.5C2.6 0.9 5.2 0 8 0s5.4.9 7.5 2.5"
        stroke="#FFFFFF"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function BatteryIcon() {
  return (
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
  );
}
