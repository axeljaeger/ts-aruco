export {
  Detector,
  type DetectorOptions,
  defaultDetectorOptions,
  Marker,
} from "./aruco.js";
export type { Point } from "./cv.js";
export * as CV from "./cv.js";
export { Mat3, Vec3 } from "./linalg.js";
export { Pose } from "./pose.js";
export {
  centerCorners,
  estimatePose,
  type Handedness,
  type PoseEstimator,
  poseToMatrix,
  verticalFieldOfView,
} from "./pose-utils.js";
export * as POS from "./posit1.js";
/** Coplanar POSIT (js-aruco posit1), the default pose estimator. */
export { type PoseError, Posit } from "./posit1.js";
export * as POS2 from "./posit2.js";
export type { PreprocessResult } from "./preprocess.js";
export * as SVD from "./svd.js";

import { Detector, Marker } from "./aruco.js";

/** Namespace with the names of the original js-aruco `AR` global. */
export const AR: { readonly Detector: typeof Detector; readonly Marker: typeof Marker } = {
  Detector,
  Marker,
};
export {
  type AutoFrameSource,
  type AutoPreprocessorOptions,
  CpuPreprocessor,
  createPreprocessor,
  DEFAULT_BACKENDS,
  type FramePreprocessor,
  type PreprocessorBackend,
} from "./auto.js";
