import { spawn } from "node:child_process"
import { createServer } from "node:net"

const host = "127.0.0.1"
const port = await reservePort(host)
const baseUrl = `http://${host}:${port}`
const output = []

const child = spawn(process.execPath, ["server/main.ts"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    BASE_URL: baseUrl,
    GITHUB_PUBLIC_TOKEN: "hosted-smoke-token",
    PORT: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
})

child.stdout.on("data", (chunk) => output.push(chunk.toString()))
child.stderr.on("data", (chunk) => output.push(chunk.toString()))

try {
  const response = await waitForHealth(`${baseUrl}/healthz`, child)
  const payload = await response.json()
  if (payload?.ok !== true) {
    throw new Error(`Unexpected health response: ${JSON.stringify(payload)}`)
  }
  console.log(`Hosted smoke passed at ${baseUrl}/healthz`)
} finally {
  child.kill("SIGTERM")
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ])
}

async function reservePort(hostname) {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, hostname, resolve)
  })
  const address = server.address()
  const availablePort = typeof address === "object" && address ? address.port : null
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  if (!availablePort) throw new Error("Could not reserve a local port for the hosted smoke test.")
  return availablePort
}

async function waitForHealth(url, processHandle) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(`Hosted server exited before becoming healthy.\n${output.join("")}`)
    }
    try {
      const response = await fetch(url)
      if (response.ok) return response
    } catch {
      // The server may still be binding its socket.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Hosted server did not become healthy.\n${output.join("")}`)
}
