'use client'

// Quip Phone App — Home Indicator

export function HomeIndicator() {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: 34,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          width: 134,
          height: 5,
          borderRadius: 3,
          background: "rgba(255,255,255,0.35)",
        }}
      />
    </div>
  );
}
