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
  id: number;
  corners: CV.Point[];

  constructor(id: number, corners: CV.Point[]) {
    this.id = id;
    this.corners = corners;
  }
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
  /**
   * When the global Otsu threshold of a candidate gives no valid code, read the bits again
   * relative to the black level of the nearby border cells. This recovers markers under
   * reflections or uneven lighting. Off by default so results match the original js-aruco.
   */
  compensateShading?: boolean;
}

export const defaultDetectorOptions: Readonly<Required<DetectorOptions>> = Object.freeze({
  adaptiveThresholdKernelSize: 2,
  adaptiveThresholdConstant: 7,
  minContourLengthRatio: 0.2,
  polygonEpsilonRatio: 0.05,
  minEdgeLength: 10,
  minCornerDistance: 10,
  warpSize: 49,
  compensateShading: false,
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
  readonly grey: CV.Image = new CV.Image();
  readonly thres: CV.Image = new CV.Image();
  readonly homography: CV.Image = new CV.Image();
  /** Greyscale rectified candidate, before thresholding. */
  readonly warped: CV.Image = new CV.Image();
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

        if (poly.length === 4 && CV.isContourConvex(poly)) {
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
      CV.warp(imageSrc, this.warped, candidate, warpSize);
      CV.threshold(this.warped, this.homography, CV.otsu(this.warped));

      let marker = this.getMarker(this.homography, candidate);
      if (!marker && this.options.compensateShading) {
        const bits = readBitsCompensated(this.warped);
        marker = bits ? this.markerFromBits(bits, candidate) : null;
      }
      if (marker) {
        markers.push(marker);
      }
    }

    return markers;
  }

  /** Finds the rotation of `bits` that forms a valid code; null if there is none. */
  markerFromBits(bits: Bits, candidate: readonly CV.Point[]): Marker | null {
    let rotated = bits;
    for (let i = 0; i < 4; ++i) {
      if (this.hammingDistance(rotated) === 0) {
        return new Marker(this.mat2id(rotated), this.rotate2(candidate, 4 - i));
      }
      rotated = this.rotate(rotated);
    }
    return null;
  }

  getMarker(imageSrc: CV.Image, candidate: readonly CV.Point[]): Marker | null {
    const width = (imageSrc.width / 7) >>> 0;
    const minZero = (width * width) >> 1;
    const bits: Bits = [];
    const rotations: Bits[] = [];
    const distances: number[] = [];

    // The outer ring of cells must be black.
    for (let i = 0; i < 7; ++i) {
      const inc = i === 0 || i === 6 ? 1 : 6;

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

    if (bestDistance !== 0) {
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
      let minSum = Number.POSITIVE_INFINITY;

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

/** Minimum grey level difference between the black and the white cells of a marker. */
const MIN_CELL_CONTRAST = 24;

/**
 * Reads the 5x5 code bits of a rectified greyscale marker (7x7 cells including the black border)
 * relative to the local black level: each inner cell is compared with the border cells weighted
 * by inverse squared distance, so a reflection that brightens one side of the marker shifts black
 * and white cells there alike. Returns null if the border is not uniformly dark or the contrast is
 * too low.
 */
export function readBitsCompensated(warped: CV.Image): Bits | null {
  const cell = (warped.width / 7) >>> 0;
  const inset = cell >= 5 ? 1 : 0;
  const means = new Float64Array(49);
  for (let i = 0; i < 7; ++i) {
    for (let j = 0; j < 7; ++j) {
      let sum = 0;
      let n = 0;
      for (let y = i * cell + inset; y < (i + 1) * cell - inset; ++y) {
        for (let x = j * cell + inset; x < (j + 1) * cell - inset; ++x) {
          sum += warped.data[y * warped.width + x];
          ++n;
        }
      }
      means[i * 7 + j] = sum / n;
    }
  }

  const border: number[] = [];
  for (let k = 0; k < 49; ++k) {
    const i = (k / 7) | 0;
    const j = k % 7;
    if (i === 0 || i === 6 || j === 0 || j === 6) {
      border.push(k);
    }
  }

  /** Black level at cell k, interpolated from the border cells other than k. */
  const blackAt = (k: number): number => {
    const i = (k / 7) | 0;
    const j = k % 7;
    let wsum = 0;
    let vsum = 0;
    for (const b of border) {
      if (b === k) continue;
      const di = ((b / 7) | 0) - i;
      const dj = (b % 7) - j;
      const w = 1 / (di * di + dj * dj);
      wsum += w;
      vsum += w * means[b];
    }
    return vsum / wsum;
  };

  const inner: number[] = [];
  for (let i = 1; i < 6; ++i) {
    for (let j = 1; j < 6; ++j) {
      const k = i * 7 + j;
      inner.push(means[k] - blackAt(k));
    }
  }

  // Split the residuals into black and white with the largest between-class variance.
  const sorted = [...inner].sort((a, b) => a - b);
  let bestSplit = Number.NaN;
  let bestScore = -1;
  let contrast = 0;
  let below = 0;
  const total = sorted.reduce((a, b) => a + b, 0);
  for (let s = 1; s < sorted.length; ++s) {
    below += sorted[s - 1];
    const m0 = below / s;
    const m1 = (total - below) / (sorted.length - s);
    const score = s * (sorted.length - s) * (m1 - m0) ** 2;
    if (score > bestScore) {
      bestScore = score;
      bestSplit = (sorted[s - 1] + sorted[s]) / 2;
      contrast = m1 - m0;
    }
  }
  if (!(contrast >= MIN_CELL_CONTRAST)) {
    return null;
  }

  // The border must look black against its own neighbours.
  for (const b of border) {
    if (means[b] - blackAt(b) > contrast / 2) {
      return null;
    }
  }

  const bits: Bits = [];
  for (let i = 0; i < 5; ++i) {
    bits.push(inner.slice(i * 5, i * 5 + 5).map((r) => (r > bestSplit ? 1 : 0)));
  }
  return bits;
}
