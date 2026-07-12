import { useCallback, useEffect, useState } from "react"

const THEME_STORAGE_KEY = "github-command-center:theme"

export type Theme = "light" | "dark"

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme())

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // Theme preference is best-effort; the toggle still works for this session.
    }
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((current) => current === "dark" ? "light" : "dark")
  }, [])

  return { theme, toggleTheme }
}

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light"
  const themeParam = new URLSearchParams(window.location.search).get("theme")
  if (themeParam === "light" || themeParam === "dark") return themeParam
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === "light" || stored === "dark") return stored
  } catch {
    // Stored preference is best-effort; fall through to the system preference.
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}
