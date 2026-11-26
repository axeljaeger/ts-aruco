/**
 * Result of a POSIT pose estimation. Coplanar POSIT yields two solutions; `best*` is the one
 * with the smaller reprojection error.
 *
 * Rotation is a row-major 3x3 matrix, translation a 3-vector, both in the camera frame used
 * by js-aruco: x right, y up, z pointing away from the camera into the scene.
 */
export class Pose {
  constructor(
    public bestError: number,
    public bestRotation: number[][],
    public bestTranslation: number[],
    public alternativeError: number,
    public alternativeRotation: number[][],
    public alternativeTranslation: number[],
  ) {}
}
