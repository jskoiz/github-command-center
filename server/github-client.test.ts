// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createPublicExecutor,
  createTokenExecutor,
  isGithubRateLimitError,
  PaginationLimitError,
  revokeOAuthToken,
} from "./github-client.ts"

function jsonResponse(body: unknown, options: { status?: number; headers?: Record<string, string> } = {}) {
  const headers = new Headers(options.headers)
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json")
  return new Response(JSON.stringify(body), {
    status: options.status ?? 200,
    headers,
  })
}

function emptyResponse(status: number) {
  return new Response(null, { status })
}

function installFetchMock() {
  const fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

function getFetchCall(fetchMock: ReturnType<typeof installFetchMock>, index = 0) {
  const call = fetchMock.mock.calls[index]
  if (!call) throw new Error(`Missing fetch call at index ${index}.`)
  return call
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("createTokenExecutor", () => {
  it("sends REST requests with OAuth and GitHub API headers", async () => {
    const fetchMock = installFetchMock()
    fetchMock.mockResolvedValueOnce(jsonResponse({ login: "jskoiz" }))

    const executor = createTokenExecutor("gho_secret")
    const stdout = await executor([
      "api",
      "/user",
      "-H",
      "X-GitHub-Api-Version:2026-03-10",
    ], "/user")
    const [url, init] = getFetchCall(fetchMock)

    expect(url).toBe("https://api.github.com/user")
    expect(init?.method).toBe("GET")
    expect(init?.headers).toMatchObject({
      Accept: "application/vnd.github+json",
      Authorization: "Bearer gho_secret",
      "User-Agent": "github-command-center",
      "X-GitHub-Api-Version": "2026-03-10",
    })
    expect(JSON.parse(stdout)).toEqual({ login: "jskoiz" })
  })

  it("follows paginated REST links and slurps page bodies", async () => {
    const fetchMock = installFetchMock()
    fetchMock
      .mockResolvedValueOnce(jsonResponse([{ id: 1 }], {
        headers: {
          Link: '<https://api.github.com/user/repos?page=2>; rel="next"',
        },
      }))
      .mockResolvedValueOnce(jsonResponse([{ id: 2 }]))

    const executor = createTokenExecutor("gho_secret")
    const stdout = await executor(["api", "/user/repos", "--paginate", "--slurp"], "/user/repos")

    expect(JSON.parse(stdout)).toEqual([[{ id: 1 }], [{ id: 2 }]])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(getFetchCall(fetchMock, 1)[0]).toBe("https://api.github.com/user/repos?page=2")
  })

  it("throws capped paginated REST responses with parsed partial pages and without the token", async () => {
    const fetchMock = installFetchMock()
    const token = "gho_secret"

    for (let page = 1; page <= 10; page += 1) {
      fetchMock.mockResolvedValueOnce(jsonResponse([{ id: page }], {
        headers: {
          Link: `<https://api.github.com/user/repos?page=${page + 1}>; rel="next"`,
        },
      }))
    }

    const executor = createTokenExecutor(token)

    let thrown: unknown
    try {
      await executor(["api", "/user/repos", "--paginate", "--slurp"], "/user/repos")
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(PaginationLimitError)
    expect(thrown).toMatchObject({
      endpoint: "/user/repos",
      pageCount: 10,
    })
    expect((thrown as PaginationLimitError).partialPages).toEqual([
      [{ id: 1 }],
      [{ id: 2 }],
      [{ id: 3 }],
      [{ id: 4 }],
      [{ id: 5 }],
      [{ id: 6 }],
      [{ id: 7 }],
      [{ id: 8 }],
      [{ id: 9 }],
      [{ id: 10 }],
    ])
    expect((thrown as Error).message).not.toContain(token)
    expect(fetchMock).toHaveBeenCalledTimes(10)
  })

  it("throws non-OK REST responses with status and endpoint but without the token", async () => {
    const fetchMock = installFetchMock()
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Forbidden" }, { status: 403 }))
    const token = "gho_secret"
    const executor = createTokenExecutor(token)

    let thrown: unknown
    try {
      await executor(["api", "/repos/jskoiz/private"], "/repos/jskoiz/private")
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({
      status: 403,
      endpoint: "/repos/jskoiz/private",
    })
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toContain("GitHub API returned 403")
    expect((thrown as Error).message).not.toContain(token)
  })

  it("marks GitHub REST rate limit responses with retry metadata", async () => {
    const fetchMock = installFetchMock()
    fetchMock.mockResolvedValueOnce(jsonResponse(
      { message: "API rate limit exceeded for 203.0.113.10." },
      {
        status: 403,
        headers: {
          "Retry-After": "60",
          "X-RateLimit-Remaining": "0",
        },
      }
    ))
    const executor = createTokenExecutor("gho_secret")

    let thrown: unknown
    try {
      await executor(["api", "/users/jskoiz"], "/users/jskoiz")
    } catch (error) {
      thrown = error
    }

    expect(isGithubRateLimitError(thrown)).toBe(true)
    expect(thrown).toMatchObject({
      code: "github_rate_limit",
      endpoint: "/users/jskoiz",
      retryAfterSeconds: 60,
      status: 403,
    })
    expect(Date.parse((thrown as { retryAt: string }).retryAt)).not.toBeNaN()
  })

  it("sends GraphQL queries and typed fields in the POST body", async () => {
    const fetchMock = installFetchMock()
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { viewer: { login: "jskoiz" } } }))

    const query = "query Test($limit: Int!, $includePrivate: Boolean!) { viewer { login } }"
    const executor = createTokenExecutor("gho_secret")
    const stdout = await executor([
      "api",
      "graphql",
      "-H",
      "X-GitHub-Api-Version:2026-03-10",
      "-f",
      `query=${query}`,
      "-F",
      "limit=3",
      "-F",
      "includePrivate=true",
      "-f",
      "owner=jskoiz",
    ], "graphql")
    const [url, init] = getFetchCall(fetchMock)

    expect(url).toBe("https://api.github.com/graphql")
    expect(init?.method).toBe("POST")
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer gho_secret",
      "X-GitHub-Api-Version": "2026-03-10",
    })
    expect(typeof init?.body).toBe("string")
    expect(JSON.parse(String(init?.body))).toEqual({
      query,
      variables: {
        owner: "jskoiz",
        limit: 3,
        includePrivate: true,
      },
    })
    expect(JSON.parse(stdout)).toEqual({ data: { viewer: { login: "jskoiz" } } })
  })

  it("throws GraphQL responses with errors and no data", async () => {
    const fetchMock = installFetchMock()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      errors: [{ message: "Field does not exist" }],
    }))
    const executor = createTokenExecutor("gho_secret")

    await expect(executor([
      "api",
      "graphql",
      "-f",
      "query=query Test { missing }",
    ], "graphql")).rejects.toMatchObject({
      status: 200,
      endpoint: "graphql",
    })
  })
})

