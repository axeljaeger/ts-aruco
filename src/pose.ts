/**
 * Result of a POSIT pose estimation. Coplanar POSIT yields two solutions; `best*` is the one
 * with the smaller reprojection error.
 *
 * Rotation is a row-major 3x3 matrix, translation a 3-vector, both in the camera frame used
 * by js-aruco: x right, y up, z pointing away from the camera into the scene.
 */
export class Pose {
  bestError: number;
  bestRotation: number[][];
  bestTranslation: number[];
  alternativeError: number;
  alternativeRotation: number[][];
  alternativeTranslation: number[];

  constructor(
    bestError: number,
    bestRotation: number[][],
    bestTranslation: number[],
    alternativeError: number,
    alternativeRotation: number[][],
    alternativeTranslation: number[],
  ) {
    this.bestError = bestError;
    this.bestRotation = bestRotation;
    this.bestTranslation = bestTranslation;
    this.alternativeError = alternativeError;
    this.alternativeRotation = alternativeRotation;
    this.alternativeTranslation = alternativeTranslation;
  }
}
