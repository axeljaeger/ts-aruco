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

type Bits = number[][];

interface DistanceRotation {
  first: number;
  second: number;
}

export class Marker {
  constructor(
    public id: number,
    public corners: CV.Contour,
  ) {}
}

export class Detector {
  grey = new CV.Image();
  thres = new CV.Image();
  homography = new CV.Image();
  binary: number[] = [];
  contours: CV.Contour[] = [];
  polys: CV.Contour[] = [];
  candidates: CV.Contour[] = [];

  detect(image: ImageData): Marker[] {
    CV.grayscale(image, this.grey);
    CV.adaptiveThreshold(this.grey, this.thres, 2, 7);

    this.contours = CV.findContours(this.thres, this.binary);

    this.candidates = this.findCandidates(this.contours, image.width * 0.2, 0.05, 10);
    this.candidates = this.clockwiseCorners(this.candidates);
    this.candidates = this.notTooNear(this.candidates, 10);

    return this.findMarkers(this.grey, this.candidates, 49);
  }

  findCandidates(
    contours: CV.Contour[],
    minSize: number,
    epsilon: number,
    minLength: number,
  ): CV.Contour[] {
    const candidates: CV.Contour[] = [];
    const len = contours.length;
    let contour: CV.Contour;
    let poly: CV.Contour;

    this.polys = [];

    for (let i = 0; i < len; ++i) {
      contour = contours[i];

      if (contour.length >= minSize) {
        poly = CV.approxPolyDP(contour, contour.length * epsilon);

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

  clockwiseCorners(candidates: CV.Contour[]): CV.Contour[] {
    const len = candidates.length;
    let dx1: number;
    let dx2: number;
    let dy1: number;
    let dy2: number;
    let swap: CV.Point;

    for (let i = 0; i < len; ++i) {
      dx1 = candidates[i][1].x - candidates[i][0].x;
      dy1 = candidates[i][1].y - candidates[i][0].y;
      dx2 = candidates[i][2].x - candidates[i][0].x;
      dy2 = candidates[i][2].y - candidates[i][0].y;

      if (dx1 * dy2 - dy1 * dx2 < 0) {
        swap = candidates[i][1];
        candidates[i][1] = candidates[i][3];
        candidates[i][3] = swap;
      }
    }

    return candidates;
  }

  notTooNear(candidates: CV.Contour[], minDist: number): CV.Contour[] {
    const notTooNear: CV.Contour[] = [];
    const len = candidates.length;
    let dist: number;
    let dx: number;
    let dy: number;

    for (let i = 0; i < len; ++i) {
      for (let j = i + 1; j < len; ++j) {
        dist = 0;

        for (let k = 0; k < 4; ++k) {
          dx = candidates[i][k].x - candidates[j][k].x;
          dy = candidates[i][k].y - candidates[j][k].y;

          dist += dx * dx + dy * dy;
        }

        if (dist / 4 < minDist * minDist) {
          if (CV.perimeter(candidates[i]) < CV.perimeter(candidates[j])) {
            candidates[i].tooNear = true;
          } else {
            candidates[j].tooNear = true;
          }
        }
      }
    }

    for (let i = 0; i < len; ++i) {
      if (!candidates[i].tooNear) {
        notTooNear.push(candidates[i]);
      }
    }

    return notTooNear;
  }

  findMarkers(imageSrc: CV.Image, candidates: CV.Contour[], warpSize: number): Marker[] {
    const markers: Marker[] = [];
    const len = candidates.length;
    let candidate: CV.Contour;
    let marker: Marker | null;

    for (let i = 0; i < len; ++i) {
      candidate = candidates[i];

      CV.warp(imageSrc, this.homography, candidate, warpSize);

      CV.threshold(this.homography, this.homography, CV.otsu(this.homography));

      marker = this.getMarker(this.homography, candidate);
      if (marker) {
        markers.push(marker);
      }
    }

    return markers;
  }

  getMarker(imageSrc: CV.Image, candidate: CV.Contour): Marker | null {
    const width = (imageSrc.width / 7) >>> 0;
    const minZero = (width * width) >> 1;
    const bits: Bits = [];
    const rotations: Bits[] = [];
    const distances: number[] = [];
    let square: CV.Square;
    let pair: DistanceRotation;
    let inc: number;

    for (let i = 0; i < 7; ++i) {
      inc = 0 === i || 6 === i ? 1 : 6;

      for (let j = 0; j < 7; j += inc) {
        square = { x: j * width, y: i * width, width: width, height: width };
        if (CV.countNonZero(imageSrc, square) > minZero) {
          return null;
        }
      }
    }

    for (let i = 0; i < 5; ++i) {
      bits[i] = [];

      for (let j = 0; j < 5; ++j) {
        square = { x: (j + 1) * width, y: (i + 1) * width, width: width, height: width };

        bits[i][j] = CV.countNonZero(imageSrc, square) > minZero ? 1 : 0;
      }
    }

    rotations[0] = bits;
    distances[0] = this.hammingDistance(rotations[0]);

    pair = { first: distances[0], second: 0 };

    for (let i = 1; i < 4; ++i) {
      rotations[i] = this.rotate(rotations[i - 1]);
      distances[i] = this.hammingDistance(rotations[i]);

      if (distances[i] < pair.first) {
        pair.first = distances[i];
        pair.second = i;
      }
    }

    if (0 !== pair.first) {
      return null;
    }

    return new Marker(
      this.mat2id(rotations[pair.second]),
      this.rotate2(candidate, 4 - pair.second),
    );
  }

  hammingDistance(bits: Bits): number {
    const ids = [
      [1, 0, 0, 0, 0],
      [1, 0, 1, 1, 1],
      [0, 1, 0, 0, 1],
      [0, 1, 1, 1, 0],
    ];
    let dist = 0;
    let sum: number;
    let minSum: number;

    for (let i = 0; i < 5; ++i) {
      minSum = Infinity;

      for (let j = 0; j < 4; ++j) {
        sum = 0;

        for (let k = 0; k < 5; ++k) {
          sum += bits[i][k] === ids[j][k] ? 0 : 1;
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

  rotate2(src: CV.Contour, rotation: number): CV.Contour {
    const dst: CV.Contour = [] as unknown as CV.Contour;
    const len = src.length;

    for (let i = 0; i < len; ++i) {
      dst[i] = src[(rotation + i) % len];
    }

    return dst;
  }
}
