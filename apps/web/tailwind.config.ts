import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { 50: "#eef2ff", 500: "#6366f1", 600: "#4f46e5", 700: "#4338ca" },
        cloud: { 900: "#0b1020", 800: "#11182e", 700: "#1b2540" },
      },
      fontFamily: { sans: ["ui-sans-serif", "system-ui", "Inter", "sans-serif"] },
    },
  },
  plugins: [],
};

export default config;
