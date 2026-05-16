import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Served from https://<user>.github.io/mortage-map/ on GitHub Pages, so all
  // built asset URLs need the repo name as a prefix. Local `npm run dev`
  // ignores this and still serves at "/".
  base: "/mortage-map/",
  build: {
    // Emit source maps alongside the minified bundle so DevTools (desktop
    // or remote-inspected mobile Safari) can show the real TS/TSX source
    // when debugging the deployed site. Adds ~a few hundred KB of .map
    // files to the build output; they're only fetched if DevTools is open.
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
});
