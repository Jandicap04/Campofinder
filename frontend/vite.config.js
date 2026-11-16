import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  publicDir: path.resolve(rootDirectory, "../static"),
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  build: {
    outDir: path.resolve(rootDirectory, "dist"),
    emptyOutDir: true,
  },
});
