/// <reference types="@webgpu/types" />
import { Image, stackBoxBlurMult, stackBoxBlurShift } from "../cv.js";
import type { PreprocessResult } from "../preprocess.js";
import { BLUR_H_SHADER, greyShader, THRESHOLD_SHADER, WORKGROUP_SIZE } from "./shaders.js";

export type { PreprocessResult } from "../preprocess.js";

/** An RGBA texture on the preprocessor's device. It needs `TEXTURE_BINDING` usage. */
export interface GPUTextureSource {
  texture: GPUTexture;
  /** Set when row 0 of the texture is the bottom of the image. */
  flipY?: boolean | undefined;
}

/**
 * Video and `VideoFrame` are imported as external textures without a copy. Other sources
 * (ImageData, ImageBitmap, canvas, image) are copied into a texture first.
 */
export type WebGPUFrameSource =
  | HTMLVideoElement
  | VideoFrame
  | ImageData
  | ImageBitmap
  | HTMLCanvasElement
  | OffscreenCanvas
  | HTMLImageElement
  | GPUTextureSource;

export interface WebGPUPreprocessorOptions {
  /** Same as `DetectorOptions.adaptiveThresholdKernelSize`. Default 2. */
  kernelSize?: number | undefined;
  /** Same as `DetectorOptions.adaptiveThresholdConstant`. Default 7. */
  thresholdConstant?: number | undefined;
}

interface Target {
  width: number;
  height: number;
  pw: number;
  params: GPUBuffer;
  grey: GPUBuffer;
  blur: GPUBuffer;
  mask: GPUBuffer;
  blurBindGroup: GPUBindGroup;
  thresholdBindGroup: GPUBindGroup;
}

function isTextureSource(source: WebGPUFrameSource): source is GPUTextureSource {
  return (
    typeof GPUTexture !== "undefined" && (source as GPUTextureSource).texture instanceof GPUTexture
  );
}

function isExternal(source: WebGPUFrameSource): source is HTMLVideoElement | VideoFrame {
  return (
    (typeof HTMLVideoElement !== "undefined" && source instanceof HTMLVideoElement) ||
    (typeof VideoFrame !== "undefined" && source instanceof VideoFrame)
  );
}

function sourceSize(source: WebGPUFrameSource): [number, number] {
  if (isTextureSource(source)) return [source.texture.width, source.texture.height];
  if (typeof HTMLVideoElement !== "undefined" && source instanceof HTMLVideoElement) {
    return [source.videoWidth, source.videoHeight];
  }
  if (typeof VideoFrame !== "undefined" && source instanceof VideoFrame) {
    return [source.displayWidth, source.displayHeight];
  }
  const s = source as { width: number; height: number };
  return [s.width, s.height];
}

/**
 * WebGPU version of {@link WebGL2Preprocessor}: greyscale, box blur and adaptive threshold as
 * compute shaders, results read back with `mapAsync`.
 *
 * Blur and threshold match the CPU implementation bit for bit; the integer greyscale
 * conversion can be 1 lower than the CPU version for about 0.02% of colours.
 *
 * Pass the device of your renderer (Babylon.js `WebGPUEngine`, Babylon Lite, three.js
 * `WebGPURenderer`) to work on its textures directly, or use {@link create} for a private
 * device.
 */
export class WebGPUPreprocessor {
  readonly device: GPUDevice;
  readonly kernelSize: number;
  readonly thresholdConstant: number;

  private readonly greyExternal: GPUComputePipeline;
  private readonly greyTexture: GPUComputePipeline;
  private readonly blurPipeline: GPUComputePipeline;
  private readonly thresholdPipeline: GPUComputePipeline;
  private target: Target | null = null;
  private uploadTex: GPUTexture | null = null;
  private readonly freeStaging: GPUBuffer[] = [];
  private disposed = false;
  private externalImportFailed = false;
  private copyFailed = false;
  private readCtx: OffscreenCanvasRenderingContext2D | null = null;

  constructor(device: GPUDevice, options: WebGPUPreprocessorOptions = {}) {
    this.device = device;
    this.kernelSize = options.kernelSize ?? 2;
    this.thresholdConstant = options.thresholdConstant ?? 7;

    if (this.kernelSize < 0 || this.kernelSize >= stackBoxBlurMult.length) {
      throw new RangeError(`kernelSize must be between 0 and ${stackBoxBlurMult.length - 1}`);
    }

    const pipeline = (code: string, label: string) =>
      device.createComputePipeline({
        label,
        layout: "auto",
        compute: { module: device.createShaderModule({ label, code }), entryPoint: "main" },
      });

    this.greyExternal = pipeline(greyShader(true), "ts-aruco grey (external)");
    this.greyTexture = pipeline(greyShader(false), "ts-aruco grey");
    this.blurPipeline = pipeline(BLUR_H_SHADER, "ts-aruco blur");
    this.thresholdPipeline = pipeline(THRESHOLD_SHADER, "ts-aruco threshold");
  }

