import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Rethink Sans for all UI chrome; Source Serif 4 for reading content.
        sans: ["var(--font-rethink)", "system-ui", "sans-serif"],
        serif: ["var(--font-source-serif)", "Georgia", "serif"],
      },
      borderRadius: {
        // Doc: rounded-lg everywhere.
        DEFAULT: "0.5rem",
      },
    },
  },
  plugins: [],
};

export default config;
