import { defineConfig } from "@playwright/test";

// Optional: point Playwright at a preinstalled Chromium (e.g. in CI containers).
const executablePath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results",
  fullyParallel: true,
  reporter: [["list"]],
  // Font rendering differs per OS, so screenshots are stored per platform.
  snapshotPathTemplate: "{testDir}/{testFileName}-snapshots/{arg}-{platform}{ext}",
  webServer: [
    {
      command: "node scripts/static-server.mjs",
      url: "http://127.0.0.1:4173/tests/e2e/fixtures/detector-overlay.html",
      reuseExistingServer: !process.env.CI,
    },
    {
      // The demo site (site/), served by Vite.
      command: "npx vite --host 127.0.0.1 --port 4174 --strictPort",
      url: "http://127.0.0.1:4174/",
      reuseExistingServer: !process.env.CI,
    },
  ],
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    deviceScaleFactor: 1,
    viewport: { width: 720, height: 560 },
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: ["--enable-unsafe-webgpu"],
    },
  },
});
