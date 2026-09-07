/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{ts,tsx,html}"],
  theme: {
    extend: {
      colors: {
        // Quip V2 color system — premium, calm, alive.
        quip: {
          aqua: "#6FD6FF",
          aquaDeep: "#3FB8EF",
          pink: "#FF9FEF",
          pinkDeep: "#F472D6",
          gold: "#FFD700",
          white: "#FFFFFF",
          paper: "#FAFBFC",
          ink: "#0A0B0F",
          inkSoft: "#1A1D26",
          gray: "#7A838B",
          graySoft: "#A8B0B8",
          line: "rgba(10,11,15,0.06)",
          lineSoft: "rgba(10,11,15,0.04)",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "SF Pro Text",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "system-ui",
          "sans-serif",
        ],
        display: [
          "Inter",
          "SF Pro Display",
          "-apple-system",
          "sans-serif",
        ],
        mono: ["SF Mono", "JetBrains Mono", "ui-monospace", "monospace"],
      },
      fontSize: {
        // Tighter, more deliberate type scale.
        "xxs": ["10px", "14px"],
        "xs": ["11px", "16px"],
        "sm": ["13px", "18px"],
        "base": ["14px", "22px"],
        "md": ["15px", "24px"],
        "lg": ["17px", "26px"],
        "xl": ["20px", "28px"],
        "2xl": ["24px", "32px"],
      },
      borderRadius: {
        "xl2": "20px",
        "2.5xl": "24px",
        "3xl": "28px",
        "4xl": "36px",
      },
      boxShadow: {
        // Premium depth — soft, layered, never harsh.
        glass: "0 8px 32px rgba(10,11,15,0.10), 0 1px 2px rgba(10,11,15,0.04)",
        glassLg: "0 20px 60px rgba(10,11,15,0.14), 0 2px 4px rgba(10,11,15,0.06)",
        soft: "0 4px 20px rgba(10,11,15,0.06)",
        lift: "0 12px 36px rgba(10,11,15,0.12)",
        inner: "inset 0 1px 0 rgba(255,255,255,0.6)",
        pix: "0 0 32px rgba(111,214,255,0.45)",
        ring: "0 0 0 1px rgba(10,11,15,0.05)",
      },
      backdropBlur: {
        xs: "2px",
        "2xl": "32px",
        "3xl": "48px",
      },
      transitionTimingFunction: {
        // Apple-like ease curves.
        quip: "cubic-bezier(0.22, 1, 0.36, 1)",
        soft: "cubic-bezier(0.32, 0.72, 0, 1)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in-scale": {
          "0%": { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "shimmer": {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        "float": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-4px)" },
        },
        "scan-sweep": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "fade-in": "fade-in 280ms cubic-bezier(0.22, 1, 0.36, 1)",
        "fade-in-scale": "fade-in-scale 320ms cubic-bezier(0.22, 1, 0.36, 1)",
        "slide-up": "slide-up 360ms cubic-bezier(0.22, 1, 0.36, 1)",
        "shimmer": "shimmer 1.6s linear infinite",
        "pulse-soft": "pulse-soft 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "float": "float 3s ease-in-out infinite",
        "scan-sweep": "scan-sweep 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
