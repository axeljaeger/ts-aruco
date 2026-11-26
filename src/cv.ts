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
- "OpenCV: Open Computer Vision Library"
  http://sourceforge.net/projects/opencvlibrary/
- "Stack Blur: Fast But Goodlooking"
  http://incubator.quasimondo.com/processing/fast_blur_deluxe.php
*/

/** Any RGBA image with 4 bytes per pixel, e.g. `ImageData`. */
export interface RgbaImageLike {
  readonly width: number;
  readonly height: number;
  readonly data: ArrayLike<number>;
}

export interface Point {
  x: number;
  y: number;
}

/** A closed polygon or pixel contour. */
export type Contour = Point[];

/** Contour produced by {@link findContours}; `hole` marks inner borders. */
export interface TracedContour extends Array<Point> {
  hole: boolean;
}

export interface Square {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Single channel 8 bit image. The buffer grows on demand and is reused between frames. */
export class Image {
  width: number;
  height: number;
  data: Uint8Array;

  constructor(width = 0, height = 0, data?: Uint8Array) {
    this.width = width;
    this.height = height;
    this.data = data ?? new Uint8Array(width * height);
  }

  /** Resizes the image, reallocating only when the buffer is too small. */
  resize(width: number, height: number): this {
    const size = width * height;
    if (this.data.length < size) {
      this.data = new Uint8Array(size);
    }
    this.width = width;
    this.height = height;
    return this;
  }
}

/** Single channel float image, used for intermediate filter results. */
export class FloatImage {
  width: number;
  height: number;
  data: Float32Array;

  constructor(width = 0, height = 0) {
    this.width = width;
    this.height = height;
    this.data = new Float32Array(width * height);
  }

