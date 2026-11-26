/**
 * Synthetic test images: renders js-aruco markers under a known perspective pose into an RGBA
 * buffer, so tests run in Node without a canvas.
 */

export interface Point {
  x: number;
  y: number;
}

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const ROW_PATTERNS = [
  [1, 0, 0, 0, 0],
  [1, 0, 1, 1, 1],
  [0, 1, 0, 0, 1],
  [0, 1, 1, 1, 0],
];

/** 7x7 cells, 1 = white. Outer ring black, inner 5x5 from the id (10 bits, 2 per row). */
export function markerCells(id: number): number[][] {
  const cells = Array.from({ length: 7 }, () => new Array<number>(7).fill(0));
  for (let row = 0; row < 5; ++row) {
    const pattern = ROW_PATTERNS[(id >> (8 - 2 * row)) & 3];
    for (let col = 0; col < 5; ++col) {
      cells[row + 1][col + 1] = pattern[col];
    }
  }
  return cells;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Homography (3x3 row-major) mapping the unit square corners (0,0),(1,0),(1,1),(0,1) to `q`. */
export function squareToQuad(q: readonly Point[]): number[] {
  const [p0, p1, p2, p3] = q;
  const px = p0.x - p1.x + p2.x - p3.x;
  const py = p0.y - p1.y + p2.y - p3.y;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (px * dy2 - dx2 * py) / den;
  const h = (dx1 * py - px * dy1) / den;
  return [
    p1.x - p0.x + g * p1.x,
    p3.x - p0.x + h * p3.x,
    p0.x,
    p1.y - p0.y + g * p1.y,
    p3.y - p0.y + h * p3.y,
    p0.y,
    g,
    h,
    1,
  ];
}

export function invert3(m: readonly number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det,
    -(b * i - c * h) / det,
    (b * f - c * e) / det,
    B / det,
    (a * i - c * g) / det,
    -(a * f - c * d) / det,
    C / det,
    -(a * h - b * g) / det,
    (a * e - b * d) / det,
  ];
}

export interface MarkerPlacement {
  id: number;
  /** Image corners of the marker's outer black border, clockwise from top-left. */
  corners: Point[];
}

export interface RenderOptions {
  width: number;
  height: number;
  markers: MarkerPlacement[];
  /** Amplitude of uniform pixel noise (0-255). */
  noise?: number;
  seed?: number;
  /** Supersampling per axis for anti-aliased edges. */
  samples?: number;
}

/** Renders markers with a white quiet zone of one cell on a brightness gradient background. */
export function renderScene(options: RenderOptions): RgbaImage {
  const { width, height, markers, noise = 0, seed = 1, samples = 3 } = options;
  const data = new Uint8ClampedArray(width * height * 4);
  const random = rng(seed);
  const placements = markers.map((m) => {
    const h = squareToQuad(m.corners);
    return { inv: invert3(h), cells: markerCells(m.id) };
  });

  for (let y = 0; y < height; ++y) {
    for (let x = 0; x < width; ++x) {
      let acc = 0;
      for (let sy = 0; sy < samples; ++sy) {
        for (let sx = 0; sx < samples; ++sx) {
          const fx = x + (sx + 0.5) / samples;
          const fy = y + (sy + 0.5) / samples;
          let value = 90 + (100 * x) / width + (40 * y) / height;
          for (const { inv, cells } of placements) {
            const w = inv[6] * fx + inv[7] * fy + inv[8];
            const u = (inv[0] * fx + inv[1] * fy + inv[2]) / w;
            const v = (inv[3] * fx + inv[4] * fy + inv[5]) / w;
            // Marker spans [0,1]; the quiet zone adds 1/7 on each side.
            if (u >= -1 / 7 && u < 8 / 7 && v >= -1 / 7 && v < 8 / 7) {
              if (u >= 0 && u < 1 && v >= 0 && v < 1) {
                value = cells[Math.floor(v * 7)][Math.floor(u * 7)] ? 235 : 25;
              } else {
                value = 235;
              }
            }
          }
          acc += value;
        }
      }
      const base = acc / (samples * samples) + (random() - 0.5) * 2 * noise;
      const i = (y * width + x) * 4;
      data[i] = base * 1.02;
      data[i + 1] = base;
      data[i + 2] = base * 0.97;
      data[i + 3] = 255;
    }
  }

  return { width, height, data };
}

export type Mat3 = number[][];

export function rotationFromEuler(rx: number, ry: number, rz: number): Mat3 {
  const [cx, sx, cy, sy, cz, sz] = [
    Math.cos(rx),
    Math.sin(rx),
    Math.cos(ry),
    Math.sin(ry),
    Math.cos(rz),
    Math.sin(rz),
  ];
  const Rx = [
    [1, 0, 0],
    [0, cx, -sx],
    [0, sx, cx],
  ];
  const Ry = [
    [cy, 0, sy],
    [0, 1, 0],
    [-sy, 0, cy],
  ];
  const Rz = [
    [cz, -sz, 0],
    [sz, cz, 0],
    [0, 0, 1],
  ];
  return mul(Rz, mul(Ry, Rx));
}

export function mul(a: Mat3, b: Mat3): Mat3 {
  return a.map((row) =>
    [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]),
  );
}

/**
 * Projects the corners of a square marker (edge `size`) with pose (R, t) in POSIT's camera
 * frame (x right, y up, z forward) to image pixels (origin top-left, y down).
 * Corner order matches POSIT's model: top-left, top-right, bottom-right, bottom-left.
 */
export function projectMarker(
  rotation: Mat3,
  translation: number[],
  size: number,
  focalLength: number,
  width: number,
  height: number,
): Point[] {
  const h = size / 2;
  const model = [
    [-h, h, 0],
    [h, h, 0],
    [h, -h, 0],
    [-h, -h, 0],
  ];
  return model.map((X) => {
    const p = [0, 1, 2].map(
      (i) => rotation[i][0] * X[0] + rotation[i][1] * X[1] + rotation[i][2] * X[2] + translation[i],
    );
    const cx = (focalLength * p[0]) / p[2];
    const cy = (focalLength * p[1]) / p[2];
    return { x: cx + width / 2, y: height / 2 - cy };
  });
}
