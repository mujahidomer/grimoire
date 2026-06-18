import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "var(--eco-canvas)",
        main: "var(--eco-main)",
        sidebar: "var(--eco-sidebar)",
        eco: {
          primary: "var(--eco-primary)",
          secondary: "var(--eco-secondary)",
          tertiary: "var(--eco-tertiary)",
          foreground: "var(--eco-text)",
          text: "var(--eco-text)",
          border: "var(--eco-border)",
          "border-light": "var(--eco-border-light)",
          "border-subtle": "var(--eco-border-subtle)",
          "border-muted": "var(--eco-border-muted)",
          "border-emphasis": "var(--eco-border-emphasis)",
          card: "var(--eco-card)",
          muted: "var(--eco-muted)",
          surface: "var(--eco-surface)",
          heading: "var(--eco-heading)",
          "on-surface": "var(--eco-on-surface)",
          inverse: "var(--eco-inverse)",
          "on-accent": "var(--eco-on-accent)",
          accent: "var(--eco-primary)",
          hover: "var(--eco-hover)",
          "hover-strong": "var(--eco-hover-strong)",
          input: "var(--eco-input)",
          "input-solid": "var(--eco-input-solid)",
          "surface-raised": "var(--eco-surface-raised)",
          "surface-hover": "var(--eco-surface-hover)",
          "kbd-bg": "var(--eco-kbd-bg)",
          "badge-bg": "var(--eco-badge-bg)",
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
