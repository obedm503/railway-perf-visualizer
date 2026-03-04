import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [tanstackRouter({ target: "solid" }), solid(), tailwindcss()],
  base: "/",
  server: {
    host: true,
    port: 3000,
    strictPort: true,
  },
  preview: {
    host: true,
    port: 3000,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
