// biome-ignore-all format: matrices are laid out by hand
import type { Marker } from "./aruco.js";
import type { Point } from "./cv.js";
import type { Pose } from "./pose.js";

/** Anything with a POSIT style `pose(corners)` method (posit1 or posit2). */
export interface PoseEstimator {
  pose(corners: readonly Point[]): Pose;
}

/**
 * Converts image corners (origin top-left, y down) into the centered, y-up coordinates POSIT
 * expects. Returns new points; the input is not modified.
 */
export function centerCorners(corners: readonly Point[], width: number, height: number): Point[] {
  return corners.map((c) => ({ x: c.x - width / 2, y: height / 2 - c.y }));
}

/** Estimates the pose of a detected marker in an image of the given size. */
export function estimatePose(
  estimator: PoseEstimator,
  marker: Marker,
  width: number,
  height: number,
): Pose {
  return estimator.pose(centerCorners(marker.corners, width, height));
}

export type Handedness = "right" | "left";

/**
 * Builds a 4x4 model-view matrix from a POSIT rotation and translation.
 *
 * The result is a flat array of 16 numbers with the translation at indices 12-14. That is the
 * layout of three.js `Matrix4.fromArray()` and Babylon.js `Matrix.FromArray()`.
 *
 * - `"right"` (three.js, Babylon with `useRightHandedSystem`): camera looks down -z. The
 *   marker's local +z points out of the marker towards the camera.
 * - `"left"` (Babylon.js default): camera looks down +z. The marker's local -z points out of
 *   the marker towards the camera.
 *
 * In both cases x is the marker's right edge and y its top edge, and the matrix maps marker
 * space (units of the `modelSize` given to POSIT) to camera space.
 */
export function poseToMatrix(
  rotation: readonly (readonly number[])[],
  translation: readonly number[],
  handedness: Handedness = "right",
): number[] {
  const r = rotation;
  const t = translation;

  if (handedness === "left") {
    // POSIT's camera frame is already x right, y up, z forward.
    return [
      r[0][0], r[1][0], r[2][0], 0,
      r[0][1], r[1][1], r[2][1], 0,
      r[0][2], r[1][2], r[2][2], 0,
      t[0], t[1], t[2], 1,
    ];
  }

  // Right handed: S * [R|t] * S with S = diag(1, 1, -1).
  return [
    r[0][0], r[1][0], -r[2][0], 0,
    r[0][1], r[1][1], -r[2][1], 0,
    -r[0][2], -r[1][2], r[2][2], 0,
    t[0], t[1], -t[2], 1,
  ];
}

/**
 * Vertical field of view (radians) of a pinhole camera with the given focal length in pixels.
 * Use it so the 3D camera matches the focal length passed to POSIT.
 */
export function verticalFieldOfView(focalLength: number, imageHeight: number): number {
  return 2 * Math.atan(imageHeight / 2 / focalLength);
}
