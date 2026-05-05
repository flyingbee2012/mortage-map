import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Served from https://<user>.github.io/mortage-map/ on GitHub Pages, so all
  // built asset URLs need the repo name as a prefix. Local `npm run dev`
  // ignores this and still serves at "/".
  base: "/mortage-map/",
  server: {
    port: 5173,
  },
});
