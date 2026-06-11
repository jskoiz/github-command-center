import type { IncomingHttpHeaders } from "node:http"

export const LOCAL_DASHBOARD_ONLY_MESSAGE = "Dashboard API is only available from loopback clients."

export type LocalAccessRequest = {
  headers: Pick<IncomingHttpHeaders, "host">
  socket: {
    remoteAddress?: string
  }
}

const LOOPBACK_HOST_PATTERN = /^(?:(?:localhost|127\.0\.0\.1)(?::\d+)?|\[::1\](?::\d+)?|::1(?::\d+)?)$/
const LOOPBACK_REMOTE_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"])

export function isLocalDashboardRequest(request: LocalAccessRequest): boolean {
  return isLoopbackHost(request.headers.host) && isLoopbackRemoteAddress(request.socket.remoteAddress)
}

function isLoopbackHost(host: string | undefined): boolean {
  if (!host) {
    return false
  }

  return LOOPBACK_HOST_PATTERN.test(host.trim().toLowerCase())
}

function isLoopbackRemoteAddress(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) {
    return false
  }

  return LOOPBACK_REMOTE_ADDRESSES.has(remoteAddress.trim().toLowerCase())
}
