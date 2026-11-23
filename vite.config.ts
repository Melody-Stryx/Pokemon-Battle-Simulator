import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const buildDate = new Date();
const buildNumber = [
  buildDate.getFullYear().toString(16),
  (buildDate.getMonth() + 1).toString(16).padStart(2, "0"),
  buildDate.getDate().toString(16).padStart(2, "0"),
  buildDate.getHours().toString(16).padStart(2, "0"),
  buildDate.getMinutes().toString(16).padStart(2, "0")
].join("").toUpperCase();

export default defineConfig({
  define: {
    __BUILD_NUMBER__: JSON.stringify(buildNumber)
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        // The bundled Showdown simulator and Pokédex data currently produce an 8.5 MB app chunk.
        // Keep the app offline-capable while allowing that bundle into the precache.
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024
      },
      includeAssets: [],
      manifest: {
        name: "Pokémon Battle Lab",
        short_name: "Battle Lab",
        description: "Pokémon team testing and battle analysis",
        theme_color: "#111318",
        background_color: "#111318",
        display: "standalone",
        start_url: "/",
        icons: []
      }
    })
  ]
});