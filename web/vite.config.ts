import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react()],
  // The worker imports the Python sources from ../tools.
  server: { fs: { allow: [".."] } },
  optimizeDeps: { exclude: ["pyodide"] },
  worker: { format: "es" },
});
