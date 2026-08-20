// @ts-check
import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";

// Static build. No adapter — deploys as plain files on Netlify.
// Canonical `site` is context-aware: Netlify sets DEPLOY_PRIME_URL (unique per deploy,
// including PR Deploy Previews) and URL (production). Falls back to localhost.
// Don't hardcode a URL here.
const site =
  process.env.DEPLOY_PRIME_URL || process.env.URL || "http://localhost:4321";

export default defineConfig({
  site,
  integrations: [mdx()],
});
