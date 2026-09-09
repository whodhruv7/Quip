import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// ─── Companion Survival Boundary ─────────────────────────────────────────────
// The window is transparent — if ANY render error unmounts the React tree,
// the user just sees an invisible window where their companion used to be
// (the root cause of "companion gayab" reports). This boundary guarantees
// that a crash can never blank the desktop presence: it falls back to a
// tiny static sprite, and asks the main process for a fresh renderer so
// the real UI comes back automatically.
class CompanionBoundary extends React.Component<
  { children: React.ReactNode },
  { crashed: boolean }
> {
  private reloadTimer: number | null = null;

  state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(err: unknown) {
    // Visible in the Electron main console (helps diagnose real machines).
    console.error("[quip] renderer crashed:", err);
    if (this.reloadTimer !== null) return;
    // Give the fallback sprite a moment, then rebuild a fresh renderer.
    this.reloadTimer = window.setTimeout(() => {
      try {
        window.location.reload();
      } catch {
        /* best effort */
      }
    }, 2500);
  }

  componentWillUnmount() {
    if (this.reloadTimer !== null) window.clearTimeout(this.reloadTimer);
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    // Calm fallback: a soft glowing dot keeps the desktop presence alive.
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "flex-end",
          padding: "10px 12px",
          pointerEvents: "none",
        }}
      >
        <div
          aria-label="Quip is restarting"
          style={{
            width: 44,
            height: 44,
            borderRadius: "50% 50% 46% 46%",
            pointerEvents: "none",
            background:
              "radial-gradient(circle at 38% 30%, #B7F0FF 0%, #6FD6FF 55%, #3FA9DB 100%)",
            boxShadow:
              "0 0 24px rgba(111,214,255,0.45), inset 0 -4px 10px rgba(0,0,0,0.12)",
            animation: "quipPulse 1.6s ease-in-out infinite",
          }}
        />
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CompanionBoundary>
      <App />
    </CompanionBoundary>
  </React.StrictMode>
);
