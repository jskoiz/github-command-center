import { lazy, Suspense } from "react"

import { resolveAppRoute } from "@/lib/routes"
import { useTheme } from "@/lib/theme"
import { Homepage } from "@/pages/Homepage"

const DashboardPage = lazy(() => import("@/pages/DashboardPage"))

function App() {
  const route = resolveAppRoute(window.location.pathname)
  const { theme, toggleTheme } = useTheme()

  if (route.kind === "home") {
    return <Homepage theme={theme} onThemeToggle={toggleTheme} />
  }

  return (
    <Suspense fallback={<DashboardLoading />}>
      <DashboardPage
        demoMode={route.demoMode}
        publicUsername={route.publicUsername}
        theme={theme}
        onThemeToggle={toggleTheme}
      />
    </Suspense>
  )
}

function DashboardLoading() {
  return <div className="min-h-screen bg-background" aria-label="Loading dashboard" />
}

export default App
