import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import path from "node:path"

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: {
          alias: {
            "@": path.resolve(__dirname, "./src"),
          },
        },
        test: {
          name: "web",
          include: ["src/**/*.{test,spec}.{ts,tsx}"],
          environment: "jsdom",
          setupFiles: "./src/test/setup.ts",
          environmentOptions: {
            jsdom: {
              url: "http://127.0.0.1/",
            },
          },
        },
      },
      {
        test: {
          name: "server",
          include: ["server/**/*.{test,spec}.ts"],
          environment: "node",
        },
      },
    ],
  },
})
