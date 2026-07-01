import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // SWIFT "void/red" system — dark surfaces, a single hot-red accent,
        // neutral inks. Every shared class (.card/.btn/.pill/text-muted…) is
        // built on these, so the whole app rebrands from here.
        ink: "#0a0a0b", // void — page background
        panel: "#131316", // surface — cards
        panel2: "#1b1b1f", // raised — inputs, hover
        line: "#232327", // hairline border
        line2: "#33333a", // stronger border
        muted: "#9a9aa0", // dim text
        faint: "#59595f", // faint text / mono eyebrows
        brand: "#e10600", // hot red accent
        brand2: "#ff4b45", // lighter red — links/hover
        good: "#34d399",
        warn: "#fbbf24",
        bad: "#f87171",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Anton", "'Arial Narrow'", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        glow: "0 0 20px rgba(225,6,0,.35)",
        glowlg: "0 8px 30px rgba(225,6,0,.35)",
      },
    },
  },
  plugins: [],
};

export default config;
