/** Minimal 3-vector used by POSIT. */
export class Vec3 {
  v: number[];

  constructor(x = 0.0, y = 0.0, z = 0.0) {
    this.v = [x, y, z];
  }

  copy(a: Vec3): this {
    const v = this.v;
    v[0] = a.v[0];
    v[1] = a.v[1];
    v[2] = a.v[2];
    return this;
  }

  static add(a: Vec3, b: Vec3): Vec3 {
    return new Vec3(a.v[0] + b.v[0], a.v[1] + b.v[1], a.v[2] + b.v[2]);
  }

  static sub(a: Vec3, b: Vec3): Vec3 {
    return new Vec3(a.v[0] - b.v[0], a.v[1] - b.v[1], a.v[2] - b.v[2]);
  }

  static mult(a: Vec3, b: Vec3): Vec3 {
    return new Vec3(a.v[0] * b.v[0], a.v[1] * b.v[1], a.v[2] * b.v[2]);
  }

  static addScalar(a: Vec3, b: number): Vec3 {
    return new Vec3(a.v[0] + b, a.v[1] + b, a.v[2] + b);
  }

  static multScalar(a: Vec3, b: number): Vec3 {
    return new Vec3(a.v[0] * b, a.v[1] * b, a.v[2] * b);
  }

  static dot(a: Vec3, b: Vec3): number {
    return a.v[0] * b.v[0] + a.v[1] * b.v[1] + a.v[2] * b.v[2];
  }

  static cross(a: Vec3, b: Vec3): Vec3 {
    const [a0, a1, a2] = a.v;
    const [b0, b1, b2] = b.v;
    return new Vec3(a1 * b2 - a2 * b1, a2 * b0 - a0 * b2, a0 * b1 - a1 * b0);
  }

  /** Normalizes in place and returns the previous length. */
  normalize(): number {
    const v = this.v;
    const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    if (len > 0.0) {
      v[0] /= len;
      v[1] /= len;
      v[2] /= len;
    }
    return len;
  }

  /** Component-wise reciprocal; zero components stay zero. */
  static inverse(a: Vec3): Vec3 {
    const r = new Vec3();
    for (let i = 0; i < 3; ++i) {
      if (a.v[i] !== 0.0) {
        r.v[i] = 1.0 / a.v[i];
      }
    }
    return r;
  }

  square(): number {
    const v = this.v;
    return v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  }

  minIndex(): number {
    const v = this.v;
    return v[0] < v[1] ? (v[0] < v[2] ? 0 : 2) : v[1] < v[2] ? 1 : 2;
  }
}

/** Minimal row-major 3x3 matrix used by POSIT. */
export class Mat3 {
  m: number[][] = [
    [0.0, 0.0, 0.0],
    [0.0, 0.0, 0.0],
    [0.0, 0.0, 0.0],
  ];

  static clone(a: Mat3): Mat3 {
    return new Mat3().copy(a);
  }

  copy(a: Mat3): this {
    for (let i = 0; i < 3; ++i) {
      for (let j = 0; j < 3; ++j) {
        this.m[i][j] = a.m[i][j];
      }
    }
    return this;
  }

  static fromRows(a: Vec3, b: Vec3, c: Vec3): Mat3 {
    const r = new Mat3();
    r.m = [[...a.v], [...b.v], [...c.v]];
    return r;
  }

  static fromDiagonal(a: Vec3): Mat3 {
    const r = new Mat3();
    r.m[0][0] = a.v[0];
    r.m[1][1] = a.v[1];
    r.m[2][2] = a.v[2];
    return r;
  }

  static transpose(a: Mat3): Mat3 {
    const r = new Mat3();
    for (let i = 0; i < 3; ++i) {
      for (let j = 0; j < 3; ++j) {
        r.m[i][j] = a.m[j][i];
      }
    }
    return r;
  }

  static mult(a: Mat3, b: Mat3): Mat3 {
    const r = new Mat3();
    for (let i = 0; i < 3; ++i) {
      for (let j = 0; j < 3; ++j) {
        r.m[i][j] = a.m[i][0] * b.m[0][j] + a.m[i][1] * b.m[1][j] + a.m[i][2] * b.m[2][j];
      }
    }
    return r;
  }

  static multVector(m: Mat3, a: Vec3): Vec3 {
    const [r0, r1, r2] = m.m;
    const [x, y, z] = a.v;
    return new Vec3(
      r0[0] * x + r0[1] * y + r0[2] * z,
      r1[0] * x + r1[1] * y + r1[2] * z,
      r2[0] * x + r2[1] * y + r2[2] * z,
    );
  }

  column(index: number): Vec3 {
    return new Vec3(this.m[0][index], this.m[1][index], this.m[2][index]);
  }

  row(index: number): Vec3 {
    return new Vec3(this.m[index][0], this.m[index][1], this.m[index][2]);
  }
}
