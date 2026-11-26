/*
Copyright (c) 2011 Juan Mellado

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/

/*
References:
- "ArUco: a minimal library for Augmented Reality applications based on OpenCv"
  http://www.uco.es/investiga/grupos/ava/node/26
*/

import * as CV from "./cv.js";

/** 5x5 bit matrix, row-major. */
export type Bits = number[][];

/** A detected marker: its id and its 4 image corners, clockwise from the marker's top-left. */
export class Marker {
  constructor(
    public id: number,
    public corners: CV.Point[],
  ) {}
}

export interface DetectorOptions {
  /** Radius of the box blur used by the adaptive threshold. Default 2. */
  adaptiveThresholdKernelSize?: number;
  /** How much darker than its neighbourhood a pixel must be to count as black. Default 7. */
  adaptiveThresholdConstant?: number;
  /** Minimum contour length in pixels, as a fraction of the image width. Default 0.2. */
  minContourLengthRatio?: number;
  /** Polygon approximation accuracy, as a fraction of the contour length. Default 0.05. */
  polygonEpsilonRatio?: number;
  /** Minimum edge length of a candidate quad in pixels. Default 10. */
  minEdgeLength?: number;
  /** Candidates whose corners are on average closer than this (pixels) are merged. Default 10. */
  minCornerDistance?: number;
  /** Size of the rectified marker image used to read the bits. Default 49 (7 per cell). */
  warpSize?: number;
}

export const defaultDetectorOptions: Readonly<Required<DetectorOptions>> = Object.freeze({
  adaptiveThresholdKernelSize: 2,
  adaptiveThresholdConstant: 7,
  minContourLengthRatio: 0.2,
  polygonEpsilonRatio: 0.05,
  minEdgeLength: 10,
  minCornerDistance: 10,
  warpSize: 49,
});

/** The 4 valid row patterns of the original js-aruco marker code. */
const ROW_CODES: readonly (readonly number[])[] = [
  [1, 0, 0, 0, 0],
  [1, 0, 1, 1, 1],
  [0, 1, 0, 0, 1],
  [0, 1, 1, 1, 0],
];

export class Detector {
  readonly options: Readonly<Required<DetectorOptions>>;

  /** Intermediate images of the last frame, useful for debugging. */
  readonly grey = new CV.Image();
  readonly thres = new CV.Image();
  readonly homography = new CV.Image();
  contours: CV.TracedContour[] = [];
  polys: CV.Contour[] = [];
  candidates: CV.Contour[] = [];

  private readonly contourBuffer = new CV.ContourBuffer();

  constructor(options: DetectorOptions = {}) {
    this.options = Object.freeze({ ...defaultDetectorOptions, ...options });
  }

  /** Detects markers in an RGBA image such as `ImageData`. */
  detect(image: CV.RgbaImageLike): Marker[] {
    const { adaptiveThresholdKernelSize, adaptiveThresholdConstant } = this.options;

    CV.grayscale(image, this.grey);
    CV.adaptiveThreshold(
      this.grey,
      this.thres,
      adaptiveThresholdKernelSize,
      adaptiveThresholdConstant,
    );

    return this.detectPreprocessed(this.grey, this.thres);
  }

  /**
   * Detects markers from an already computed greyscale image and adaptive threshold mask
   * (non zero = dark pixel). This is the entry point for GPU preprocessing.
   */
  detectPreprocessed(grey: CV.Image, thresholded: CV.Image): Marker[] {
    const o = this.options;

    this.contours = CV.findContours(thresholded, this.contourBuffer);

    let candidates = this.findCandidates(
      this.contours,
      grey.width * o.minContourLengthRatio,
      o.polygonEpsilonRatio,
      o.minEdgeLength,
    );
    candidates = this.clockwiseCorners(candidates);
    candidates = this.notTooNear(candidates, o.minCornerDistance);
    this.candidates = candidates;

    return this.findMarkers(grey, candidates, o.warpSize);
  }

  findCandidates(
    contours: readonly CV.Contour[],
    minSize: number,
    epsilon: number,
    minLength: number,
  ): CV.Contour[] {
    const candidates: CV.Contour[] = [];

    this.polys = [];

    for (const contour of contours) {
      if (contour.length >= minSize) {
        const poly = CV.approxPolyDP(contour, contour.length * epsilon);

        this.polys.push(poly);

        if (4 === poly.length && CV.isContourConvex(poly)) {
          if (CV.minEdgeLength(poly) >= minLength) {
            candidates.push(poly);
          }
        }
      }
    }

    return candidates;
  }