describe("createPublicExecutor", () => {
  it("omits Authorization by default for public REST requests", async () => {
    const fetchMock = installFetchMock()
    fetchMock.mockResolvedValueOnce(jsonResponse({ login: "jskoiz" }))

    const executor = createPublicExecutor()
    await executor(["api", "/users/jskoiz"], "/users/jskoiz")
    const [, init] = getFetchCall(fetchMock)

    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it("uses an optional server token for public REST requests", async () => {
    const fetchMock = installFetchMock()
    fetchMock.mockResolvedValueOnce(jsonResponse({ login: "jskoiz" }))

    const executor = createPublicExecutor("ghp_public_rate_token")
    await executor(["api", "/users/jskoiz"], "/users/jskoiz")
    const [, init] = getFetchCall(fetchMock)

    expect(init?.headers).toMatchObject({
      Authorization: "Bearer ghp_public_rate_token",
    })
  })
})

describe("revokeOAuthToken", () => {
  it("sends the OAuth app token revocation request", async () => {
    const fetchMock = installFetchMock()
    fetchMock.mockResolvedValueOnce(emptyResponse(204))

    await revokeOAuthToken({
      clientId: "client-id",
      clientSecret: "client-secret",
      token: "gho_secret",
    })
    const [url, init] = getFetchCall(fetchMock)

    expect(url).toBe("https://api.github.com/applications/client-id/token")
    expect(init?.method).toBe("DELETE")
    expect(init?.headers).toMatchObject({
      Accept: "application/vnd.github+json",
      Authorization: `Basic ${Buffer.from("client-id:client-secret", "utf8").toString("base64")}`,
      "Content-Type": "application/json",
      "User-Agent": "github-command-center",
    })
    expect(JSON.parse(String(init?.body))).toEqual({ access_token: "gho_secret" })
  })

  it("treats missing GitHub OAuth tokens as already revoked", async () => {
    const fetchMock = installFetchMock()
    fetchMock.mockResolvedValueOnce(emptyResponse(404))

    await expect(revokeOAuthToken({
      clientId: "client-id",
      clientSecret: "client-secret",
      token: "gho_secret",
    })).resolves.toBeUndefined()
  })

  it("throws sanitized errors for unexpected revocation failures", async () => {
    const fetchMock = installFetchMock()
    const token = "gho_secret"
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: token }, { status: 500 }))

    let thrown: unknown
    try {
      await revokeOAuthToken({
        clientId: "client-id",
        clientSecret: "client-secret",
        token,
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({
      status: 500,
      endpoint: "DELETE /applications/{client_id}/token",
    })
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toContain("GitHub OAuth token revocation returned 500.")
    expect((thrown as Error).message).not.toContain(token)
  })
})
