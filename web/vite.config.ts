import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Content Security Policy for the built page (GitHub Pages can't send headers, so it goes in a
// meta tag; dev mode is left alone because Vite's dev server injects inline code). The only
// outside request is the Nothing Archive release list. Chrome applies this policy to the build
// worker too, and Pyodide needs eval and WebAssembly there; scripts still only come from this site.
// Vite inlines the smallest font files as data: URLs.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' https://raw.githubusercontent.com",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const csp = (): Plugin => ({
  name: "csp",
  apply: "build",
  transformIndexHtml: (html) =>
    html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />\n    <meta name="referrer" content="strict-origin-when-cross-origin" />`),
});

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), csp()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  // The worker imports the Python sources from ../tools.
  server: { fs: { allow: [".."] } },
  optimizeDeps: { exclude: ["pyodide"] },
  worker: { format: "es" },
});
