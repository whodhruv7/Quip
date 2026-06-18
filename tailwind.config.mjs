/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{ts,tsx,html}"],
  theme: {
    extend: {
      colors: {
        // Quip color system
        quip: {
          aqua: "#6FD6FF",
          pink: "#FF9FEF",
          white: "#FFFFFF",
          ink: "#111111",
          gray: "#7A7A7A",
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
      },
      borderRadius: {
        // Premium rounded corners
        xl2: "20px",
        "2.5xl": "24px",
      },
      boxShadow: {
        glass: "0 8px 24px rgba(0,0,0,0.10)",
        soft: "0 4px 20px rgba(0,0,0,0.08)",
        pix: "0 0 24px rgba(111,214,255,0.45)",
      },
      backdropBlur: {
        xs: "2px",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 220ms ease-out",
      },
    },
  },
  plugins: [],
};
