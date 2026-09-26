/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#10261f",
        moss: "#3f6b3a",
        grass: "#8fbf5a",
        cream: "#f3ecd4",
        amber: "#e8a43a",
        river: "#2f8f9a",
        coral: "#d86b5d",
        soil: "#6b4634"
      },
      fontFamily: {
        display: ["Fraunces", "Georgia", "serif"],
        body: ["Atkinson Hyperlegible", "Segoe UI", "sans-serif"]
      },
      boxShadow: {
        slat: "0 10px 0 #3a2a16, 0 18px 28px rgba(16, 38, 31, 0.28)"
      }
    }
  },
  plugins: []
};
