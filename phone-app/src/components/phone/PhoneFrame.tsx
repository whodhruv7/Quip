'use client'

// Quip Phone App — Phone Frame
// Premium device chrome. OLED black. No purple glow.

import { ReactNode } from "react";

export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        padding: "20px",
        background: "#050505",
        fontFamily: "var(--font-inter), -apple-system, system-ui, sans-serif",
      }}
    >
      <div
        style={{
          position: "relative",
          width: 390,
          height: 844,
          background: "#0B0B0C",
          borderRadius: 55,
          boxShadow:
            "0 0 0 1.5px rgba(255,255,255,0.05), 0 0 0 10px #0e0e10, 0 0 0 11px rgba(255,255,255,0.03), 0 50px 100px -20px rgba(0,0,0,0.8)",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        {/* Dynamic Island */}
        <div
          style={{
            position: "absolute",
            top: 11,
            left: "50%",
            transform: "translateX(-50%)",
            width: 126,
            height: 37,
            background: "#000",
            borderRadius: 20,
            zIndex: 100,
          }}
        >
          <div
            style={{
              position: "absolute",
              right: 14,
              top: "50%",
              transform: "translateY(-50%)",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#1a1a22",
            }}
          />
        </div>

        {/* App content */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            overflow: "hidden",
            borderRadius: 55,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
