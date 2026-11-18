import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
// Fonts are bundled with the app (no Google Fonts request), all under the SIL Open Font License.
import "@fontsource-variable/inter/opsz.css";
import "@fontsource/audiowide/latin-400.css";
import "@fontsource-variable/tektur/wght.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource-variable/noto-sans-georgian";
import "@fontsource-variable/noto-sans-armenian";
import "./index.css";
import "./watch.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
