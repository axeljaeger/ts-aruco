import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  outputDir: "test-results",
  fullyParallel: true,
  reporter: [["list"]],
  snapshotPathTemplate: "{testDir}/{testFileName}-snapshots/{arg}{ext}",
  webServer: {
    command: "node tests/support/static-server.mjs",
    url: "http://127.0.0.1:4173/tests/fixtures/detector-overlay.html",
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    deviceScaleFactor: 1,
    viewport: { width: 720, height: 560 },
  },
});
