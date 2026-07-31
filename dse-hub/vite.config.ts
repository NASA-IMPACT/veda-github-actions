import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static SPA. All data is committed JSON under data/ and bundled at build time via
// import.meta.glob (see src/meetings/data.ts). No backend, no env vars, no runtime token —
// GitHub is the only datastore and approved PRs are what update it (Netlify rebuilds on merge).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
  },
});
