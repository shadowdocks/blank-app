import { defineConfig, devices } from "@playwright/test"

const DEV_URL = "http://localhost:5173"
const E2E_URL = "http://127.0.0.1:6173"
const existingUrl = await firstRunningHawk([DEV_URL, E2E_URL])
const baseURL = existingUrl ?? E2E_URL

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "line",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: existingUrl ? undefined : {
    command: "bun run dev:frontend -- --host 127.0.0.1 --port 6173 --strictPort",
    url: E2E_URL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
})

async function firstRunningHawk(urls: string[]): Promise<string | null> {
  for (const url of urls) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(750) })
      if (response.ok && (await response.text()).includes("<title>Hawk</title>")) return url
    } catch {
      // The port is free or belongs to a service that did not answer in time.
    }
  }
  return null
}
