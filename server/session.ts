import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export type Session = {
  token: string
  login: string
  issuedAt: number
}

export function deriveSessionKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest()
}

export function sealSession(session: Session, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const plaintext = Buffer.from(JSON.stringify(session), "utf8")
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString("base64url")
}

export function openSession(value: string, key: Buffer): Session | null {
  try {
    const raw = Buffer.from(value, "base64url")
    const iv = raw.subarray(0, IV_LENGTH)
    const tag = raw.subarray(IV_LENGTH, IV_LENGTH + 16)
    const encrypted = raw.subarray(IV_LENGTH + 16)
    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")
    const parsed = JSON.parse(plaintext) as Session
    if (typeof parsed.token !== "string" || typeof parsed.login !== "string" || typeof parsed.issuedAt !== "number") {
      return null
    }
    if (Date.now() - parsed.issuedAt > SESSION_MAX_AGE_MS) return null
    return parsed
  } catch {
    return null
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {}
  if (!header) return cookies
  for (const part of header.split(";")) {
    const equals = part.indexOf("=")
    if (equals < 0) continue
    cookies[part.slice(0, equals).trim()] = part.slice(equals + 1).trim()
  }
  return cookies
}

export function serializeCookie(
  name: string,
  value: string,
  options: { maxAgeSeconds?: number; secure?: boolean } = {}
): string {
  const parts = [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax"]
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${options.maxAgeSeconds}`)
  if (options.secure) parts.push("Secure")
  return parts.join("; ")
}
