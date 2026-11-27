import { expect, test } from "@playwright/test";
import { scene } from "../support/scenes.js";

interface Comparison {
  greyMismatch: number;
  greyMaxDiff: number;
  maskMismatch: number;
  maskValues: number[];
  gpuMarkers: unknown[];
  cpuMarkers: unknown[];
}

declare global {
  interface Window {
    compareWebGPU(
      width: number,
      height: number,
      base64: string,
      source: "imagedata" | "bitmap",
    ): Promise<Comparison>;
  }
}

const sizes = [
  [640, 480],
  [642, 361],
  [320, 240],
] as const;

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/e2e/fixtures/gpu.html");
  await page.waitForFunction(() => window.gpuFixtureReady === true);
  const hasWebGPU = await page.evaluate(async () =>
    Boolean(navigator.gpu && (await navigator.gpu.requestAdapter())),
  );
  test.skip(!hasWebGPU, "WebGPU is not available in this browser");
});

for (const [width, height] of sizes) {
  for (const source of ["imagedata", "bitmap"] as const) {
    test(`WebGPU preprocessing matches the CPU at ${width}x${height} (${source})`, async ({
      page,
    }) => {
      for (let seed = 1; seed <= 3; ++seed) {
        const base64 = scene(seed + width, width, height);
        const result = await page.evaluate(([w, h, b, s]) => window.compareWebGPU(w, h, b, s), [
          width,
          height,
          base64,
          source,
        ] as const);

        expect(result.maskMismatch).toBe(0);
        expect(result.maskValues.every((v) => v === 0 || v === 255)).toBe(true);
        expect(result.greyMaxDiff).toBeLessThanOrEqual(1);
        expect(result.greyMismatch).toBeLessThan(width * height * 0.001);
        expect(result.gpuMarkers).toEqual(result.cpuMarkers);
        expect(result.cpuMarkers.length).toBeGreaterThan(0);
      }
    });
  }
}
