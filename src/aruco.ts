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

import { CVContour, CVImage, CVPoint, adaptiveThreshold, approxPolyDP, countNonZero, findContours, grayscale, isContourConvex, minEdgeLength, otsu, perimeter, threshold, warp } from './cv';

export class Marker {
  constructor(public id: number, public corners: any) { }
}

export class Detector {

  homography: any;
  binary: any[];
  contours: CVContour[];
  polys: CVContour[];
  candidates: any[];
  constructor() {
    this.grey = new CVImage();
    this.thres = new CVImage();
    this.homography = new CVImage();
    this.binary = [];
    this.contours = [];
    this.polys = [];
    this.candidates = [];
  };

  grey: CVImage
  thres: CVImage;

  detect(image: CVImage) {
    grayscale(image, this.grey);
    adaptiveThreshold(this.grey, this.thres, 2, 7);

    this.contours = findContours(this.thres, this.binary);

    this.candidates = this.findCandidates(this.contours, image.width * 0.20, 0.05, 10);
    this.candidates = this.clockwiseCorners(this.candidates);
    this.candidates = this.notTooNear(this.candidates, 10);

    return this.findMarkers(this.grey, this.candidates, 49);
  }

  findCandidates(contours: CVContour[], minSize: number, epsilon: number, minLength: number) {
    let candidates: any[] = [], len = contours.length, contour, poly;

    this.polys = [];

    for (let i = 0; i < len; ++i) {
      contour = contours[i];

      if (contour.points.length >= minSize) {
        poly = approxPolyDP(contour.points, contour.points.length * epsilon);

        this.polys.push({ points: poly, hole: false });

        if ((4 === poly.length) && (isContourConvex(poly))) {

          if (minEdgeLength(poly) >= minLength) {
            candidates.push(poly);
          }
        }
      }
    }

    return candidates;
  };

  clockwiseCorners(candidates: any[][]) {
    var len = candidates.length, dx1, dx2, dy1, dy2, swap, i;

    for (i = 0; i < len; ++i) {
      dx1 = candidates[i][1].x - candidates[i][0].x;
      dy1 = candidates[i][1].y - candidates[i][0].y;
      dx2 = candidates[i][2].x - candidates[i][0].x;
      dy2 = candidates[i][2].y - candidates[i][0].y;

      if ((dx1 * dy2 - dy1 * dx2) < 0) {
        swap = candidates[i][1];
        candidates[i][1] = candidates[i][3];
        candidates[i][3] = swap;
      }
    }

    return candidates;
  };

  notTooNear(candidates: any, minDist: number) {
    var notTooNear: any[] = [], len = candidates.length, dist, dx, dy, i, j, k;

    for (i = 0; i < len; ++i) {

      for (j = i + 1; j < len; ++j) {
        dist = 0;

        for (k = 0; k < 4; ++k) {
          dx = candidates[i][k].x - candidates[j][k].x;
          dy = candidates[i][k].y - candidates[j][k].y;

          dist += dx * dx + dy * dy;
        }

        if ((dist / 4) < (minDist * minDist)) {

          if (perimeter(candidates[i]) < perimeter(candidates[j])) {
            candidates[i].tooNear = true;
          } else {
            candidates[j].tooNear = true;
          }
        }
      }
    }

    for (i = 0; i < len; ++i) {
      if (!candidates[i].tooNear) {
        notTooNear.push(candidates[i]);
      }
    }

    return notTooNear;
  };

  findMarkers(imageSrc: CVImage, candidates: any, warpSize: number) {
    let markers: any[] = [], len = candidates.length, candidate, marker, i;

    for (i = 0; i < len; ++i) {
      candidate = candidates[i];

      warp(imageSrc, this.homography, candidate, warpSize);

      threshold(this.homography, this.homography, otsu(this.homography));

      marker = this.getMarker(this.homography, candidate);
      if (marker) {
        markers.push(marker);
      }
    }

    return markers;
  }

  getMarker(imageSrc: CVImage, candidate: any) {
    var width = (imageSrc.width / 7) >>> 0,
      minZero = (width * width) >> 1,
      bits: any[] = [], rotations: any[] = [], distances: any[] = [],
      square, pair, inc, i, j;

    for (i = 0; i < 7; ++i) {
      inc = (0 === i || 6 === i) ? 1 : 6;

      for (j = 0; j < 7; j += inc) {
        square = { x: j * width, y: i * width, width: width, height: width };
        if (countNonZero(imageSrc, square) > minZero) {
          return null;
        }
      }
    }

    for (i = 0; i < 5; ++i) {
      bits[i] = [];

      for (j = 0; j < 5; ++j) {
        square = { x: (j + 1) * width, y: (i + 1) * width, width: width, height: width };

        bits[i][j] = countNonZero(imageSrc, square) > minZero ? 1 : 0;
      }
    }

    rotations[0] = bits;
    distances[0] = this.hammingDistance(rotations[0]);

    pair = { first: distances[0], second: 0 };

    for (i = 1; i < 4; ++i) {
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
      this.rotate2(candidate, 4 - pair.second));
  };

  hammingDistance(bits: number[][]) {
    var ids = [[1, 0, 0, 0, 0], [1, 0, 1, 1, 1], [0, 1, 0, 0, 1], [0, 1, 1, 1, 0]],
      dist = 0, sum, minSum, i, j, k;

    for (i = 0; i < 5; ++i) {
      minSum = Infinity;

      for (j = 0; j < 4; ++j) {
        sum = 0;

        for (k = 0; k < 5; ++k) {
          sum += bits[i][k] === ids[j][k] ? 0 : 1;
        }

        if (sum < minSum) {
          minSum = sum;
        }
      }

      dist += minSum;
    }

    return dist;
  };

  mat2id(bits: number[][]): number {
    var id = 0, i;

    for (i = 0; i < 5; ++i) {
      id <<= 1;
      id |= bits[i][1];
      id <<= 1;
      id |= bits[i][3];
    }

    return id;
  }

  rotate(src: any[]) {
    var dst: any = [], len = src.length, i, j;

    for (i = 0; i < len; ++i) {
      dst[i] = [];
      for (j = 0; j < src[i].length; ++j) {
        dst[i][j] = src[src[i].length - j - 1][i];
      }
    }

    return dst;
  }

  rotate2 = function (src: number[], rotation: number) {
    var dst: any[] = [], len = src.length, i;

    for (i = 0; i < len; ++i) {
      dst[i] = src[(rotation + i) % len];
    }
    return dst;
  };


}