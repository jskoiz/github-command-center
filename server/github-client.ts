const GITHUB_API_BASE = "https://api.github.com"
const REQUEST_TIMEOUT_MS = 30_000
const MAX_PAGINATED_PAGES = 10

export type GhExecutor = (args: string[], endpoint: string) => Promise<string>

type GhApiError = Error & {
  stderr?: string
  endpoint?: string
  status?: number
}

/**
 * Executes the same `gh api ...` argument vectors used by the dashboard module,
 * but over plain HTTPS with an OAuth token instead of the GitHub CLI. This is
 * what makes hosted (multi-user) deployments possible.
 */
export function createTokenExecutor(token: string): GhExecutor {
  return async (args, endpoint) => {
    const parsed = parseGhArgs(args)
    if (parsed.target === "graphql") {
      return executeGraphql(token, parsed, endpoint)
    }
    return executeRest(token, parsed, endpoint)
  }
}

type ParsedGhArgs = {
  target: string
  headers: Record<string, string>
  paginate: boolean
  slurp: boolean
  rawFields: Record<string, string>
  typedFields: Record<string, string>
}

function parseGhArgs(args: string[]): ParsedGhArgs {
  const [command, target, ...rest] = args
  if (command !== "api" || !target) {
    throw new Error(`Unsupported gh invocation: ${args.join(" ")}`)
  }

  const parsed: ParsedGhArgs = {
    target,
    headers: {},
    paginate: false,
    slurp: false,
    rawFields: {},
    typedFields: {},
  }

  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index]
    if (flag === "--paginate") {
      parsed.paginate = true
    } else if (flag === "--slurp") {
      parsed.slurp = true
    } else if (flag === "-H") {
      const header = rest[++index] ?? ""
      const colon = header.indexOf(":")
      if (colon > 0) parsed.headers[header.slice(0, colon).trim()] = header.slice(colon + 1).trim()
    } else if (flag === "-f" || flag === "-F") {
      const field = rest[++index] ?? ""
      const equals = field.indexOf("=")
      if (equals > 0) {
        const key = field.slice(0, equals)
        const value = field.slice(equals + 1)
        if (flag === "-f") parsed.rawFields[key] = value
        else parsed.typedFields[key] = value
      }
    }
  }

  return parsed
}

async function executeRest(token: string, parsed: ParsedGhArgs, endpoint: string): Promise<string> {
  let url = toApiUrl(parsed.target)
  const pages: unknown[] = []

  for (let page = 0; page < (parsed.paginate ? MAX_PAGINATED_PAGES : 1); page += 1) {
    const response = await githubFetch(token, url, parsed.headers, endpoint)
    const body = await response.text()
    pages.push(body ? JSON.parse(body) : null)

    if (!parsed.paginate) break
    const next = parseNextLink(response.headers.get("link"))
    if (!next) break
    url = next
  }

  if (parsed.slurp) return JSON.stringify(pages)
  if (pages.length === 1) return JSON.stringify(pages[0])
  if (pages.every(Array.isArray)) return JSON.stringify(pages.flat())
  return JSON.stringify(pages[0])
}

async function executeGraphql(token: string, parsed: ParsedGhArgs, endpoint: string): Promise<string> {
  const query = parsed.rawFields.query
  if (!query) throw new Error("GraphQL invocation is missing a query field.")

  const variables: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parsed.rawFields)) {
    if (key !== "query") variables[key] = value
  }
  for (const [key, value] of Object.entries(parsed.typedFields)) {
    variables[key] = coerceTypedField(value)
  }

  const response = await githubFetch(token, `${GITHUB_API_BASE}/graphql`, parsed.headers, endpoint, {
    method: "POST",
    body: JSON.stringify({ query, variables }),
  })
  const body = await response.text()
  const json = JSON.parse(body) as { data?: unknown; errors?: Array<{ message?: string }> }
  if (!json.data && json.errors?.length) {
    throw createApiError(json.errors.map((item) => item.message).filter(Boolean).join("; ") || "GraphQL request failed.", endpoint, response.status)
  }
  return body
}

async function githubFetch(
  token: string,
  url: string,
  headers: Record<string, string>,
  endpoint: string,
  init: { method?: string; body?: string } = {}
): Promise<Response> {
  const response = await fetch(url, {
    method: init.method ?? "GET",
    body: init.body,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "github-command-center",
      ...headers,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    let message = `GitHub API returned ${response.status} for ${endpoint}.`
    try {
      const body = await response.json() as { message?: string }
      if (body.message) message = `${message} ${body.message}`
    } catch {
      // Non-JSON error bodies still surface the status code above.
    }
    throw createApiError(message, endpoint, response.status)
  }

  return response
}

function createApiError(message: string, endpoint: string, status?: number): GhApiError {
  const error = new Error(message) as GhApiError
  error.stderr = message
  error.endpoint = endpoint
  error.status = status
  return error
}

function toApiUrl(target: string): string {
  if (target.startsWith("https://")) return target
  return `${GITHUB_API_BASE}${target.startsWith("/") ? "" : "/"}${target}`
}

function parseNextLink(header: string | null): string | null {
  if (!header) return null
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/)
    if (match) return match[1]
  }
  return null
}

function coerceTypedField(value: string): unknown {
  if (value === "true") return true
  if (value === "false") return false
  if (value === "null") return null
  if (/^-?\d+$/.test(value)) return Number(value)
  return value
}

export async function exchangeOAuthCode(options: {
  clientId: string
  clientSecret: string
  code: string
  redirectUri: string
}): Promise<string> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "github-command-center",
    },
    body: JSON.stringify({
      client_id: options.clientId,
      client_secret: options.clientSecret,
      code: options.code,
      redirect_uri: options.redirectUri,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  const body = await response.json() as { access_token?: string; error_description?: string; error?: string }
  if (!response.ok || !body.access_token) {
    throw new Error(body.error_description ?? body.error ?? `OAuth token exchange failed with ${response.status}.`)
  }
  return body.access_token
}

export async function fetchViewerLogin(token: string): Promise<string> {
  const response = await githubFetch(token, `${GITHUB_API_BASE}/user`, {}, "user")
  const body = await response.json() as { login?: string }
  if (!body.login) throw new Error("GitHub /user response did not include a login.")
  return body.login
}
