/// <reference types="@webgpu/types" />
import * as CV from "./cv.js";
import type { PreprocessResult } from "./preprocess.js";

export type { PreprocessResult } from "./preprocess.js";

export type PreprocessorBackend = "webgpu" | "webgl2" | "cpu";

/** Image sources every backend accepts. */
export type AutoFrameSource =
  | HTMLVideoElement
  | VideoFrame
  | ImageData
  | ImageBitmap
  | HTMLCanvasElement
  | OffscreenCanvas
  | HTMLImageElement;

/** Common interface of the WebGPU, WebGL2 and CPU preprocessing backends. */
export interface FramePreprocessor {
  readonly backend: PreprocessorBackend;
  process(source: AutoFrameSource, out?: PreprocessResult): Promise<PreprocessResult>;
  dispose(): void;
}

/** True for `ImageData` and other `{ width, height, data }` RGBA buffers. */
function isRgba(source: AutoFrameSource): source is ImageData {
  return ArrayBuffer.isView((source as { data?: unknown }).data);
}

export interface AutoPreprocessorOptions {
  /** Backends to try, in order. Default: WebGPU, then WebGL2, then the CPU. */
  backends?: readonly PreprocessorBackend[];
  /** Reuse a renderer's WebGPU device (e.g. three.js WebGPURenderer, Babylon WebGPUEngine). */
  device?: GPUDevice;
  /** Reuse a renderer's WebGL2 context. The preprocessor restores the GL state it touches. */
  gl?: WebGL2RenderingContext;
  /** Same as `DetectorOptions.adaptiveThresholdKernelSize`. Default 2. */
  kernelSize?: number;
  /** Same as `DetectorOptions.adaptiveThresholdConstant`. Default 7. */
  thresholdConstant?: number;
}

export const DEFAULT_BACKENDS: readonly PreprocessorBackend[] = ["webgpu", "webgl2", "cpu"];

/**
 * Creates the first preprocessor that works on this device, by default WebGPU, then WebGL2,
 * then the CPU. The GPU backends are loaded on demand, so a bundle only pays for what it uses.
 */
export async function createPreprocessor(
  options: AutoPreprocessorOptions = {},
): Promise<FramePreprocessor> {
  const backends = options.backends ?? DEFAULT_BACKENDS;
  const errors: string[] = [];

  for (const backend of backends) {
    try {
      if (backend === "webgpu") {
        if (!options.device && !(typeof navigator !== "undefined" && "gpu" in navigator)) {
          throw new Error("WebGPU not available");
        }
        const { WebGPUPreprocessor } = await import("./webgpu/preprocessor.js");
        const p = options.device
          ? new WebGPUPreprocessor(options.device, options)
          : await WebGPUPreprocessor.create(options);
        return wrap(
          "webgpu",
          (s, out) => p.process(s, out),
          () => p.dispose(),
        );
      }
      if (backend === "webgl2") {
        const { WebGL2Preprocessor } = await import("./webgl2/preprocessor.js");
        const p = options.gl
          ? new WebGL2Preprocessor(options.gl, options)
          : WebGL2Preprocessor.create(options);
        return wrap(
          "webgl2",
          (s, out) => p.process(s as TexImageSource, out),
          () => p.dispose(),
        );
      }
      return new CpuPreprocessor(options);
    } catch (e) {
      errors.push(`${backend}: ${(e as Error).message}`);
    }
  }
  throw new Error(`No preprocessing backend available (${errors.join("; ")})`);
}

function wrap(
  backend: PreprocessorBackend,
  process: FramePreprocessor["process"],
  dispose: () => void,
): FramePreprocessor {
  return { backend, process, dispose };
}

/** Greyscale and adaptive threshold on the CPU, exactly like `Detector.detect()`. */
export class CpuPreprocessor implements FramePreprocessor {
  readonly backend = "cpu" as const;
  private readonly kernelSize: number;
  private readonly thresholdConstant: number;
  private canvas?: OffscreenCanvas | HTMLCanvasElement;
  private ctx?: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

  constructor(options: Pick<AutoPreprocessorOptions, "kernelSize" | "thresholdConstant"> = {}) {
    this.kernelSize = options.kernelSize ?? 2;
    this.thresholdConstant = options.thresholdConstant ?? 7;
  }

  async process(source: AutoFrameSource, out?: PreprocessResult): Promise<PreprocessResult> {
    const result = out ?? { grey: new CV.Image(), thresholded: new CV.Image() };
    const rgba = isRgba(source) ? source : this.read(source);
    CV.grayscale(rgba, result.grey);
    CV.adaptiveThreshold(result.grey, result.thresholded, this.kernelSize, this.thresholdConstant);
    return result;
  }

  private read(source: AutoFrameSource): ImageData {
    const [width, height] = sourceSize(source);
    let ctx = this.ctx;
    if (!this.canvas || !ctx) {
      this.canvas =
        typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(width, height)
          : document.createElement("canvas");
      const created = this.canvas.getContext("2d", { willReadFrequently: true });
      if (!created) throw new Error("2D canvas not available");
      ctx = created as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
      this.ctx = ctx;
    }
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height);
  }

  dispose(): void {
    this.canvas = undefined;
    this.ctx = undefined;
  }
}

function sourceSize(source: AutoFrameSource): [number, number] {
  if (typeof HTMLVideoElement !== "undefined" && source instanceof HTMLVideoElement) {
    return [source.videoWidth, source.videoHeight];
  }
  if (typeof VideoFrame !== "undefined" && source instanceof VideoFrame) {
    return [source.displayWidth, source.displayHeight];
  }
  if (typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement) {
    return [source.naturalWidth, source.naturalHeight];
  }
  const s = source as { width: number; height: number };
  return [s.width, s.height];
}
