import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static SPA. Board data is NOT bundled at build time — it is fetched at runtime from the
// `board-explorer/data` branch (see src/data.ts), with the committed public/data/ snapshot as
// the last-resort fallback. That way a board refresh is a workflow run, not a redeploy.
// No backend, no env vars, no runtime token.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
  },
});
