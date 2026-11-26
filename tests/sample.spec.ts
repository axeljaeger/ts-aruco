import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __tsArucoSample?: {
      ready: boolean;
      markerIds: number[];
      markerCount: number;
      source: string;
      error?: string;
    };
  }
}

test("modern module sample consumes the built package", async ({ page }) => {
  await page.goto("/samples/module-detector/index.html?source=fixture");

  await page.waitForFunction(
    () => window.__tsArucoSample?.ready === true || Boolean(window.__tsArucoSample?.error),
  );

  const result = await page.evaluate(() => window.__tsArucoSample);

  expect(result?.error).toBeUndefined();
  expect(result).toMatchObject({
    markerCount: 1,
    markerIds: [1001],
    source: "fixture",
  });
  await expect(page.locator("#status")).toHaveText("markers: 1001");
});
