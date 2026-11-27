import { expect, test } from "@playwright/test";

interface MarkerSummary {
  id: number;
  corners: Array<{ x: number; y: number }>;
}

interface RegressionResult {
  ready: boolean;
  markerIds: number[];
  markerCount: number;
  cameraMocked: boolean;
  markers: MarkerSummary[];
  error?: string;
}

declare global {
  interface Window {
    __arucoRegression?: RegressionResult;
  }
}

const cases = [
  {
    name: "single marker",
    scenario: "single",
    markerIds: [1001],
    expectedBoundsById: new Map([[1001, { minX: 220, minY: 136, maxX: 420, maxY: 338 }]]),
    screenshot: "single-marker-overlay.png",
  },
  {
    name: "smaller marker",
    scenario: "small",
    markerIds: [1001],
    expectedBoundsById: new Map([[1001, { minX: 250, minY: 166, maxX: 394, maxY: 310 }]]),
    screenshot: "small-marker-overlay.png",
  },
  {
    name: "different marker id",
    scenario: "differentId",
    markerIds: [37],
    expectedBoundsById: new Map([[37, { minX: 220, minY: 136, maxX: 420, maxY: 338 }]]),
    screenshot: "different-id-overlay.png",
  },
  {
    name: "two markers",
    scenario: "double",
    markerIds: [37, 1001],
    expectedBoundsById: new Map([
      [37, { minX: 388, minY: 166, maxX: 532, maxY: 310 }],
      [1001, { minX: 90, minY: 128, maxX: 262, maxY: 302 }],
    ]),
    screenshot: "two-marker-overlay.png",
  },
  {
    name: "empty frame",
    scenario: "empty",
    markerIds: [],
    expectedBoundsById: new Map(),
    screenshot: "empty-frame-overlay.png",
  },
];

for (const testCase of cases) {
  test(`detects ${testCase.name} and preserves the canvas overlay`, async ({ page }) => {
    await page.goto(`/tests/e2e/fixtures/detector-overlay.html?scenario=${testCase.scenario}`);

    await page.waitForFunction(
      () => window.__arucoRegression?.ready === true || Boolean(window.__arucoRegression?.error),
    );

    const result = await page.evaluate(() => window.__arucoRegression);

    expect(result?.error).toBeUndefined();
    expect(result).toMatchObject({
      cameraMocked: true,
      markerCount: testCase.markerIds.length,
      markerIds: testCase.markerIds,
    });

    for (const marker of result?.markers ?? []) {
      const bounds = testCase.expectedBoundsById.get(marker.id);
      const xs = marker?.corners.map((corner) => corner.x) ?? [];
      const ys = marker?.corners.map((corner) => corner.y) ?? [];

      expect(bounds).toBeDefined();
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(bounds.minX);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(bounds.minY);
      expect(Math.max(...xs)).toBeLessThanOrEqual(bounds.maxX);
      expect(Math.max(...ys)).toBeLessThanOrEqual(bounds.maxY);
    }

    // Chromium builds anti-alias the outline strokes slightly differently (seen: 10 pixels between
    // the CI browser and the one the Linux snapshots were taken with). Marker positions are checked
    // exactly above; the screenshot guards the overlay as a whole.
    await expect(page.locator("#overlay")).toHaveScreenshot(testCase.screenshot, {
      maxDiffPixels: 40,
    });
  });
}
