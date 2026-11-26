import { describe, expect, test } from "vitest";
import { CV, Detector } from "../../src/index.js";
import { loadReference } from "../support/reference.js";
import { type MarkerPlacement, renderScene, rng } from "../support/synthetic.js";

const ref = loadReference();

function randomQuad(random: () => number, width: number, height: number) {
  const size = 60 + random() * 160;
  const cx = size + random() * (width - 2 * size);
  const cy = size + random() * (height - 2 * size);
  const angle = random() * Math.PI * 2;
  const corners = [0, 1, 2, 3].map((k) => {
    const a = angle + (k * Math.PI) / 2 - (3 * Math.PI) / 4;
    const r = (size / Math.SQRT2) * (0.85 + random() * 0.3);
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
  return corners;
}

/** Random scenes: 1-2 markers, random ids, rotation, perspective-like skew and noise. */
const scenes = Array.from({ length: 12 }, (_, seed) => {
  const random = rng(seed + 100);
  const width = 320 + Math.floor(random() * 3) * 160;
  const height = 240 + Math.floor(random() * 2) * 120;
  const count = 1 + Math.floor(random() * 2);
  const markers: MarkerPlacement[] = [];
  for (let i = 0; i < count; ++i) {
    markers.push({ id: Math.floor(random() * 1024), corners: randomQuad(random, width, height) });
  }
  return {
    name: `scene ${seed} (${width}x${height}, ${count} marker)`,
    image: renderScene({ width, height, markers, noise: 2 + random() * 10, seed }),
  };
});

describe("port matches the original js-aruco exactly", () => {
  for (const { name, image } of scenes) {
    test(name, () => {
      const refDetector = new ref.AR.Detector();
      const refMarkers = refDetector.detect(image);

      const detector = new Detector();
      const markers = detector.detect(image);

      // Intermediate images
      expect(Array.from(detector.grey.data)).toEqual(refDetector.grey.data);
      expect(Array.from(detector.thres.data)).toEqual(refDetector.thres.data);
      expect(detector.contours.length).toBe(refDetector.contours.length);
      expect(detector.candidates).toEqual(
        refDetector.candidates.map((c: { x: number; y: number }[]) =>
          c.map(({ x, y }) => ({ x, y })),
        ),
      );

      // Final result
      expect(markers.map((m) => ({ id: m.id, corners: m.corners }))).toEqual(
        refMarkers.map((m: { id: number; corners: { x: number; y: number }[] }) => ({
          id: m.id,
          corners: m.corners.map(({ x, y }) => ({ x, y })),
        })),
      );
    });
  }

  test("at least most scenes contain detectable markers", () => {
    const found = scenes.filter(({ image }) => new Detector().detect(image).length > 0).length;
    expect(found).toBeGreaterThanOrEqual(scenes.length - 2);
  });
});

describe("cv functions match the original", () => {
  const { image } = scenes[0];

  test("stackBoxBlur for all kernel sizes", () => {
    const grey = CV.grayscale(image, new CV.Image());
    for (let k = 1; k < 16; ++k) {
      const out = CV.stackBoxBlur(grey, new CV.Image(), k);
      const refGrey = new ref.CV.Image();
      ref.CV.grayscale(image, refGrey);
      const refOut = new ref.CV.Image();
      ref.CV.stackBoxBlur(refGrey, refOut, k);
      expect(Array.from(out.data)).toEqual(refOut.data);
    }
  });

  test("gaussianBlur", () => {
    const grey = CV.grayscale(image, new CV.Image());
    for (const k of [3, 5, 7, 9]) {
      const out = CV.gaussianBlur(grey, new CV.Image(), new CV.FloatImage(), k);
      const refGrey = new ref.CV.Image();
      ref.CV.grayscale(image, refGrey);
      const refOut = new ref.CV.Image();
      ref.CV.gaussianBlur(refGrey, refOut, new ref.CV.Image(), k);
      expect(Array.from(out.data)).toEqual(refOut.data);
    }
  });

  test("otsu", () => {
    const grey = CV.grayscale(image, new CV.Image());
    const refGrey = new ref.CV.Image();
    ref.CV.grayscale(image, refGrey);
    expect(CV.otsu(grey)).toBe(ref.CV.otsu(refGrey));
  });
});