  resize(width: number, height: number): this {
    const size = width * height;
    if (this.data.length < size) {
      this.data = new Float32Array(size);
    }
    this.width = width;
    this.height = height;
    return this;
  }
}

/** RGBA to luma (BT.601), rounded like the original js-aruco. */
export function grayscale(imageSrc: RgbaImageLike, imageDst: Image): Image {
  imageDst.resize(imageSrc.width, imageSrc.height);

  const src = imageSrc.data;
  const dst = imageDst.data;
  const len = imageSrc.width * imageSrc.height * 4;

  for (let i = 0, j = 0; i < len; i += 4) {
    dst[j++] = (src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114 + 0.5) & 0xff;
  }

  return imageDst;
}

/** Binary threshold: pixels `<= threshold` become 0, all others 255. */
export function threshold(imageSrc: Image, imageDst: Image, threshold: number): Image {
  imageDst.resize(imageSrc.width, imageSrc.height);

  const src = imageSrc.data;
  const dst = imageDst.data;
  const len = imageSrc.width * imageSrc.height;
  const tab = thresholdTable(threshold);

  for (let i = 0; i < len; ++i) {
    dst[i] = tab[src[i]];
  }

  return imageDst;
}

const thresholdTables = new Map<number, Uint8Array>();

function thresholdTable(threshold: number): Uint8Array {
  let tab = thresholdTables.get(threshold);
  if (!tab) {
    tab = new Uint8Array(256);
    for (let i = 0; i < 256; ++i) {
      tab[i] = i <= threshold ? 0 : 255;
    }
    thresholdTables.set(threshold, tab);
  }
  return tab;
}

const adaptiveTables = new Map<number, Uint8Array>();

function adaptiveTable(threshold: number): Uint8Array {
  let tab = adaptiveTables.get(threshold);
  if (!tab) {
    tab = new Uint8Array(768);
    for (let i = 0; i < 768; ++i) {
      tab[i] = i - 255 <= -threshold ? 255 : 0;
    }
    adaptiveTables.set(threshold, tab);
  }
  return tab;
}

/**
 * Adaptive mean threshold: a pixel becomes 255 when it is at least `threshold` darker
 * than its stack-blurred neighbourhood, 0 otherwise.
 */
export function adaptiveThreshold(
  imageSrc: Image,
  imageDst: Image,
  kernelSize: number,
  threshold: number,
): Image {
  imageDst.resize(imageSrc.width, imageSrc.height);

  const src = imageSrc.data;
  const dst = imageDst.data;
  const len = imageSrc.width * imageSrc.height;
  const tab = adaptiveTable(threshold);

  stackBoxBlur(imageSrc, imageDst, kernelSize);

  for (let i = 0; i < len; ++i) {
    dst[i] = tab[src[i] - dst[i] + 255];
  }

  return imageDst;
}

/** Otsu's method; returns the threshold that maximises between-class variance. */
export function otsu(imageSrc: Image): number {
  const src = imageSrc.data;
  const len = imageSrc.width * imageSrc.height;
  const hist = new Int32Array(256);
  let threshold = 0;
  let sum = 0;
  let sumB = 0;
  let wB = 0;
  let wF = 0;
  let max = 0;

  for (let i = 0; i < len; ++i) {
    hist[src[i]]++;
  }

  for (let i = 0; i < 256; ++i) {
    sum += hist[i] * i;
  }

  for (let i = 0; i < 256; ++i) {
    wB += hist[i];
    if (wB !== 0) {
      wF = len - wB;
      if (wF === 0) {
        break;
      }

      sumB += hist[i] * i;

      const mu = sumB / wB - (sum - sumB) / wF;
      const between = wB * wF * mu * mu;

      if (between > max) {
        max = between;
        threshold = i;
      }
    }
  }

  return threshold;
}

export const stackBoxBlurMult: readonly number[] = [
  1, 171, 205, 293, 57, 373, 79, 137, 241, 27, 391, 357, 41, 19, 283, 265,
];

export const stackBoxBlurShift: readonly number[] = [
  0, 9, 10, 11, 9, 12, 10, 11, 12, 9, 13, 13, 10, 9, 13, 13,
];

/**
 * Separable box blur with radius `kernelSize`, using a ring buffer ("stack") per line.
 * Edge pixels are clamped. Integer arithmetic: result = (sum * mult) >>> shift.
 */
export function stackBoxBlur(imageSrc: Image, imageDst: Image, kernelSize: number): Image {
  const width = imageSrc.width;
  const height = imageSrc.height;
  imageDst.resize(width, height);

  const src = imageSrc.data;
  const dst = imageDst.data;
  const heightMinus1 = height - 1;
  const widthMinus1 = width - 1;
  const size = kernelSize + kernelSize + 1;
  const radius = kernelSize + 1;
  const mult = stackBoxBlurMult[kernelSize];
  const shift = stackBoxBlurShift[kernelSize];
  const stack = new Int32Array(size);
  let sp: number;
  let color: number;
  let sum: number;
  let pos = 0;
  let start: number;
  let p: number;

  for (let y = 0; y < height; ++y) {
    start = pos;

    color = src[pos];
    sum = radius * color;

    sp = 0;
    for (let i = 0; i < radius; ++i) {
      stack[sp] = color;
      sp = sp + 1 === size ? 0 : sp + 1;
    }
    for (let i = 1; i < radius; ++i) {
      stack[sp] = src[pos + i];
      sum += stack[sp];
      sp = sp + 1 === size ? 0 : sp + 1;
    }

    sp = 0;
    for (let x = 0; x < width; ++x) {
      dst[pos++] = (sum * mult) >>> shift;

      p = x + radius;
      p = start + (p < widthMinus1 ? p : widthMinus1);
      sum -= stack[sp] - src[p];

      stack[sp] = src[p];
      sp = sp + 1 === size ? 0 : sp + 1;
    }
  }

  for (let x = 0; x < width; ++x) {
    pos = x;
    start = pos + width;

    color = dst[pos];
    sum = radius * color;

    sp = 0;
    for (let i = 0; i < radius; ++i) {
      stack[sp] = color;
      sp = sp + 1 === size ? 0 : sp + 1;
    }
    for (let i = 1; i < radius; ++i) {
      stack[sp] = dst[start];
      sum += stack[sp];
      sp = sp + 1 === size ? 0 : sp + 1;

      start += width;
    }

    sp = 0;
    for (let y = 0; y < height; ++y) {
      dst[pos] = (sum * mult) >>> shift;

      p = y + radius;
      p = x + (p < heightMinus1 ? p : heightMinus1) * width;
      sum -= stack[sp] - dst[p];

      stack[sp] = dst[p];
      sp = sp + 1 === size ? 0 : sp + 1;

      pos += width;
    }
  }

  return imageDst;
}

/** Separable gaussian blur. `imageMean` holds the horizontal pass. */
export function gaussianBlur(
  imageSrc: Image,
  imageDst: Image,
  imageMean: FloatImage,
  kernelSize: number,
): Image {
  const kernel = gaussianKernel(kernelSize);

  imageDst.resize(imageSrc.width, imageSrc.height);
  imageMean.resize(imageSrc.width, imageSrc.height);

  gaussianBlurFilter(imageSrc, imageMean, kernel, true);
  gaussianBlurFilter(imageMean, imageDst, kernel, false);

  return imageDst;
}

export function gaussianBlurFilter(
  imageSrc: Image | FloatImage,
  imageDst: Image | FloatImage,
  kernel: ArrayLike<number>,
  horizontal: boolean,
): Image | FloatImage {
  const src = imageSrc.data;
  const dst = imageDst.data;
  const height = imageSrc.height;
  const width = imageSrc.width;
  const limit = kernel.length >> 1;
  let pos = 0;
  let cur: number;
  let value: number;

  for (let i = 0; i < height; ++i) {
    for (let j = 0; j < width; ++j) {
      value = 0.0;

      for (let k = -limit; k <= limit; ++k) {
        if (horizontal) {
          cur = pos + k;
          if (j + k < 0 || j + k >= width) {
            cur = pos;
          }
        } else {
          cur = pos + k * width;
          if (i + k < 0 || i + k >= height) {
            cur = pos;
          }
        }

        value += kernel[limit + k] * src[cur];
      }

      dst[pos++] = horizontal ? value : (value + 0.5) & 0xff;
    }
  }

  return imageDst;
}

export function gaussianKernel(kernelSize: number): number[] {
  const tab = [
    [1],
    [0.25, 0.5, 0.25],
    [0.0625, 0.25, 0.375, 0.25, 0.0625],
    [0.03125, 0.109375, 0.21875, 0.28125, 0.21875, 0.109375, 0.03125],
  ];

  if (kernelSize <= 7 && kernelSize % 2 === 1) {
    return tab[kernelSize >> 1].slice();
  }

  const kernel: number[] = [];
  const center = (kernelSize - 1.0) * 0.5;
  const sigma = 0.8 + 0.3 * (center - 1.0);
  const scale2X = -0.5 / (sigma * sigma);
  let sum = 0.0;

  for (let i = 0; i < kernelSize; ++i) {
    const x = i - center;
    kernel[i] = Math.exp(scale2X * x * x);
    sum += kernel[i];
  }
  sum = 1 / sum;
  for (let i = 0; i < kernelSize; ++i) {
    kernel[i] *= sum;
  }

  return kernel;
}

/** Scratch buffer for {@link findContours}; reuse it between frames to avoid allocations. */
export class ContourBuffer {
  data: Int32Array = new Int32Array(0);

