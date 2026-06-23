import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __arucoRegression?: {
      ready: boolean;
      markerIds: number[];
      markerCount: number;
      cameraMocked: boolean;
    };
  }
}

test("detects a known marker and preserves the canvas overlay", async ({ page }) => {
  await page.goto("/tests/fixtures/detector-overlay.html");

  await page.waitForFunction(() => window.__arucoRegression?.ready === true);

  const result = await page.evaluate(() => window.__arucoRegression);

  expect(result).toMatchObject({
    cameraMocked: true,
    markerCount: 1,
    markerIds: [1001],
  });

  await expect(page.locator("#overlay")).toHaveScreenshot("single-marker-overlay.png");
});
