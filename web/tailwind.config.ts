import type { Config } from "tailwindcss";

// Colours are CSS variables (see globals.css) so light and dark mode share one set of class names.
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: v("paper"),
        surface: v("surface"),
        sunk: v("sunk"),
        ink: v("ink"),
        mute: v("mute"),
        faint: v("faint"),
        line: v("line"),
        accent: v("accent"),
        "accent-2": v("accent-2"),
        navy: v("navy"),
        sky: v("sky"),
        won: v("won"),
        warn: v("warn"),
        bad: v("bad"),
      },
      fontFamily: {
        sans: ["'Plus Jakarta Sans Variable'", "ui-sans-serif", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      fontSize: { "2xs": ["0.6875rem", { lineHeight: "1rem" }] },
    },
  },
  plugins: [],
} satisfies Config;
