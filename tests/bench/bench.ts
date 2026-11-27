/**
 * CPU benchmark per pipeline stage, port vs. original js-aruco.
 * Run: npm run bench
 */
import { CV, Detector } from "../../src/index.js";
import { loadReference } from "../support/reference.js";
import { renderScene } from "../support/synthetic.js";

const ref = loadReference();

function time(fn: () => void, iterations: number): number {
  for (let i = 0; i < 5; ++i) fn();
  const start = performance.now();
  for (let i = 0; i < iterations; ++i) fn();
  return (performance.now() - start) / iterations;
}

for (const [width, height] of [
  [640, 480],
  [1280, 720],
]) {
  const s = width / 640;
  const image = renderScene({
    width,
    height,
    samples: 1,
    noise: 4,
    markers: [
      {
        id: 1001 & 1023,
        corners: [
          { x: 200 * s, y: 120 * s },
          { x: 420 * s, y: 140 * s },
          { x: 400 * s, y: 350 * s },
          { x: 190 * s, y: 330 * s },
        ],
      },
    ],
  });

  const grey = CV.grayscale(image, new CV.Image());
  const thres = new CV.Image();
  const refGrey = new ref.CV.Image();
  ref.CV.grayscale(image, refGrey);
  const refThres = new ref.CV.Image();
  const detector = new Detector();
  const refDetector = new ref.AR.Detector();
  const n = width > 640 ? 50 : 100;

  const rows = [
    [
      "grayscale",
      () => CV.grayscale(image, grey),
      () => ref.CV.grayscale(image, new ref.CV.Image()),
    ],
    [
      "adaptiveThreshold",
      () => CV.adaptiveThreshold(grey, thres, 2, 7),
      () => ref.CV.adaptiveThreshold(refGrey, refThres, 2, 7),
    ],
    ["detect (total)", () => detector.detect(image), () => refDetector.detect(image)],
  ] as const;

  console.log(`\n${width}x${height}, ms per frame (mean of ${n})`);
  console.log("stage               port    original");
  for (const [name, port, original] of rows) {
    const a = time(port, n);
    const b = time(original, n);
    console.log(`${name.padEnd(18)} ${a.toFixed(2).padStart(6)}  ${b.toFixed(2).padStart(8)}`);
  }
}
