// Runs before first paint to avoid a light-theme flash for dark-mode users.
;(function () {
  try {
    var stored = localStorage.getItem("github-command-center:theme")
    var dark = stored === "dark" || (stored !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)
    if (dark) document.documentElement.classList.add("dark")
  } catch (e) {
    /* theme falls back to light */
  }
})()