  /** Creates a preprocessor on its own device. */
  static async create(options: WebGPUPreprocessorOptions = {}): Promise<WebGPUPreprocessor> {
    if (typeof navigator === "undefined" || !navigator.gpu) {
      throw new Error("WebGPU is not available");
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No WebGPU adapter found");
    const device = await adapter.requestDevice();
    return new WebGPUPreprocessor(device, options);
  }

  /** Processes a frame; resolves when grey image and mask are on the CPU. */
  async process(source: WebGPUFrameSource, out?: PreprocessResult): Promise<PreprocessResult> {
    if (this.disposed) throw new Error("WebGPUPreprocessor has been disposed");

    const device = this.device;
    const [width, height] = sourceSize(source);
    if (width <= 0 || height <= 0) throw new Error("Frame source has no size yet");

    const t = this.ensureTarget(width, height);
    const flipY = isTextureSource(source) && source.flipY === true;
    device.queue.writeBuffer(t.params, 0, this.paramsData(t, flipY));

    // Greyscale input binding: external texture (video), the caller's texture or an upload.
    let greyPipeline: GPUComputePipeline;
    let resource: GPUBindingResource;
    let external: GPUExternalTexture | null = null;
    if (isExternal(source) && !this.externalImportFailed) {
      try {
        external = device.importExternalTexture({ source });
      } catch (e) {
        // Some browsers and drivers cannot import every video (e.g. canvas capture streams on
        // software adapters). Fall back to a copy from then on.
        console.warn("ts-aruco: importExternalTexture failed, copying video frames instead", e);
        this.externalImportFailed = true;
      }
    }
    if (external) {
      greyPipeline = this.greyExternal;
      resource = external;
    } else if (isTextureSource(source)) {
      greyPipeline = this.greyTexture;
      resource = source.texture.createView();
    } else {
      greyPipeline = this.greyTexture;
      resource = this.upload(source, width, height).createView();
    }
    const greyBindGroup = device.createBindGroup({
      layout: greyPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: t.params } },
        { binding: 1, resource },
        { binding: 2, resource: { buffer: t.grey } },
      ],
    });

    const words = t.pw * height;
    const bytes = words * 4;
    const staging =
      this.freeStaging.pop() ??
      device.createBuffer({
        label: "ts-aruco staging",
        size: bytes * 2,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });

    const encoder = device.createCommandEncoder({ label: "ts-aruco preprocess" });
    const pass = encoder.beginComputePass();
    const groupsX = Math.ceil(t.pw / WORKGROUP_SIZE);
    const groupsY = Math.ceil(height / WORKGROUP_SIZE);
    pass.setPipeline(greyPipeline);
    pass.setBindGroup(0, greyBindGroup);
    pass.dispatchWorkgroups(groupsX, groupsY);
    pass.setPipeline(this.blurPipeline);
    pass.setBindGroup(0, t.blurBindGroup);
    pass.dispatchWorkgroups(groupsX, groupsY);
    pass.setPipeline(this.thresholdPipeline);
    pass.setBindGroup(0, t.thresholdBindGroup);
    pass.dispatchWorkgroups(groupsX, groupsY);
    pass.end();
    encoder.copyBufferToBuffer(t.grey, 0, staging, 0, bytes);
    encoder.copyBufferToBuffer(t.mask, 0, staging, bytes, bytes);
    device.queue.submit([encoder.finish()]);

    try {
      await staging.mapAsync(GPUMapMode.READ);
      const data = new Uint8Array(staging.getMappedRange());
      const result = out ?? { grey: new Image(), thresholded: new Image() };
      const grey = result.grey.resize(width, height);
      const mask = result.thresholded.resize(width, height);
      const rowBytes = t.pw * 4;

      if (rowBytes === width) {
        grey.data.set(data.subarray(0, bytes));
        mask.data.set(data.subarray(bytes, 2 * bytes));
      } else {
        for (let y = 0; y < height; ++y) {
          grey.data.set(data.subarray(y * rowBytes, y * rowBytes + width), y * width);
          mask.data.set(
            data.subarray(bytes + y * rowBytes, bytes + y * rowBytes + width),
            y * width,
          );
        }
      }
      staging.unmap();
      return result;
    } finally {
      // Buffers of an outdated size are dropped instead of reused.
      if (staging.size === bytes * 2 && !this.disposed) this.freeStaging.push(staging);
      else staging.destroy();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.destroyTarget();
    this.uploadTex?.destroy();
    for (const b of this.freeStaging) b.destroy();
    this.freeStaging.length = 0;
  }

  private paramsData(t: Target, flipY: boolean): ArrayBuffer {
    const data = new ArrayBuffer(32);
    const u = new Uint32Array(data);
    const i = new Int32Array(data);
    u[0] = t.width;
    u[1] = t.height;
    u[2] = t.pw;
    u[3] = this.kernelSize;
    u[4] = stackBoxBlurMult[this.kernelSize];
    u[5] = stackBoxBlurShift[this.kernelSize];
    i[6] = this.thresholdConstant;
    u[7] = flipY ? 1 : 0;
    return data;
  }

  private upload(
    source: Exclude<WebGPUFrameSource, GPUTextureSource>,
    width: number,
    height: number,
  ): GPUTexture {
    const device = this.device;
    if (!this.uploadTex || this.uploadTex.width !== width || this.uploadTex.height !== height) {
      this.uploadTex?.destroy();
      this.uploadTex = device.createTexture({
        label: "ts-aruco upload",
        size: [width, height],
        format: "rgba8unorm",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
    let pixels = typeof ImageData !== "undefined" && source instanceof ImageData ? source : null;
    if (!pixels && !this.copyFailed) {
      try {
        device.queue.copyExternalImageToTexture(
          { source: source as GPUCopyExternalImageSource },
          { texture: this.uploadTex },
          [width, height],
        );
        return this.uploadTex;
      } catch (e) {
        // Seen with software adapters (SwiftShader) for video: go through a 2D canvas instead.
        console.warn(
          "ts-aruco: copyExternalImageToTexture failed, reading frames via a 2D canvas",
          e,
        );
        this.copyFailed = true;
      }
    }
    pixels ??= this.readPixels(source as CanvasImageSource, width, height);
    // Exact bytes, no colour conversion.
    device.queue.writeTexture(
      { texture: this.uploadTex },
      pixels.data,
      { bytesPerRow: width * 4 },
      [width, height],
    );
    return this.uploadTex;
  }

  private readPixels(source: CanvasImageSource, width: number, height: number): ImageData {
    if (!this.readCtx) {
      const canvas = new OffscreenCanvas(width, height);
      this.readCtx = canvas.getContext("2d", { willReadFrequently: true });
      if (!this.readCtx) throw new Error("2D canvas not available");
    }
    const canvas = this.readCtx.canvas;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    this.readCtx.drawImage(source, 0, 0, width, height);
    return this.readCtx.getImageData(0, 0, width, height);
  }

  private ensureTarget(width: number, height: number): Target {
    const t = this.target;
    if (t && t.width === width && t.height === height) return t;
    this.destroyTarget();
    for (const b of this.freeStaging) b.destroy();
    this.freeStaging.length = 0;

    const device = this.device;
    const pw = Math.ceil(width / 4);
    const size = pw * height * 4;
    const storage = (label: string, copySrc: boolean) =>
      device.createBuffer({
        label,
        size,
        usage: GPUBufferUsage.STORAGE | (copySrc ? GPUBufferUsage.COPY_SRC : 0),
      });

    const params = device.createBuffer({
      label: "ts-aruco params",
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const grey = storage("ts-aruco grey", true);
    const blur = storage("ts-aruco blur", false);
    const mask = storage("ts-aruco mask", true);

    const blurBindGroup = device.createBindGroup({
      layout: this.blurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: grey } },
        { binding: 2, resource: { buffer: blur } },
      ],
    });
    const thresholdBindGroup = device.createBindGroup({
      layout: this.thresholdPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: grey } },
        { binding: 2, resource: { buffer: blur } },
        { binding: 3, resource: { buffer: mask } },
      ],
    });

    this.target = {
      width,
      height,
      pw,
      params,
      grey,
      blur,
      mask,
      blurBindGroup,
      thresholdBindGroup,
    };
    return this.target;
  }

  private destroyTarget(): void {
    const t = this.target;
    if (!t) return;
    t.params.destroy();
    t.grey.destroy();
    t.blur.destroy();
    t.mask.destroy();
    this.target = null;
  }
}
