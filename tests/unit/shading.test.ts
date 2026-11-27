import { describe, expect, test } from "vitest";
import { markerBits } from "../../site/src/common/marker-code.js";
import { CV, Detector, readBitsCompensated } from "../../src/index.js";

/**
 * A phone screen showing marker 108 (20 px per cell, rotated 30 degrees) with a window
 * reflection over its right part: a bright band with frame bars that lifts black and white cells.
 */
function reflectedFrame(strength: number, seed = 1) {
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const w = 640;
  const h = 480;
  const bits = markerBits(108);
  const cell = 20;
  const ca = Math.cos(Math.PI / 6);
  const sa = Math.sin(Math.PI / 6);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; ++y) {
    for (let x = 0; x < w; ++x) {
      const su = (x - 320) * ca + (y - 240) * sa;
      const sv = -(x - 320) * sa + (y - 240) * ca;
      let g = 110 + 30 * Math.sin(x / 13);
      if (Math.abs(su) < 170 && Math.abs(sv) < 230) {
        g = 205;
        const r = Math.floor(sv / cell + 3.5) - 1;
        const c = Math.floor(su / cell + 3.5) - 1;
        const inMarker = r >= -1 && r <= 5 && c >= -1 && c <= 5;
        const white = r >= 0 && r < 5 && c >= 0 && c < 5 && bits[r]?.[c] === 1;
        if (inMarker && !white) g = 25;
        if (x > 330 && x < 470) {
          const bar = Math.abs(((x - 330) % 45) - 22) < 4 ? 1 : 0.55;
          const streak = 0.5 + 0.5 * Math.sin(y / 7 + x / 23);
          g += strength * (bar * 0.7 + 0.3 * streak) * (0.8 + 0.4 * rnd());
        }
      }
      g += (rnd() - 0.5) * 10;
      data.set([g, g, g, 255], (y * w + x) * 4);
    }
  }
  return { width: w, height: h, data };
}

describe("shading compensation", () => {
  test.each([
    2, 3,
  ])("the original settings lose a marker under a strong reflection (%i)", (seed) => {
    expect(new Detector().detect(reflectedFrame(150, seed))).toEqual([]);
  });

  test.each([2, 3])("a wider window plus compensated bit reading recovers it (%i)", (seed) => {
    const detector = new Detector({ adaptiveThresholdKernelSize: 5, compensateShading: true });
    expect(detector.detect(reflectedFrame(150, seed)).map((m) => m.id)).toEqual([108]);
  });

  test("results without reflections are unchanged", () => {
    const frame = reflectedFrame(0);
    const plain = new Detector().detect(frame);
    const compensated = new Detector({ compensateShading: true }).detect(frame);
    expect(compensated).toEqual(plain);
    expect(plain.map((m) => m.id)).toEqual([108]);
  });

  test("a flat or borderless patch gives no bits", () => {
    const flat = new CV.Image(49, 49, new Uint8Array(49 * 49).fill(128));
    expect(readBitsCompensated(flat)).toBeNull();
    const white = new CV.Image(49, 49, new Uint8Array(49 * 49).fill(250));
    for (let i = 0; i < 49 * 49; i += 3) white.data[i] = 10;
    expect(readBitsCompensated(white)).toBeNull();
  });

  test("demo settings find a 28 px marker in a 720p frame", () => {
    const w = 1280;
    const h = 720;
    const cell = 4;
    const data = new Uint8ClampedArray(w * h * 4).fill(235);
    const bits = markerBits(108);
    for (let r = -1; r <= 5; ++r) {
      for (let c = -1; c <= 5; ++c) {
        const border = r === -1 || r === 5 || c === -1 || c === 5;
        const v = border || bits[r]?.[c] === 0 ? 20 : 235;
        for (let y = 0; y < cell; ++y) {
          for (let x = 0; x < cell; ++x) {
            const o = ((300 + r * cell + y) * w + 600 + c * cell + x) * 4;
            data.set([v, v, v, 255], o);
          }
        }
      }
    }
    const frame = { width: w, height: h, data };
    expect(new Detector().detect(frame)).toEqual([]);
    const demo = new Detector({
      adaptiveThresholdKernelSize: 5,
      compensateShading: true,
      minContourLengthRatio: 0.04,
    });
    expect(demo.detect(frame).map((m) => m.id)).toEqual([108]);
  });
});