  /** Reorders the corners of each candidate in place so they run clockwise (in image space). */
  clockwiseCorners(candidates: CV.Contour[]): CV.Contour[] {
    for (const c of candidates) {
      const dx1 = c[1].x - c[0].x;
      const dy1 = c[1].y - c[0].y;
      const dx2 = c[2].x - c[0].x;
      const dy2 = c[2].y - c[0].y;

      if (dx1 * dy2 - dy1 * dx2 < 0) {
        const swap = c[1];
        c[1] = c[3];
        c[3] = swap;
      }
    }

    return candidates;
  }

  /** Of two candidates with nearly the same corners, keeps the one with the larger perimeter. */
  notTooNear(candidates: readonly CV.Contour[], minDist: number): CV.Contour[] {
    const len = candidates.length;
    const tooNear = new Uint8Array(len);

    for (let i = 0; i < len; ++i) {
      for (let j = i + 1; j < len; ++j) {
        let dist = 0;

        for (let k = 0; k < 4; ++k) {
          const dx = candidates[i][k].x - candidates[j][k].x;
          const dy = candidates[i][k].y - candidates[j][k].y;

          dist += dx * dx + dy * dy;
        }

        if (dist / 4 < minDist * minDist) {
          if (CV.perimeter(candidates[i]) < CV.perimeter(candidates[j])) {
            tooNear[i] = 1;
          } else {
            tooNear[j] = 1;
          }
        }
      }
    }

    return candidates.filter((_, i) => tooNear[i] === 0);
  }

  findMarkers(imageSrc: CV.Image, candidates: readonly CV.Contour[], warpSize: number): Marker[] {
    const markers: Marker[] = [];

    for (const candidate of candidates) {
      CV.warp(imageSrc, this.homography, candidate, warpSize);
      CV.threshold(this.homography, this.homography, CV.otsu(this.homography));

      const marker = this.getMarker(this.homography, candidate);
      if (marker) {
        markers.push(marker);
      }
    }

    return markers;
  }

  getMarker(imageSrc: CV.Image, candidate: readonly CV.Point[]): Marker | null {
    const width = (imageSrc.width / 7) >>> 0;
    const minZero = (width * width) >> 1;
    const bits: Bits = [];
    const rotations: Bits[] = [];
    const distances: number[] = [];

    // The outer ring of cells must be black.
    for (let i = 0; i < 7; ++i) {
      const inc = 0 === i || 6 === i ? 1 : 6;

      for (let j = 0; j < 7; j += inc) {
        const square = { x: j * width, y: i * width, width, height: width };
        if (CV.countNonZero(imageSrc, square) > minZero) {
          return null;
        }
      }
    }

    for (let i = 0; i < 5; ++i) {
      bits[i] = [];

      for (let j = 0; j < 5; ++j) {
        const square = { x: (j + 1) * width, y: (i + 1) * width, width, height: width };

        bits[i][j] = CV.countNonZero(imageSrc, square) > minZero ? 1 : 0;
      }
    }

    rotations[0] = bits;
    distances[0] = this.hammingDistance(rotations[0]);

    let bestDistance = distances[0];
    let bestRotation = 0;

    for (let i = 1; i < 4; ++i) {
      rotations[i] = this.rotate(rotations[i - 1]);
      distances[i] = this.hammingDistance(rotations[i]);

      if (distances[i] < bestDistance) {
        bestDistance = distances[i];
        bestRotation = i;
      }
    }

    if (0 !== bestDistance) {
      return null;
    }

    return new Marker(
      this.mat2id(rotations[bestRotation]),
      this.rotate2(candidate, 4 - bestRotation),
    );
  }

  hammingDistance(bits: Bits): number {
    let dist = 0;

    for (let i = 0; i < 5; ++i) {
      let minSum = Infinity;

      for (const code of ROW_CODES) {
        let sum = 0;

        for (let k = 0; k < 5; ++k) {
          sum += bits[i][k] === code[k] ? 0 : 1;
        }

        if (sum < minSum) {
          minSum = sum;
        }
      }

      dist += minSum;
    }

    return dist;
  }

  mat2id(bits: Bits): number {
    let id = 0;

    for (let i = 0; i < 5; ++i) {
      id <<= 1;
      id |= bits[i][1];
      id <<= 1;
      id |= bits[i][3];
    }

    return id;
  }

  /** Rotates a square bit matrix by 90 degrees. */
  rotate(src: Bits): Bits {
    const dst: Bits = [];
    const len = src.length;

    for (let i = 0; i < len; ++i) {
      dst[i] = [];
      for (let j = 0; j < src[i].length; ++j) {
        dst[i][j] = src[src[i].length - j - 1][i];
      }
    }

    return dst;
  }

  /** Cyclically shifts the corner list by `rotation` positions. */
  rotate2(src: readonly CV.Point[], rotation: number): CV.Point[] {
    const dst: CV.Point[] = [];
    const len = src.length;

    for (let i = 0; i < len; ++i) {
      dst[i] = src[(rotation + i) % len];
    }

    return dst;
  }
}
