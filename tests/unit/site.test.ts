import { describe, expect, test } from "vitest";
import { markerBits } from "../../site/src/common/marker-code.js";
import { composeMatrix, quatFromMatrix, slerp } from "../../site/src/common/math.js";
import { CpuPreprocessor, createPreprocessor, Detector, poseToMatrix } from "../../src/index.js";

/** Renders marker `id` (with a one cell quiet zone) at 10 px per cell into an RGBA image. */
function renderMarker(id: number) {
  const cell = 10;
  const n = 11 * cell;
  const data = new Uint8ClampedArray(n * n * 4).fill(255);
  const bits = markerBits(id);
  for (let y = 0; y < n; ++y) {
    for (let x = 0; x < n; ++x) {
      const r = Math.floor(y / cell) - 2;
      const c = Math.floor(x / cell) - 2;
      const inMarker = r >= -1 && r <= 5 && c >= -1 && c <= 5;
      const white = !inMarker || (r >= 0 && r < 5 && c >= 0 && c < 5 && bits[r][c] === 1);
      const v = white ? 255 : 0;
      data.set([v, v, v, 255], (y * n + x) * 4);
    }
  }
  return { width: n, height: n, data };
}

describe("demo site helpers", () => {
  test.each([0, 1, 108, 512, 1023])("marker %i drawn by the site is detected with its id", (id) => {
    const markers = new Detector().detect(renderMarker(id));
    expect(markers.map((m) => m.id)).toEqual([id]);
  });

  test("quaternion round trip through composeMatrix", () => {
    const m = poseToMatrix(
      [
        [0, -1, 0],
        [1, 0, 0],
        [0, 0, 1],
      ],
      [1, 2, 3],
    );
    const q = quatFromMatrix(m);
    const back = composeMatrix([m[12], m[13], m[14]], q, 1);
    for (let i = 0; i < 16; ++i) expect(back[i]).toBeCloseTo(m[i], 6);
    expect(slerp(q, q, 0.5).map((v) => +v.toFixed(6))).toEqual(q.map((v) => +v.toFixed(6)));
  });

  test("createPreprocessor falls back to the CPU and matches Detector.detect", async () => {
    const image = renderMarker(108);
    const pre = await createPreprocessor({ backends: ["webgpu", "cpu"] });
    expect(pre).toBeInstanceOf(CpuPreprocessor);
    const result = await pre.process(image as ImageData);
    const markers = new Detector().detectPreprocessed(result.grey, result.thresholded);
    expect(markers.map((m) => m.id)).toEqual([108]);
  });
});
