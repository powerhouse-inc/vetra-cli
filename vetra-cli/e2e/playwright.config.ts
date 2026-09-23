import { defineConfig, devices } from "@playwright/test";

/**
 * Seeded end-to-end: global-setup boots a self-contained vetra studio in
 * REPLAY mode against a fresh empty workdir (see support/global-setup.ts), the
 * test drives the chat UI to build a todo-list for real, and asserts the
 * generated editor renders in the BUILD-pane iframe. global-teardown stops the
 * studio. The stack uses fixed ports — stop any running `vetra` studio first.
 *
 * Attach to a studio you started yourself with VETRA_E2E_BASE_URL (boot is
 * then skipped); the test reads the resolved target from .cache/run.json.
 */
export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  globalSetup: "./support/global-setup.ts",
  globalTeardown: "./support/global-teardown.ts",
  // Must exceed preview-wait (VETRA_E2E_PREVIEW_TIMEOUT_MS, default 480s) +
  // assertEditor's budget; genuine replay failures fail fast via the log tail.
  timeout: 720_000,
  expect: { timeout: 30_000 },
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
