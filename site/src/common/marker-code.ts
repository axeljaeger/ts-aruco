/** Row patterns of the original js-aruco code. A row encodes 2 bits: index = 2 * bit1 + bit3. */
const ROW_CODES = [
  [1, 0, 0, 0, 0],
  [1, 0, 1, 1, 1],
  [0, 1, 0, 0, 1],
  [0, 1, 1, 1, 0],
] as const;

export const MAX_MARKER_ID = 1023;

/** The 5x5 inner bits (1 = white) of marker `id` (0-1023). */
export function markerBits(id: number): number[][] {
  const bits: number[][] = [];
  for (let row = 0; row < 5; ++row) {
    const code = (id >> (2 * (4 - row))) & 3;
    bits.push([...ROW_CODES[code]]);
  }
  return bits;
}

/**
 * Draws marker `id` centred in a square of `size` pixels at (x, y): a black 7x7 grid (border plus
 * the 5x5 code) surrounded by a white quiet zone of `quiet` cells.
 */
export function drawMarker(
  ctx: CanvasRenderingContext2D,
  id: number,
  x: number,
  y: number,
  size: number,
  quiet = 1,
): void {
  const cells = 7 + 2 * quiet;
  const cell = size / cells;
  ctx.fillStyle = "#fff";
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = "#000";
  ctx.fillRect(x + quiet * cell, y + quiet * cell, 7 * cell, 7 * cell);
  ctx.fillStyle = "#fff";
  const bits = markerBits(id);
  for (let r = 0; r < 5; ++r) {
    for (let c = 0; c < 5; ++c) {
      if (bits[r][c]) {
        // Overlap by half a pixel so no hairlines show between neighbouring cells.
        ctx.fillRect(
          x + (quiet + 1 + c) * cell - 0.25,
          y + (quiet + 1 + r) * cell - 0.25,
          cell + 0.5,
          cell + 0.5,
        );
      }
    }
  }
}

/** SVG markup of marker `id`, useful for printing. */
export function markerSvg(id: number, quiet = 1): string {
  const n = 7 + 2 * quiet;
  const bits = markerBits(id);
  let rects = "";
  for (let r = 0; r < 5; ++r) {
    for (let c = 0; c < 5; ++c) {
      if (bits[r][c]) {
        rects += `<rect x="${quiet + 1 + c}" y="${quiet + 1 + r}" width="1" height="1"/>`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><rect x="${quiet}" y="${quiet}" width="7" height="7"/><g fill="#fff">${rects}</g></svg>`;
}
