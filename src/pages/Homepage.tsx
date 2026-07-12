import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { MoonIcon, SunIcon } from "lucide-react"

import { GitHubIcon } from "@/components/icons/GitHubIcon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { GITHUB_LOGIN_PATTERN } from "@/lib/routes"
import type { Theme } from "@/lib/theme"

const REPO_URL = "https://github.com/jskoiz/github-command-center"
const X_URL = "https://x.com/jskoiz"
const DASHBOARD_PREVIEW_WIDTH = 1240
const DASHBOARD_PREVIEW_HEIGHT = 620
const DEMO_PREVIEW_VERSION = "stripless"

export function Homepage({
  theme,
  onThemeToggle,
}: {
  theme: Theme
  onThemeToggle: () => void
}) {
  const [username, setUsername] = useState("")
  const normalizedUsername = username.trim()
  const publicPath = GITHUB_LOGIN_PATTERN.test(normalizedUsername)
    ? `/${encodeURIComponent(normalizedUsername)}`
    : "/"

  return (
    <div className="min-h-screen bg-background text-foreground [text-wrap:pretty]">
      <div className="mx-auto max-w-[1320px] px-6 min-[520px]:px-10">
        <header className="flex items-center pt-9">
          <a href="/" className="flex items-center gap-[9px] text-[17px] leading-none font-semibold" aria-label="okgithub home">
            <GitHubIcon className="size-7" aria-hidden="true" />
            okgithub
          </a>
          <div className="flex-1" />
          <Button
            type="button"
            onClick={onThemeToggle}
            title="Toggle theme"
            aria-label="Toggle theme"
            variant="outline"
            size="icon-lg"
            className="text-muted-foreground"
          >
            {theme === "dark" ? <SunIcon aria-hidden="true" /> : <MoonIcon aria-hidden="true" />}
          </Button>
        </header>

        <main>
          <section className="mx-auto max-w-[620px] pt-16 text-center">
            <h1 className="m-0 text-[44px] leading-[1.15] font-semibold tracking-[-0.02em]">
              A better GitHub homepage.
            </h1>
            <p className="mt-4 text-[17px] leading-[1.6] font-normal text-muted-foreground">
              One view of everything: PRs, issues, commits, CI, and Actions billing across all your repos. No login needed unless you want to see the private stuff. Open source.
            </p>

            <div className="mx-auto mt-7 max-w-[460px]">
              <form
                action={publicPath}
                className="flex flex-col gap-2.5 min-[520px]:flex-row"
                onSubmit={(event) => {
                  if (!normalizedUsername || !GITHUB_LOGIN_PATTERN.test(normalizedUsername)) {
                    event.preventDefault()
                  }
                }}
              >
                <Input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="github username"
                  aria-label="GitHub username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="h-[42px] flex-1 bg-card px-3.5 text-[15px]"
                />
                <Button type="submit" className="h-[42px] px-[18px] text-[14px]">
                  Open public view
                </Button>
              </form>
              <p className="mt-3 text-[13px] leading-[1.5] font-normal text-muted-foreground">
                Or{" "}
                <a href="/auth/login" className="font-medium underline underline-offset-3">
                  sign in with GitHub
                </a>{" "}
                for private repos, workflow runs, and billing.
              </p>
            </div>
          </section>

          <section className="mt-14" aria-label="Demo dashboard">
            <div className="mb-2.5 flex items-center gap-2.5 font-mono text-[12.5px] leading-none font-medium text-muted-foreground">
              <Button asChild variant="secondary" size="xs" className="font-mono">
                <a href="/demo">/demo</a>
              </Button>
              <span>live with sample data</span>
            </div>
            <ScaledDemoFrame>
              <iframe
                src={`/demo?theme=${theme}&preview=${DEMO_PREVIEW_VERSION}`}
                title="Live demo dashboard"
                className="block border-0 bg-background"
                style={{ width: DASHBOARD_PREVIEW_WIDTH, height: DASHBOARD_PREVIEW_HEIGHT }}
              />
            </ScaledDemoFrame>
          </section>

          <section className="mt-[60px] grid grid-cols-1 gap-9 min-[860px]:grid-cols-3">
            <HomepageFeature title="Public view, no login">
              Any profile is a dashboard: <code className="rounded-[5px] bg-muted px-1.5 py-0.5 font-mono text-[12px] leading-none font-medium text-foreground">okgithub.com/username</code> shows public PRs, issues, commits, CI, and repos instantly.
            </HomepageFeature>
            <HomepageFeature title="Sign in for everything">
              GitHub OAuth unlocks private repos, workflow runs, Actions billing — everything your token can read.
            </HomepageFeature>
            <HomepageFeature title="Self-host or run local">
              Open source. Run it on your machine against the <code className="rounded-[5px] bg-muted px-1.5 py-0.5 font-mono text-[12px] leading-none font-medium text-foreground">gh</code> CLI, or deploy the hosted server anywhere a container runs.
            </HomepageFeature>
          </section>
        </main>

        <footer className="mt-[60px] flex flex-wrap items-center gap-x-[22px] gap-y-3 border-t border-border py-[26px] pb-[34px] text-[13px] leading-none font-normal text-muted-foreground">
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-foreground hover:underline">
            <GitHubIcon className="size-[15px]" aria-hidden="true" />
            jskoiz/github-command-center
          </a>
          <span>MIT</span>
          <span className="hidden flex-1 min-[620px]:block" />
          <span>
            Questions?{" "}
            <a href={X_URL} target="_blank" rel="noreferrer" className="font-medium text-foreground hover:underline">
              @jskoiz
            </a>{" "}
            on X
          </span>
        </footer>
      </div>
    </div>
  )
}

function HomepageFeature({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-[15px] leading-[1.3] font-semibold">{title}</h3>
      <p className="text-[13.5px] leading-[1.55] font-normal text-muted-foreground">{children}</p>
    </div>
  )
}

function ScaledDemoFrame({ children }: { children: ReactNode }) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const updateScale = () => {
      const width = frame.clientWidth || DASHBOARD_PREVIEW_WIDTH
      setScale(width / DASHBOARD_PREVIEW_WIDTH)
    }

    updateScale()
    if (typeof ResizeObserver === "undefined") return

    const observer = new ResizeObserver(updateScale)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  const height = Math.round(DASHBOARD_PREVIEW_HEIGHT * scale)
  const previewStyle: CSSProperties = {
    width: DASHBOARD_PREVIEW_WIDTH,
    height: DASHBOARD_PREVIEW_HEIGHT,
    transform: `scale(${scale})`,
    transformOrigin: "top left",
  }

  return (
    <div
      ref={frameRef}
      className="overflow-hidden rounded-xl border border-border bg-background shadow-[0_1px_2px_oklch(0_0_0_/_5%),0_12px_32px_-16px_oklch(0_0_0_/_14%)]"
      style={{ height }}
    >
      <div style={previewStyle}>{children}</div>
    </div>
  )
}
