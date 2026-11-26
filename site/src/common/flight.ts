import {
  composeMatrix,
  distance,
  lerpVec,
  type Quat,
  quatFromAxisAngle,
  quatMultiply,
  rotateVec,
  slerp,
  type Vec3,
} from "./math.js";
import type { MarkerPose } from "./tracker.js";

/**
 * Places the airplane model (glTF: +Y up, nose +Z) on the marker: nose towards the marker's top
 * edge, wheels towards the marker, hovering a little in front of it. Marker space is x right,
 * y up (top edge), z out of the marker.
 */
const MODEL_TO_MARKER: Quat = quatMultiply(
  quatFromAxisAngle([0, 0, 1], Math.PI),
  quatFromAxisAngle([1, 0, 0], Math.PI / 2),
);
const MODEL_OFFSET: Vec3 = [0, 0, 0.45];
const MODEL_SCALE = 1.0;
/** Exhaust point at the tail, in model space. */
const TAIL: Vec3 = [0, 0.02, -0.8];

/** How long a lost marker keeps its last pose before the plane disappears. */
const HOLD_MS = 300;
/** Time constants of the pose smoothing. */
const POSITION_TAU_MS = 45;
const ROTATION_TAU_MS = 60;

const PUFF_CAPACITY = 400;
const PUFF_LIFE_MS = 1800;
const PUFF_SPACING = 0.06;
const PUFF_MIN_INTERVAL_MS = 40;

interface Puff {
  p: Vec3;
  v: Vec3;
  age: number;
  life: number;
  size: number;
  spin: number;
}

/** Everything an engine needs to draw one frame of the demo. */
export interface FlightFrame {
  visible: boolean;
  /** Airplane world transform (right-handed camera space). */
  position: Vec3;
  quaternion: Quat;
  scale: number;
  /** Propeller rotation around the model's z axis, radians. */
  propeller: number;
  /** Column-major 4x4 matrices of the smoke puffs (`puffCount` of them). */
  puffMatrices: Float32Array;
  puffCount: number;
}

/**
 * Engine independent demo logic: smooths the tracked pose, flies the plane and simulates its
 * smoke trail. Units are marker edge lengths, so the scene scales with the marker.
 */
export class Flight {
  readonly frame: FlightFrame = {
    visible: false,
    position: [0, 0, -5],
    quaternion: [0, 0, 0, 1],
    scale: MODEL_SCALE,
    propeller: 0,
    puffMatrices: new Float32Array(PUFF_CAPACITY * 16),
    puffCount: 0,
  };

  private target: MarkerPose | null = null;
  private targetTime = Number.NEGATIVE_INFINITY;
  private smoothedPosition: Vec3 = [0, 0, -5];
  private smoothedRotation: Quat = [0, 0, 0, 1];
  private hasPose = false;
  private lastEmit: Vec3 | null = null;
  private sinceEmit = 0;
  private puffs: Puff[] = [];
  private markerId: number | null = null;

  /** Feeds the latest tracking result. Follows the first marker seen until it is lost. */
  update(poses: readonly MarkerPose[], now = performance.now()): void {
    const pose = poses.find((p) => p.id === this.markerId) ?? poses[0];
    if (pose) {
      this.markerId = pose.id;
      this.target = pose;
      this.targetTime = now;
    }
  }

  /** Advances the animation by `dtMs` and returns the frame to draw. */
  step(dtMs: number, now = performance.now()): FlightFrame {
    const dt = Math.min(dtMs, 100);
    const f = this.frame;
    const tracking = this.target !== null && now - this.targetTime < HOLD_MS;

    if (tracking && this.target) {
      const pos = this.target.position;
      const rot = this.target.quaternion;
      if (!this.hasPose) {
        this.smoothedPosition = [...pos];
        this.smoothedRotation = [...rot];
        this.hasPose = true;
      } else {
        this.smoothedPosition = lerpVec(
          this.smoothedPosition,
          pos,
          1 - Math.exp(-dt / POSITION_TAU_MS),
        );
        this.smoothedRotation = slerp(
          this.smoothedRotation,
          rot,
          1 - Math.exp(-dt / ROTATION_TAU_MS),
        );
      }

      const q = quatMultiply(this.smoothedRotation, MODEL_TO_MARKER);
      const offset = rotateVec(this.smoothedRotation, MODEL_OFFSET);
      f.position = [
        this.smoothedPosition[0] + offset[0],
        this.smoothedPosition[1] + offset[1],
        this.smoothedPosition[2] + offset[2],
      ];
      f.quaternion = q;
      f.visible = true;

      const tail = rotateVec(q, [
        TAIL[0] * MODEL_SCALE,
        TAIL[1] * MODEL_SCALE,
        TAIL[2] * MODEL_SCALE,
      ]);
      this.emit([f.position[0] + tail[0], f.position[1] + tail[1], f.position[2] + tail[2]], dt);
    } else {
      if (f.visible) {
        this.markerId = null;
      }
      f.visible = false;
      this.hasPose = false;
      this.lastEmit = null;
    }

    f.propeller = (f.propeller + dt * 0.04) % (Math.PI * 2);
    this.simulate(dt);
    return f;
  }

  /** Emits puffs along the path since the last emission so fast moves leave a continuous trail. */
  private emit(at: Vec3, dt: number): void {
    this.sinceEmit += dt;
    if (!this.lastEmit) {
      this.lastEmit = at;
      this.spawn(at);
      this.sinceEmit = 0;
      return;
    }
    const d = distance(this.lastEmit, at);
    const steps = Math.min(12, Math.floor(d / PUFF_SPACING));
    if (steps > 0) {
      for (let i = 1; i <= steps; ++i) {
        this.spawn(lerpVec(this.lastEmit, at, i / steps), (steps - i) * (dt / steps));
      }
      this.lastEmit = at;
      this.sinceEmit = 0;
    } else if (this.sinceEmit >= PUFF_MIN_INTERVAL_MS) {
      this.spawn(at);
      this.lastEmit = at;
      this.sinceEmit = 0;
    }
  }

  private spawn(p: Vec3, age = 0): void {
    if (this.puffs.length >= PUFF_CAPACITY) {
      this.puffs.shift();
    }
    const r = () => (Math.random() - 0.5) * 2;
    this.puffs.push({
      p: [...p],
      // Slow drift upwards (camera space y) plus some turbulence; units per second.
      v: [r() * 0.05, 0.08 + Math.random() * 0.06, r() * 0.05],
      age,
      life: PUFF_LIFE_MS * (0.8 + Math.random() * 0.4),
      size: 0.05 + Math.random() * 0.03,
      spin: Math.random() * Math.PI * 2,
    });
  }

  private simulate(dt: number): void {
    const f = this.frame;
    const s = dt / 1000;
    let n = 0;
    const alive: Puff[] = [];
    for (const puff of this.puffs) {
      puff.age += dt;
      if (puff.age >= puff.life) continue;
      alive.push(puff);
      puff.p[0] += puff.v[0] * s;
      puff.p[1] += puff.v[1] * s;
      puff.p[2] += puff.v[2] * s;
      // Grow quickly, then shrink to nothing: cartoon smoke without transparency.
      const t = puff.age / puff.life;
      const grow = t < 0.12 ? t / 0.12 : 1 - ((t - 0.12) / 0.88) ** 1.5;
      const size = puff.size * (1 + 2.2 * t) * grow;
      composeMatrix(
        puff.p,
        quatFromAxisAngle([0, 1, 0], puff.spin + t * 2),
        size,
        f.puffMatrices,
        n * 16,
      );
      ++n;
    }
    this.puffs = alive;
    f.puffCount = n;
  }
}
