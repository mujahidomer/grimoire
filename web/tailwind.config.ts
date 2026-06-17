import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#FFFFFF",
        main: "#FAF9F6",
        sidebar: "#F3F2EE",
        eco: {
          primary: "#A1B887",
          secondary: "#2D3B23",
          tertiary: "#4F663C",
          foreground: "#3A4535",
          text: "#3A4535",
          border: "#B6CC9D",
          "border-light": "#E0E3D5",
          card: "#0D120D",
          muted: "#5E6B52",
          surface: "#FFFFFF",
          heading: "#2D3B23",
          "on-surface": "#2D3B23",
          inverse: "#FFFFFF",
          accent: "#A1B887",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        display: ["var(--font-gloock)", "Georgia", "serif"],
      },
      fontSize: {
        "headline-lg": ["36px", { lineHeight: "40px", letterSpacing: "-0.025em" }],
        "body-md": ["14px", { lineHeight: "20px" }],
        "label-md": ["12px", { lineHeight: "15px", letterSpacing: "0.3px" }],
      },
      borderRadius: {
        surface: "16px",
        card: "31px",
        shell: "32px",
      },
      boxShadow: {
        eco:
          "0 0 0 0 rgba(0,0,0,0), 0 0 0 0 rgba(0,0,0,0), 0 2px 3px -1px rgba(0,0,0,0.1), 0 1px 0 0 rgba(25,28,33,0.02), 0 0 0 1px rgba(25,28,33,0.08)",
        "eco-sm":
          "0 0 0 0 rgba(0,0,0,0), 0 0 0 0 rgba(0,0,0,0), 0 1px 2px 0 rgba(0,0,0,0.05)",
        "eco-lg":
          "0 0 0 0 rgba(0,0,0,0), 0 0 0 0 rgba(0,0,0,0), 0 1px 1px -0.5px rgba(0,0,0,0.06), 0 3px 3px -1.5px rgba(0,0,0,0.06), 0 6px 6px -3px rgba(0,0,0,0.06), 0 12px 12px -6px rgba(0,0,0,0.06), 0 24px 24px -12px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.06)",
      },
      backdropBlur: {
        eco: "12px",
      },
      transitionDuration: {
        eco: "150ms",
        "eco-slow": "700ms",
      },
      spacing: {
        "section": "32px",
        "card": "9px",
        "sidebar": "240px",
      },
    },
  },
  plugins: [],
};

export default config;
