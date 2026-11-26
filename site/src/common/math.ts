export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

/** Quaternion (x, y, z, w) of the rotation part of a column-major 4x4 matrix. */
export function quatFromMatrix(m: ArrayLike<number>): Quat {
  const m00 = m[0];
  const m10 = m[1];
  const m20 = m[2];
  const m01 = m[4];
  const m11 = m[5];
  const m21 = m[6];
  const m02 = m[8];
  const m12 = m[9];
  const m22 = m[10];
  const trace = m00 + m11 + m22;
  let q: Quat;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  return normalizeQuat(q);
}

export function normalizeQuat(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

export function quatMultiply(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

export function rotateVec(q: Quat, v: Vec3): Vec3 {
  // v' = v + 2 * cross(q.xyz, cross(q.xyz, v) + w * v)
  const [x, y, z, w] = q;
  const cx = y * v[2] - z * v[1] + w * v[0];
  const cy = z * v[0] - x * v[2] + w * v[1];
  const cz = x * v[1] - y * v[0] + w * v[2];
  return [v[0] + 2 * (y * cz - z * cy), v[1] + 2 * (z * cx - x * cz), v[2] + 2 * (x * cy - y * cx)];
}

export function quatDot(a: Quat, b: Quat): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

/** Angle in radians between two rotations. */
export function quatAngle(a: Quat, b: Quat): number {
  return 2 * Math.acos(Math.min(1, Math.abs(quatDot(a, b))));
}

export function slerp(a: Quat, b: Quat, t: number): Quat {
  let d = quatDot(a, b);
  let bb = b;
  if (d < 0) {
    d = -d;
    bb = [-b[0], -b[1], -b[2], -b[3]];
  }
  if (d > 0.9995) {
    return normalizeQuat([
      a[0] + (bb[0] - a[0]) * t,
      a[1] + (bb[1] - a[1]) * t,
      a[2] + (bb[2] - a[2]) * t,
      a[3] + (bb[3] - a[3]) * t,
    ]);
  }
  const theta = Math.acos(d);
  const s = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / s;
  const wb = Math.sin(t * theta) / s;
  return [
    a[0] * wa + bb[0] * wb,
    a[1] * wa + bb[1] * wb,
    a[2] * wa + bb[2] * wb,
    a[3] * wa + bb[3] * wb,
  ];
}

export function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Column-major 4x4 matrix from translation, rotation and uniform scale. */
export function composeMatrix(
  p: Vec3,
  q: Quat,
  s: number,
  out: Float32Array<ArrayBufferLike> = new Float32Array(16),
  offset = 0,
): Float32Array<ArrayBufferLike> {
  const [x, y, z, w] = q;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  out[offset + 0] = (1 - (yy + zz)) * s;
  out[offset + 1] = (xy + wz) * s;
  out[offset + 2] = (xz - wy) * s;
  out[offset + 3] = 0;
  out[offset + 4] = (xy - wz) * s;
  out[offset + 5] = (1 - (xx + zz)) * s;
  out[offset + 6] = (yz + wx) * s;
  out[offset + 7] = 0;
  out[offset + 8] = (xz + wy) * s;
  out[offset + 9] = (yz - wx) * s;
  out[offset + 10] = (1 - (xx + yy)) * s;
  out[offset + 11] = 0;
  out[offset + 12] = p[0];
  out[offset + 13] = p[1];
  out[offset + 14] = p[2];
  out[offset + 15] = 1;
  return out;
}
