import {
  type CV,
  createPreprocessor,
  Detector,
  estimatePose,
  type FramePreprocessor,
  type Marker,
  Posit,
  type PreprocessorBackend,
  poseToMatrix,
} from "ts-aruco";
import { type Quat, quatAngle, quatFromMatrix, type Vec3 } from "./math.js";

export type Mode = PreprocessorBackend;

export const MODE_LABELS: Record<Mode, string> = {
  cpu: "CPU",
  webgl2: "WebGL2",
  webgpu: "WebGPU",
};

/** A marker pose in a right-handed camera frame (x right, y up, camera looking down -z). */
export interface MarkerPose {
  id: number;
  position: Vec3;
  quaternion: Quat;
  /** Reprojection error of the chosen POSIT solution. */
  error: number;
}

export interface TrackResult {
  markers: Marker[];
  poses: MarkerPose[];
  width: number;
  height: number;
  /** Milliseconds spent in preprocessing (incl. readback) and in the CPU detector. */
  preprocessMs: number;
  detectMs: number;
}

export interface TrackerOptions {
  /** Backends to try in order. */
  modes?: readonly Mode[] | undefined;
  /** Share the renderer's WebGL2 context (three.js) instead of creating a hidden one. */
  gl?: WebGL2RenderingContext | undefined;
  /** Share the renderer's WebGPU device instead of requesting a new one. */
  device?: GPUDevice | undefined;
}

/**
 * Runs marker detection and POSIT on video frames with the chosen preprocessing backend.
 * Poses are in units of the marker's edge length.
 */
export class Tracker {
  readonly mode: Mode;
  private readonly detector = new Detector();
  private posit?: Posit;
  private positWidth = 0;
  private readonly previous = new Map<number, Quat>();

  private readonly pre: FramePreprocessor;

  private constructor(pre: FramePreprocessor) {
    this.pre = pre;
    this.mode = pre.backend;
  }

  /** Uses the first backend of `modes` that works (default WebGPU, WebGL2, CPU). */
  static async create(options: TrackerOptions): Promise<Tracker> {
    const pre = await createPreprocessor({
      backends: options.modes,
      gl: options.gl,
      device: options.device,
    });
    return new Tracker(pre);
  }

  async track(video: HTMLVideoElement): Promise<TrackResult> {
    const width = video.videoWidth;
    const height = video.videoHeight;
    const t0 = performance.now();
    const pre = await this.pre.process(video);
    const t1 = performance.now();
    const markers = this.detector.detectPreprocessed(pre.grey, pre.thresholded);

    if (!this.posit || this.positWidth !== width) {
      // Focal length = image width, a ~53 degree horizontal field of view; good enough for webcams.
      this.posit = new Posit(1, width);
      this.positWidth = width;
    }

    const poses = markers.map((m) => this.pose(m, width, height));
    const t2 = performance.now();
    return { markers, poses, width, height, preprocessMs: t1 - t0, detectMs: t2 - t1 };
  }

  private pose(marker: Marker, width: number, height: number): MarkerPose {
    const pose = estimatePose(this.posit!, marker, width, height);
    const best = toPose(marker.id, pose.bestRotation, pose.bestTranslation, pose.bestError);
    const alt = toPose(
      marker.id,
      pose.alternativeRotation,
      pose.alternativeTranslation,
      pose.alternativeError,
    );

    // A flat marker has two plausible poses. When their errors are close, keep the one that is
    // closest to the last frame so the model does not flip back and forth.
    let chosen = best;
    const last = this.previous.get(marker.id);
    if (last && Number.isFinite(alt.error) && alt.error < best.error * 4 + 1e-3) {
      if (quatAngle(alt.quaternion, last) < quatAngle(best.quaternion, last)) {
        chosen = alt;
      }
    }
    this.previous.set(marker.id, chosen.quaternion);
    return chosen;
  }

  /** Draws the detected marker outlines into a 2D context, e.g. for debugging. */
  static drawOutlines(ctx: CanvasRenderingContext2D, markers: readonly Marker[], scale = 1): void {
    ctx.lineWidth = 3;
    for (const m of markers) {
      ctx.strokeStyle = "#3f3";
      ctx.beginPath();
      m.corners.forEach((c: CV.Point, i: number) => {
        if (i === 0) ctx.moveTo(c.x * scale, c.y * scale);
        else ctx.lineTo(c.x * scale, c.y * scale);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = "#f33";
      ctx.fillRect(m.corners[0].x * scale - 4, m.corners[0].y * scale - 4, 8, 8);
    }
  }

  dispose(): void {
    this.pre.dispose();
  }
}

function toPose(
  id: number,
  rotation: number[][],
  translation: number[],
  error: number,
): MarkerPose {
  const m = poseToMatrix(rotation, translation, "right");
  return {
    id,
    position: [m[12], m[13], m[14]],
    quaternion: quatFromMatrix(m),
    error,
  };
}
