import { describe, expect, it } from "vitest"

import { isLocalDashboardRequest, type LocalAccessRequest } from "./local-access"

function makeRequest(host: string | undefined, remoteAddress: string | undefined): LocalAccessRequest {
  return {
    headers: { host },
    socket: { remoteAddress },
  }
}

describe("isLocalDashboardRequest", () => {
  it.each([
    "localhost",
    "localhost:5173",
    "127.0.0.1",
    "127.0.0.1:5173",
    "[::1]",
    "[::1]:5173",
    "::1",
    "::1:5173",
  ])("allows loopback host %s from a loopback remote", (host) => {
    expect(isLocalDashboardRequest(makeRequest(host, "127.0.0.1"))).toBe(true)
  })

  it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1", "::FFFF:127.0.0.1"])(
    "allows loopback remote %s with a loopback host",
    (remoteAddress) => {
      expect(isLocalDashboardRequest(makeRequest("localhost:5173", remoteAddress))).toBe(true)
    }
  )

  it.each(["192.168.1.20", "10.0.0.5", "203.0.113.10"])(
    "rejects non-loopback remote %s even when Host is spoofed",
    (remoteAddress) => {
      expect(isLocalDashboardRequest(makeRequest("localhost:5173", remoteAddress))).toBe(false)
    }
  )

  it.each([
    "192.168.1.20",
    "10.0.0.5:5173",
    "203.0.113.10",
    "example.test",
    "localhost.evil.test",
    "127.0.0.1.evil.test",
    "[::2]:5173",
  ])("rejects non-loopback host %s", (host) => {
    expect(isLocalDashboardRequest(makeRequest(host, "127.0.0.1"))).toBe(false)
  })

  it("rejects requests missing Host or remote address", () => {
    expect(isLocalDashboardRequest(makeRequest(undefined, "127.0.0.1"))).toBe(false)
    expect(isLocalDashboardRequest(makeRequest("localhost", undefined))).toBe(false)
  })
})
