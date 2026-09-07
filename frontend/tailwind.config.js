/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Pathwise green palette (mirrors the CSS variables in index.css)
        primary: {
          DEFAULT: "#0E7A55",
          dark: "#0A5C40",
          light: "#E7F5EE",
          glow: "#34D399",
        },
        accent: { DEFAULT: "#F2724A", light: "#FDEAE1" },
        ink: { DEFAULT: "#10201A", soft: "#5B6B62", faint: "#9DAAA2" },
      },
      fontFamily: {
        display: ["Fredoka", "sans-serif"],
        body: ["'Plus Jakarta Sans'", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
      },
    },
  },
  plugins: [],
};
