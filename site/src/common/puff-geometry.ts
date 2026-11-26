/** A flat shaded, once subdivided icosahedron of radius 1 (80 triangles) for the smoke puffs. */
export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export function puffGeometry(): MeshData {
  const t = (1 + Math.sqrt(5)) / 2;
  const v: number[][] = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ].map(norm);
  const faces = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];

  const tris: number[][][] = [];
  for (const [a, b, c] of faces) {
    const ab = norm(mid(v[a], v[b]));
    const bc = norm(mid(v[b], v[c]));
    const ca = norm(mid(v[c], v[a]));
    tris.push([v[a], ab, ca], [v[b], bc, ab], [v[c], ca, bc], [ab, bc, ca]);
  }

  const positions = new Float32Array(tris.length * 9);
  const normals = new Float32Array(tris.length * 9);
  const indices = new Uint32Array(tris.length * 3);
  tris.forEach(([a, b, c], i) => {
    const n = norm([(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]);
    [a, b, c].forEach((p, k) => {
      positions.set(p, i * 9 + k * 3);
      normals.set(n, i * 9 + k * 3);
      indices[i * 3 + k] = i * 3 + k;
    });
  });
  return { positions, normals, indices };
}

function mid(a: number[], b: number[]): number[] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

function norm(a: number[]): number[] {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
}
