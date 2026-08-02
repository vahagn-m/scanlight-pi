import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vuetify from "vite-plugin-vuetify";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL("./web", import.meta.url)),
  plugins: [vue(), vuetify({ autoImport: true })],
  base: "./",
  build: {
    outDir: "dist", // relative to root -> web/dist (served by Express in production)
  },
  server: {
    proxy: {
      // Dev mode: Vite on :5173 proxies Socket.io to the Node server on :3000.
      "/socket.io": { target: "http://localhost:3000", ws: true },
    },
  },
});
