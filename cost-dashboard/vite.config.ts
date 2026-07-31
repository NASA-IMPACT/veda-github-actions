import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static SPA. Pricing JSON is fetched at runtime from the aws-pricing/data branch (see src/data.ts),
// with a bundled snapshot in public/data/ as fallback. No backend, no env vars, no secrets.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
  },
});
