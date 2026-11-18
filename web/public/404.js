// Uses the theme and page language the app saved, so the 404 page matches what the visitor last saw.
// Without a saved choice it follows the system setting and the browser language.
(() => {
  let theme = null;
  let lang = null;
  try {
    theme = localStorage.getItem("wl.theme");
    lang = localStorage.getItem("wl.lang");
  } catch {
    // No storage: keep the defaults.
  }
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  if (!lang) lang = (navigator.language || "").toLowerCase().startsWith("el") ? "el" : "en";
  if (lang !== "el") return;

  document.documentElement.lang = "el";
  document.title = "Η σελίδα δεν βρέθηκε · Watch Languages";
  document.addEventListener("DOMContentLoaded", () => {
    for (const el of document.querySelectorAll("[data-el]")) el.textContent = el.dataset.el;
  });
})();
