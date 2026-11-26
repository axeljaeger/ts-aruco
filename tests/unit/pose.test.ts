import { describe, expect, test } from "vitest";
import {
  centerCorners,
  Detector,
  estimatePose,
  POS2,
  Posit,
  poseToMatrix,
} from "../../src/index.js";
import { loadReference } from "../support/reference.js";
import { type Mat3, projectMarker, renderScene, rotationFromEuler } from "../support/synthetic.js";

const ref = loadReference();
const width = 640;
const height = 480;
const focal = 640;
const size = 100;

const poses: { name: string; rotation: Mat3; translation: number[] }[] = [
  { name: "frontal", rotation: rotationFromEuler(0, 0, 0), translation: [0, 0, 400] },
  { name: "tilted", rotation: rotationFromEuler(0.5, 0.2, 0.3), translation: [40, -20, 500] },
  { name: "rolled", rotation: rotationFromEuler(-0.4, 0.6, 2.0), translation: [-60, 30, 450] },
  { name: "far", rotation: rotationFromEuler(0.3, -0.5, -1.0), translation: [10, 10, 900] },
];

function expectClose(actual: number[], expected: number[], tolerance: number) {
  for (let i = 0; i < expected.length; ++i) {
    expect(Math.abs(actual[i] - expected[i])).toBeLessThan(tolerance);
  }
}

// posit2 stops iterating once the corner angles match within 2 degrees, so it is less exact:
// on these poses the original posit2 is off by up to ~6% in translation (posit1: <1%).
describe.each([
  ["posit1", Posit, ref.POS, 0.02, 0.01],
  ["posit2", POS2.Posit, ref.POS2, 0.06, 0.08],
] as const)("%s", (_name, PositClass, RefPos, rotationTolerance, translationTolerance) => {
  for (const { name, rotation, translation } of poses) {
    test(`recovers a known ${name} pose`, () => {
      const corners = projectMarker(rotation, translation, size, focal, width, height);
      const pose = new PositClass(size, focal).pose(centerCorners(corners, width, height));

      expectClose(pose.bestRotation.flat(), rotation.flat(), rotationTolerance);
      expectClose(pose.bestTranslation, translation, translation[2] * translationTolerance);
    });

    test(`matches the original for the ${name} pose`, () => {
      const corners = centerCorners(
        projectMarker(rotation, translation, size, focal, width, height),
        width,
        height,
      );
      const pose = new PositClass(size, focal).pose(corners);
      const refPose = new RefPos.Posit(size, focal).pose(corners.map((c) => ({ ...c })));

      expect(pose.bestError).toBe(refPose.bestError);
      expect(pose.bestRotation).toEqual(refPose.bestRotation);
      expect(pose.bestTranslation).toEqual(refPose.bestTranslation);
      expect(pose.alternativeError).toBe(refPose.alternativeError);
    });
  }
});

test("detector plus POSIT recovers the pose from a rendered image", () => {
  const { rotation, translation } = poses[1];
  const corners = projectMarker(rotation, translation, size, focal, width, height);
  const image = renderScene({ width, height, markers: [{ id: 300, corners }], noise: 3 });

  const markers = new Detector().detect(image);
  expect(markers.map((m) => m.id)).toEqual([300]);

  const pose = estimatePose(new Posit(size, focal), markers[0], width, height);
  expectClose(pose.bestRotation.flat(), rotation.flat(), 0.1);
  expectClose(pose.bestTranslation, translation, translation[2] * 0.05);
});

describe("poseToMatrix", () => {
  const { rotation, translation } = poses[2];
  const h = size / 2;
  const model = [
    [-h, h, 0],
    [h, h, 0],
    [h, -h, 0],
    [-h, -h, 0],
  ];
  const expected = projectMarker(rotation, translation, size, focal, width, height);

  function apply(m: number[], p: number[]) {
    return [0, 1, 2].map((i) => m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2] + m[12 + i]);
  }

  test("right handed: camera looks down -z and reprojects the corners", () => {
    const m = poseToMatrix(rotation, translation, "right");
    model.forEach((X, k) => {
      const p = apply(m, X);
      expect(p[2]).toBeLessThan(0);
      expect(width / 2 + (focal * p[0]) / -p[2]).toBeCloseTo(expected[k].x, 6);
      expect(height / 2 - (focal * p[1]) / -p[2]).toBeCloseTo(expected[k].y, 6);
    });
  });

  test("left handed: camera looks down +z and reprojects the corners", () => {
    const m = poseToMatrix(rotation, translation, "left");
    model.forEach((X, k) => {
      const p = apply(m, X);
      expect(p[2]).toBeGreaterThan(0);
      expect(width / 2 + (focal * p[0]) / p[2]).toBeCloseTo(expected[k].x, 6);
      expect(height / 2 - (focal * p[1]) / p[2]).toBeCloseTo(expected[k].y, 6);
    });
  });

  test("right handed: local +z of a frontal marker points to the camera", () => {
    const m = poseToMatrix(rotationFromEuler(0, 0, 0), [0, 0, 400], "right");
    const a = apply(m, [0, 0, 0]);
    const b = apply(m, [0, 0, 10]);
    expect(b[2]).toBeGreaterThan(a[2]);
  });
});
