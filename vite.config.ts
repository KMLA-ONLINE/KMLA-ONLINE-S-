import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
});

// The service worker is NOT generated here. React Router's SPA build runs as
// several Vite environments and writes build/client/index.html in a prerender
// pass that finishes after every plugin's `closeBundle` hook, so vite-plugin-pwa
// globs an empty directory (vite-pwa/vite-plugin-pwa#809). `scripts/build-sw.mjs`
// runs workbox-build against the finished output instead — see `npm run build`.
