// @vitest-environment node

import { createCipheriv, randomBytes } from "node:crypto"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  deriveSessionKey,
  openSession,
  sealSession,
  serializeCookie,
  type Session,
} from "./session.ts"

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

function createKey() {
  return deriveSessionKey("session-secret-with-at-least-thirty-two-characters")
}

function sealPlaintext(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const encrypted = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString("base64url")
}

afterEach(() => {
  vi.useRealTimers()
})

describe("session cookies", () => {
  it("round-trips a sealed session", () => {
    const key = createKey()
    const now = Date.parse("2026-06-11T12:00:00Z")
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const session: Session = {
      id: "session-id",
      token: "gho_token",
      login: "jskoiz",
      issuedAt: now,
    }

    const value = sealSession(session, key)

    expect(openSession(value, key)).toEqual(session)
  })

  it("returns null for tampered cookie values", () => {
    const key = createKey()
    const value = sealSession({ id: "session-id", token: "gho_token", login: "jskoiz", issuedAt: Date.now() }, key)
    const raw = Buffer.from(value, "base64url")
    raw[raw.length - 1] ^= 1

    expect(openSession(raw.toString("base64url"), key)).toBeNull()
  })

  it("returns null for malformed base64url and malformed JSON", () => {
    const key = createKey()

    expect(openSession("not-a-valid-session", key)).toBeNull()
    expect(openSession(sealPlaintext("not-json", key), key)).toBeNull()
  })

  it("returns null for obsolete and malformed session shapes", () => {
    const key = createKey()
    const issuedAt = Date.parse("2026-06-11T12:00:00Z")

    expect(openSession(sealPlaintext(JSON.stringify({
      token: "gho_token",
      login: "jskoiz",
      issuedAt,
    }), key), key)).toBeNull()
    expect(openSession(sealPlaintext(JSON.stringify({
      id: 123,
      token: "gho_token",
      login: "jskoiz",
      issuedAt,
    }), key), key)).toBeNull()
    expect(openSession(sealPlaintext(JSON.stringify({
      id: "session-id",
      token: 123,
      login: "jskoiz",
      issuedAt,
    }), key), key)).toBeNull()
    expect(openSession(sealPlaintext(JSON.stringify({
      id: "session-id",
      token: "gho_token",
      login: false,
      issuedAt,
    }), key), key)).toBeNull()
    expect(openSession(sealPlaintext(JSON.stringify({
      id: "session-id",
      token: "gho_token",
      login: "jskoiz",
      issuedAt: "2026-06-11T12:00:00Z",
    }), key), key)).toBeNull()
  })

  it("returns null for sessions older than the maximum age", () => {
    const key = createKey()
    const now = Date.parse("2026-06-11T12:00:00Z")
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const value = sealSession({
      id: "session-id",
      token: "gho_token",
      login: "jskoiz",
      issuedAt: now - SESSION_MAX_AGE_MS - 1,
    }, key)

    expect(openSession(value, key)).toBeNull()
  })

  it("serializes secure and non-secure cookie attributes", () => {
    const cookie = serializeCookie("gcc_session", "value", { maxAgeSeconds: 60 })

    expect(cookie).toContain("gcc_session=value")
    expect(cookie).toContain("Path=/")
    expect(cookie).toContain("HttpOnly")
    expect(cookie).toContain("SameSite=Lax")
    expect(cookie).toContain("Max-Age=60")
    expect(cookie).not.toContain("Secure")

    expect(serializeCookie("gcc_session", "value", { secure: true })).toContain("Secure")
  })
})
