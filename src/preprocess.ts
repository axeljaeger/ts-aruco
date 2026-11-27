import type { Image } from "./cv.js";

/** Output of a GPU preprocessor, input for `Detector.detectPreprocessed()`. */
export interface PreprocessResult {
  /** Greyscale image, input for marker decoding. */
  grey: Image;
  /** Adaptive threshold mask, 255 = dark pixel. */
  thresholded: Image;
}
