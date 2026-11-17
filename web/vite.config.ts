import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  // The worker imports the Python sources from ../tools.
  server: { fs: { allow: [".."] } },
  optimizeDeps: { exclude: ["pyodide"] },
  worker: { format: "es" },
});
