import { expect, test } from "@playwright/test";
import { POS, POS2 } from "../dist/index.js";

const centeredCorners = [
  { x: -98, y: 98 },
  { x: 98, y: 98 },
  { x: 98, y: -98 },
  { x: -98, y: -98 },
];

function expectFiniteVector(vector: number[]) {
  expect(vector).toHaveLength(3);

  for (const value of vector) {
    expect(Number.isFinite(value)).toBe(true);
  }
}

function expectFiniteMatrix(matrix: number[][]) {
  expect(matrix).toHaveLength(3);

  for (const row of matrix) {
    expect(row).toHaveLength(3);
    for (const value of row) {
      expect(Number.isFinite(value)).toBe(true);
    }
  }
}

for (const [name, module] of [
  ["posit1", POS],
  ["posit2", POS2],
] as const) {
  test(`${name} estimates finite pose values`, () => {
    const posit = new module.Posit(100, 640);
    const pose = posit.pose(centeredCorners);

    expect(Number.isFinite(pose.bestError)).toBe(true);
    expect(Number.isFinite(pose.alternativeError)).toBe(true);
    expectFiniteMatrix(pose.bestRotation);
    expectFiniteVector(pose.bestTranslation);
    expectFiniteMatrix(pose.alternativeRotation);
    expectFiniteVector(pose.alternativeTranslation);
  });
}
