import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
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