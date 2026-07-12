import type { DashboardPayload } from "../src/types/github.ts"

const DEFAULT_DASHBOARD_SCAN_LIMIT = 24
const MIN_DASHBOARD_SCAN_LIMIT = 8
const MAX_DASHBOARD_SCAN_LIMIT = 60

const GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/

type DashboardAuth = {
  token: string
  sessionId: string
}

export type DashboardLoaderOptions = {
  force?: boolean
  quick?: boolean
  scanLimit?: number
  auth?: DashboardAuth
}

export type PublicDashboardLoaderOptions = Omit<DashboardLoaderOptions, "auth">

export type DashboardRequestOptions = {
  force: boolean
  quick: boolean
  scanLimit: number
}

export type ParsedDashboardRequest = {
  username: string | null
  options: DashboardRequestOptions
}

export type DashboardLoader = (options: DashboardLoaderOptions) => Promise<DashboardPayload>

export type PublicDashboardLoader = (
  username: string,
  options: PublicDashboardLoaderOptions
) => Promise<DashboardPayload>

export class DashboardRequestError extends Error {
  readonly status = 400

  constructor(message: string) {
    super(message)
    this.name = "DashboardRequestError"
  }
}

export function parseDashboardRequest(url: URL, mountPath: string): ParsedDashboardRequest {
  return {
    username: dashboardUsernameFromPath(url.pathname, mountPath),
    options: {
      force: url.searchParams.get("refresh") === "1",
      quick: url.searchParams.get("quick") === "1",
      scanLimit: parseScanLimit(url.searchParams.get("scanLimit")),
    },
  }
}

export function normalizeGithubLogin(username: string): string {
  const login = username.trim()
  if (!GITHUB_LOGIN_PATTERN.test(login)) {
    throw new DashboardRequestError("Invalid GitHub username.")
  }
  return login
}

function dashboardUsernameFromPath(pathname: string, mountPath: string): string | null {
  const normalizedMountPath = mountPath === "/" ? "" : mountPath.replace(/\/$/, "")
  if (pathname === normalizedMountPath || pathname === `${normalizedMountPath}/`) return null

  const prefix = `${normalizedMountPath}/`
  if (!pathname.startsWith(prefix)) {
    throw new DashboardRequestError("Invalid dashboard path.")
  }

  const encodedUsername = pathname.slice(prefix.length)
  if (!encodedUsername || encodedUsername.includes("/")) {
    throw new DashboardRequestError("Invalid GitHub username.")
  }

  try {
    return normalizeGithubLogin(decodeURIComponent(encodedUsername))
  } catch (error) {
    if (error instanceof DashboardRequestError) throw error
    throw new DashboardRequestError("Invalid GitHub username encoding.")
  }
}

function parseScanLimit(value: string | null): number {
  if (value === null) return DEFAULT_DASHBOARD_SCAN_LIMIT
  if (!/^\d+$/.test(value)) {
    throw new DashboardRequestError("scanLimit must be an integer from 8 to 60.")
  }

  const scanLimit = Number(value)
  if (scanLimit < MIN_DASHBOARD_SCAN_LIMIT || scanLimit > MAX_DASHBOARD_SCAN_LIMIT) {
    throw new DashboardRequestError("scanLimit must be an integer from 8 to 60.")
  }
  return scanLimit
}
