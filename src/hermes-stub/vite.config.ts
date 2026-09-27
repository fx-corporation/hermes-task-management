import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL("./frontend", import.meta.url)),
  plugins: [react()],
  build: { outDir: fileURLToPath(new URL("../../dist/hermes-stub/ui", import.meta.url)), emptyOutDir: true },
  server: { host: "127.0.0.1", proxy: { "/api": `http://127.0.0.1:${process.env.HERMES_STUB_PORT ?? 8643}` } },
});