  ensure(size: number): Int32Array {
    if (this.data.length < size) {
      this.data = new Int32Array(size);
    }
    return this.data;
  }
}

/**
 * Suzuki-Abe border following on a binary image (non zero = foreground).
 * Returns outer borders and holes.
 */
export function findContours(
  imageSrc: Image,
  buffer: ContourBuffer = new ContourBuffer(),
): TracedContour[] {
  const width = imageSrc.width;
  const height = imageSrc.height;
  const contours: TracedContour[] = [];
  const src = binaryBorder(imageSrc, buffer.ensure((width + 2) * (height + 2)));
  const deltas = neighborhoodDeltas(width + 2);
  let pos = width + 3;
  let nbd = 1;

  for (let i = 0; i < height; ++i, pos += 2) {
    for (let j = 0; j < width; ++j, ++pos) {
      const pix = src[pos];

      if (pix !== 0) {
        let outer = false;
        let hole = false;

        if (pix === 1 && src[pos - 1] === 0) {
          outer = true;
        } else if (pix >= 1 && src[pos + 1] === 0) {
          hole = true;
        }

        if (outer || hole) {
          ++nbd;

          contours.push(borderFollowing(src, pos, nbd, { x: j, y: i }, hole, deltas));
        }
      }
    }
  }

  return contours;
}

export function borderFollowing(
  src: Int32Array,
  pos: number,
  nbd: number,
  point: Point,
  hole: boolean,
  deltas: readonly number[],
): TracedContour {
  const contour = [] as unknown as TracedContour;
  let pos1 = 0;
  let pos3: number;
  let pos4: number;
  let s: number;
  let sEnd: number;

  contour.hole = hole;

  s = sEnd = hole ? 0 : 4;
  do {
    s = (s - 1) & 7;
    pos1 = pos + deltas[s];
    if (src[pos1] !== 0) {
      break;
    }
  } while (s !== sEnd);

  if (s === sEnd) {
    src[pos] = -nbd;
    contour.push({ x: point.x, y: point.y });
  } else {
    pos3 = pos;

    while (true) {
      sEnd = s;

      do {
        pos4 = pos3 + deltas[++s];
      } while (src[pos4] === 0);

      s &= 7;

      if ((s - 1) >>> 0 < sEnd >>> 0) {
        src[pos3] = -nbd;
      } else if (src[pos3] === 1) {
        src[pos3] = nbd;
      }

      contour.push({ x: point.x, y: point.y });

      point.x += neighborhood[s][0];
      point.y += neighborhood[s][1];

      if (pos4 === pos && pos3 === pos1) {
        break;
      }

      pos3 = pos4;
      s = (s + 4) & 7;
    }
  }

  return contour;
}

export const neighborhood: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/** Offsets of the 8 neighbours in a row-major buffer, repeated twice for wrap-free indexing. */
export function neighborhoodDeltas(width: number): number[] {
  const deltas = neighborhood.map(([dx, dy]) => dx + dy * width);
  return deltas.concat(deltas);
}

interface Slice {
  startIndex: number;
  endIndex: number;
}

/** Douglas-Peucker polygon approximation of a closed contour (OpenCV port). */
export function approxPolyDP(contour: readonly Point[], epsilon: number): Contour {
  let slice: Slice = { startIndex: 0, endIndex: 0 };
  const rightSlice: Slice = { startIndex: 0, endIndex: 0 };
  const poly: Contour = [];
  const stack: Slice[] = [];
  const len = contour.length;
  let pt: Point;
  let startPt: Point = contour[0];
  let endPt: Point;
  let dist: number;
  let maxDist = 0;
  let leEps: boolean;
  let dx: number;
  let dy: number;
  let k = 0;

  const epsilonSq = epsilon * epsilon;

  for (let i = 0; i < 3; ++i) {
    maxDist = 0;

    k = (k + rightSlice.startIndex) % len;
    startPt = contour[k];
    if (++k === len) {
      k = 0;
    }

    for (let j = 1; j < len; ++j) {
      pt = contour[k];
      if (++k === len) {
        k = 0;
      }

      dx = pt.x - startPt.x;
      dy = pt.y - startPt.y;
      dist = dx * dx + dy * dy;

      if (dist > maxDist) {
        maxDist = dist;
        rightSlice.startIndex = j;
      }
    }
  }

  if (maxDist <= epsilonSq) {
    poly.push({ x: startPt.x, y: startPt.y });
  } else {
    slice.startIndex = k;
    slice.endIndex = rightSlice.startIndex += slice.startIndex;

    rightSlice.startIndex -= rightSlice.startIndex >= len ? len : 0;
    rightSlice.endIndex = slice.startIndex;
    if (rightSlice.endIndex < rightSlice.startIndex) {
      rightSlice.endIndex += len;
    }

    stack.push({ startIndex: rightSlice.startIndex, endIndex: rightSlice.endIndex });
    stack.push({ startIndex: slice.startIndex, endIndex: slice.endIndex });
  }

  while (stack.length !== 0) {
    slice = stack.pop() as Slice;

    endPt = contour[slice.endIndex % len];
    startPt = contour[(k = slice.startIndex % len)];
    if (++k === len) {
      k = 0;
    }

    if (slice.endIndex <= slice.startIndex + 1) {
      leEps = true;
    } else {
      maxDist = 0;

      dx = endPt.x - startPt.x;
      dy = endPt.y - startPt.y;

      for (let i = slice.startIndex + 1; i < slice.endIndex; ++i) {
        pt = contour[k];
        if (++k === len) {
          k = 0;
        }

        dist = Math.abs((pt.y - startPt.y) * dx - (pt.x - startPt.x) * dy);

        if (dist > maxDist) {
          maxDist = dist;
          rightSlice.startIndex = i;
        }
      }

      leEps = maxDist * maxDist <= epsilonSq * (dx * dx + dy * dy);
    }

    if (leEps) {
      poly.push({ x: startPt.x, y: startPt.y });
    } else {
      rightSlice.endIndex = slice.endIndex;
      slice.endIndex = rightSlice.startIndex;

      stack.push({ startIndex: rightSlice.startIndex, endIndex: rightSlice.endIndex });
      stack.push({ startIndex: slice.startIndex, endIndex: slice.endIndex });
    }
  }

  return poly;
}

/** Samples the quad `contour` of `imageSrc` into a `warpSize` x `warpSize` image (bilinear). */
export function warp(
  imageSrc: Image,
  imageDst: Image,
  contour: readonly Point[],
  warpSize: number,
): Image {
  imageDst.resize(warpSize, warpSize);

  const src = imageSrc.data;
  const dst = imageDst.data;
  const width = imageSrc.width;
  const height = imageSrc.height;
  const m = getPerspectiveTransform(contour, warpSize - 1);
  let pos = 0;
  let r = m[8];
  let s = m[2];
  let t = m[5];

  for (let i = 0; i < warpSize; ++i) {
    r += m[7];
    s += m[1];
    t += m[4];

    let u = r;
    let v = s;
    let w = t;

    for (let j = 0; j < warpSize; ++j) {
      u += m[6];
      v += m[0];
      w += m[3];

      const x = v / u;
      const y = w / u;

      const sx1 = x >>> 0;
      const sx2 = sx1 === width - 1 ? sx1 : sx1 + 1;
      const dx1 = x - sx1;
      const dx2 = 1.0 - dx1;

      const sy1 = y >>> 0;
      const sy2 = sy1 === height - 1 ? sy1 : sy1 + 1;
      const dy1 = y - sy1;
      const dy2 = 1.0 - dy1;

      const p1 = sy1 * width;
      const p3 = sy2 * width;

      dst[pos++] =
        (dy2 * (dx2 * src[p1 + sx1] + dx1 * src[p1 + sx2]) +
          dy1 * (dx2 * src[p3 + sx1] + dx1 * src[p3 + sx2])) &
        0xff;
    }
  }

  return imageDst;
}

/** 3x3 row-major matrix mapping the unit square scaled by `size` onto the quad `src`. */
export function getPerspectiveTransform(src: readonly Point[], size: number): number[] {
  const rq = square2quad(src);

  rq[0] /= size;
  rq[1] /= size;
  rq[3] /= size;
  rq[4] /= size;
  rq[6] /= size;
  rq[7] /= size;

  return rq;
}

export function square2quad(src: readonly Point[]): number[] {
  const sq = new Array<number>(9);
  const px = src[0].x - src[1].x + src[2].x - src[3].x;
  const py = src[0].y - src[1].y + src[2].y - src[3].y;

  if (px === 0 && py === 0) {
    sq[0] = src[1].x - src[0].x;
    sq[1] = src[2].x - src[1].x;
    sq[2] = src[0].x;
    sq[3] = src[1].y - src[0].y;
    sq[4] = src[2].y - src[1].y;
    sq[5] = src[0].y;
    sq[6] = 0;
    sq[7] = 0;
    sq[8] = 1;
  } else {
    const dx1 = src[1].x - src[2].x;
    const dx2 = src[3].x - src[2].x;
    const dy1 = src[1].y - src[2].y;
    const dy2 = src[3].y - src[2].y;
    const den = dx1 * dy2 - dx2 * dy1;

    sq[6] = (px * dy2 - dx2 * py) / den;
    sq[7] = (dx1 * py - px * dy1) / den;
    sq[8] = 1;
    sq[0] = src[1].x - src[0].x + sq[6] * src[1].x;
    sq[1] = src[3].x - src[0].x + sq[7] * src[3].x;
    sq[2] = src[0].x;
    sq[3] = src[1].y - src[0].y + sq[6] * src[1].y;
    sq[4] = src[3].y - src[0].y + sq[7] * src[3].y;
    sq[5] = src[0].y;
  }

  return sq;
}

export function isContourConvex(contour: readonly Point[]): boolean {
  const len = contour.length;
  let orientation = 0;
  let prevPt = contour[len - 1];
  let curPt = contour[0];
  let dx0 = curPt.x - prevPt.x;
  let dy0 = curPt.y - prevPt.y;

  for (let i = 0, j = 0; i < len; ++i) {
    if (++j === len) {
      j = 0;
    }

    prevPt = curPt;
    curPt = contour[j];

    const dx = curPt.x - prevPt.x;
    const dy = curPt.y - prevPt.y;
    const dxdy0 = dx * dy0;
    const dydx0 = dy * dx0;

    orientation |= dydx0 > dxdy0 ? 1 : dydx0 < dxdy0 ? 2 : 3;

    if (orientation === 3) {
      return false;
    }

    dx0 = dx;
    dy0 = dy;
  }

  return true;
}

export function perimeter(poly: readonly Point[]): number {
  const len = poly.length;
  let p = 0.0;

  for (let i = 0, j = len - 1; i < len; j = i++) {
    const dx = poly[i].x - poly[j].x;
    const dy = poly[i].y - poly[j].y;

    p += Math.sqrt(dx * dx + dy * dy);
  }

  return p;
}

export function minEdgeLength(poly: readonly Point[]): number {
  const len = poly.length;
  let min = Number.POSITIVE_INFINITY;

  for (let i = 0, j = len - 1; i < len; j = i++) {
    const dx = poly[i].x - poly[j].x;
    const dy = poly[i].y - poly[j].y;
    const d = dx * dx + dy * dy;

    if (d < min) {
      min = d;
    }
  }

  return Math.sqrt(min);
}

export function countNonZero(imageSrc: Image, square: Square): number {
  const src = imageSrc.data;
  const height = square.height;
  const width = square.width;
  const span = imageSrc.width - width;
  let pos = square.x + square.y * imageSrc.width;
  let nz = 0;

  for (let i = 0; i < height; ++i) {
    for (let j = 0; j < width; ++j) {
      if (src[pos++] !== 0) {
        ++nz;
      }
    }

    pos += span;
  }

  return nz;
}

/** Copies a binary version (0/1) of `imageSrc` into `dst` with a 1 pixel zero border. */
export function binaryBorder(imageSrc: Image, dst: Int32Array): Int32Array {
  const src = imageSrc.data;
  const height = imageSrc.height;
  const width = imageSrc.width;
  let posSrc = 0;
  let posDst = 0;

  for (let j = -2; j < width; ++j) {
    dst[posDst++] = 0;
  }

  for (let i = 0; i < height; ++i) {
    dst[posDst++] = 0;

    for (let j = 0; j < width; ++j) {
      dst[posDst++] = src[posSrc++] === 0 ? 0 : 1;
    }

    dst[posDst++] = 0;
  }

  for (let j = -2; j < width; ++j) {
    dst[posDst++] = 0;
  }

  return dst;
}
