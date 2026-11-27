import { expect, test } from "@playwright/test";
import { scene } from "../support/scenes.js";

declare global {
  interface Window {
    gpuFixtureReady?: boolean;
    compareWebGL2(
      width: number,
      height: number,
      base64: string,
      mode: "sync" | "async",
    ): Promise<{
      greyMismatch: number;
      greyMaxDiff: number;
      maskMismatch: number;
      maskValues: number[];
      gpuMarkers: unknown[];
      cpuMarkers: unknown[];
    }>;
  }
}

// 642 is not a multiple of 4 and exercises the row unpacking path.
const sizes = [
  [640, 480],
  [642, 361],
  [320, 240],
] as const;

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/e2e/fixtures/gpu.html");
  await page.waitForFunction(() => window.gpuFixtureReady === true);
});

for (const [width, height] of sizes) {
  for (const mode of ["async", "sync"] as const) {
    test(`WebGL2 preprocessing matches the CPU at ${width}x${height} (${mode})`, async ({
      page,
    }) => {
      for (let seed = 1; seed <= 3; ++seed) {
        const base64 = scene(seed + width, width, height);
        const result = await page.evaluate(([w, h, b, m]) => window.compareWebGL2(w, h, b, m), [
          width,
          height,
          base64,
          mode,
        ] as const);

        // Blur and threshold are bit exact.
        expect(result.maskMismatch).toBe(0);
        expect(result.maskValues.every((v) => v === 0 || v === 255)).toBe(true);
        // Integer greyscale may be 1 lower for a handful of colours.
        expect(result.greyMaxDiff).toBeLessThanOrEqual(1);
        expect(result.greyMismatch).toBeLessThan(width * height * 0.001);
        expect(result.gpuMarkers).toEqual(result.cpuMarkers);
        expect(result.cpuMarkers.length).toBeGreaterThan(0);
      }
    });
  }
}
