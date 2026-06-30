import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0A0A0F",
        panel: "#121219",
        panel2: "#1A1A24",
        line: "#262633",
        muted: "#8A8AA0",
        brand: "#7C5CFF",
        brand2: "#B388FF",
        good: "#34D399",
        warn: "#FBBF24",
        bad: "#F87171",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["'Space Grotesk'", "Inter", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
