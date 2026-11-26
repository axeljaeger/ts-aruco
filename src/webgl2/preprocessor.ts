import { Image, stackBoxBlurMult, stackBoxBlurShift } from "../cv.js";
import type { PreprocessResult } from "../preprocess.js";
import { BLUR_H_SHADER, GREY_SHADER, THRESHOLD_SHADER, VERTEX_SHADER } from "./shaders.js";

export type { PreprocessResult } from "../preprocess.js";

/** An RGBA texture that already lives in the preprocessor's WebGL2 context. */
export interface TextureSource {
  texture: WebGLTexture;
  width: number;
  height: number;
  /** Set when row 0 of the texture is the bottom of the image (e.g. three.js `flipY`). */
  flipY?: boolean;
}

/** Anything WebGL can upload (video, canvas, ImageBitmap, ImageData, ...) or a texture. */
export type FrameSource = TexImageSource | TextureSource;

export interface WebGL2PreprocessorOptions {
  /** Same as `DetectorOptions.adaptiveThresholdKernelSize`. Default 2. */
  kernelSize?: number;
  /** Same as `DetectorOptions.adaptiveThresholdConstant`. Default 7. */
  thresholdConstant?: number;
}

interface Target {
  width: number;
  height: number;
  packedWidth: number;
  greyTex: WebGLTexture;
  blurTex: WebGLTexture;
  packedGreyTex: WebGLTexture;
  packedMaskTex: WebGLTexture;
  greyFbo: WebGLFramebuffer;
  blurFbo: WebGLFramebuffer;
  packedFbo: WebGLFramebuffer;
}

function isTextureSource(source: FrameSource): source is TextureSource {
  return typeof (source as TextureSource).texture === "object" && "width" in source;
}

function sourceSize(source: TexImageSource): [number, number] {
  if (typeof HTMLVideoElement !== "undefined" && source instanceof HTMLVideoElement) {
    return [source.videoWidth, source.videoHeight];
  }
  if (typeof VideoFrame !== "undefined" && source instanceof VideoFrame) {
    return [source.displayWidth, source.displayHeight];
  }
  const sized = source as { width: number | SVGAnimatedLength; height: number | SVGAnimatedLength };
  if (typeof sized.width !== "number" || typeof sized.height !== "number") {
    throw new Error("Unsupported frame source");
  }
  return [sized.width, sized.height];
}

/**
 * Runs greyscale conversion, box blur and adaptive threshold on the GPU (WebGL2) and reads
 * the results back as {@link Image}s for `Detector.detectPreprocessed()`.
 *
 * The blur and threshold match the CPU implementation bit for bit. The greyscale conversion
 * uses integer arithmetic and can be 1 lower than the CPU version for about 0.02% of colours.
 *
 * The preprocessor can share a context with a renderer. It saves and restores the GL state
 * it touches, but renderers that cache state (three.js, Babylon.js) should still be told to
 * reset their caches afterwards.
 */
export class WebGL2Preprocessor {
  readonly gl: WebGL2RenderingContext;
  readonly kernelSize: number;
  readonly thresholdConstant: number;

  private readonly greyProgram: WebGLProgram;
  private readonly blurProgram: WebGLProgram;
  private readonly thresholdProgram: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly sourceTex: WebGLTexture;
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>();
  private target: Target | null = null;
  private readonly freeBuffers: WebGLBuffer[] = [];
  private disposed = false;

  constructor(gl: WebGL2RenderingContext, options: WebGL2PreprocessorOptions = {}) {
    this.gl = gl;
    this.kernelSize = options.kernelSize ?? 2;
    this.thresholdConstant = options.thresholdConstant ?? 7;

    if (this.kernelSize < 0 || this.kernelSize >= stackBoxBlurMult.length) {
      throw new RangeError(`kernelSize must be between 0 and ${stackBoxBlurMult.length - 1}`);
    }

    this.greyProgram = this.createProgram(GREY_SHADER);
    this.blurProgram = this.createProgram(BLUR_H_SHADER);
    this.thresholdProgram = this.createProgram(THRESHOLD_SHADER);
    this.vao = gl.createVertexArray();
    this.sourceTex = gl.createTexture();
  }

  /** Creates a preprocessor with its own offscreen WebGL2 context. */
  static create(options: WebGL2PreprocessorOptions = {}): WebGL2Preprocessor {
    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(1, 1)
        : document.createElement("canvas");
    const gl = canvas.getContext("webgl2", {
      antialias: false,
      depth: false,
      stencil: false,
      alpha: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    }) as WebGL2RenderingContext | null;
    if (!gl) {
      throw new Error("WebGL2 is not available");
    }
    return new WebGL2Preprocessor(gl, options);
  }

  /**
   * Processes a frame and resolves once the results are on the CPU. The GPU work is queued
   * immediately; the readback does not block the main thread.
   */
  async process(source: FrameSource, out?: PreprocessResult): Promise<PreprocessResult> {
    const { buffer, target, fence } = this.render(source);
    const gl = this.gl;

    try {
      await this.waitForFence(fence);
      return this.readBuffer(buffer, target, out);
    } finally {
      gl.deleteSync(fence);
      this.freeBuffers.push(buffer);
    }
  }

  /** Processes a frame and reads the results back synchronously (stalls the GPU pipeline). */
  processSync(source: FrameSource, out?: PreprocessResult): PreprocessResult {
    const { buffer, target, fence } = this.render(source);
    this.gl.deleteSync(fence);
    try {
      return this.readBuffer(buffer, target, out);
    } finally {
      this.freeBuffers.push(buffer);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    this.deleteTarget();
    for (const buffer of this.freeBuffers) gl.deleteBuffer(buffer);
    gl.deleteTexture(this.sourceTex);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.greyProgram);
    gl.deleteProgram(this.blurProgram);
    gl.deleteProgram(this.thresholdProgram);
  }

  private render(source: FrameSource): { buffer: WebGLBuffer; target: Target; fence: WebGLSync } {
    if (this.disposed) throw new Error("WebGL2Preprocessor has been disposed");

    const gl = this.gl;
    const restore = saveState(gl);

    try {
      let width: number;
      let height: number;
      let inputTex: WebGLTexture;
      let flipY = false;

      gl.activeTexture(gl.TEXTURE0);
      if (isTextureSource(source)) {
        ({ width, height } = source);
        inputTex = source.texture;
        flipY = source.flipY ?? false;
        gl.bindTexture(gl.TEXTURE_2D, inputTex);
      } else {
        [width, height] = sourceSize(source);
        inputTex = this.sourceTex;
        gl.bindTexture(gl.TEXTURE_2D, inputTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
        setNearest(gl);
      }

      if (width <= 0 || height <= 0) {
        throw new Error("Frame source has no size yet");
      }

      // Creating the targets binds textures, so (re)bind the input afterwards.
      const target = this.ensureTarget(width, height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, inputTex);

      gl.bindVertexArray(this.vao);
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.STENCIL_TEST);
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.CULL_FACE);
      gl.colorMask(true, true, true, true);

      // Pass 1: greyscale
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.greyFbo);
      gl.viewport(0, 0, width, height);
      gl.useProgram(this.greyProgram);
      gl.uniform1i(this.uniform(this.greyProgram, "uSource"), 0);
      gl.uniform1i(this.uniform(this.greyProgram, "uFlipY"), flipY ? 1 : 0);
      gl.uniform1i(this.uniform(this.greyProgram, "uHeight"), height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      const mult = stackBoxBlurMult[this.kernelSize];
      const shift = stackBoxBlurShift[this.kernelSize];

      // Pass 2: horizontal blur
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.blurFbo);
      gl.useProgram(this.blurProgram);
      gl.bindTexture(gl.TEXTURE_2D, target.greyTex);
      gl.uniform1i(this.uniform(this.blurProgram, "uGrey"), 0);
      gl.uniform1i(this.uniform(this.blurProgram, "uKernel"), this.kernelSize);
      gl.uniform1ui(this.uniform(this.blurProgram, "uMult"), mult);
      gl.uniform1ui(this.uniform(this.blurProgram, "uShift"), shift);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Pass 3: vertical blur, threshold, pack 4 pixels per texel
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.packedFbo);
      gl.viewport(0, 0, target.packedWidth, height);
      gl.useProgram(this.thresholdProgram);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, target.blurTex);
      gl.uniform1i(this.uniform(this.thresholdProgram, "uGrey"), 0);
      gl.uniform1i(this.uniform(this.thresholdProgram, "uBlurH"), 1);
      gl.uniform1i(this.uniform(this.thresholdProgram, "uKernel"), this.kernelSize);
      gl.uniform1ui(this.uniform(this.thresholdProgram, "uMult"), mult);
      gl.uniform1ui(this.uniform(this.thresholdProgram, "uShift"), shift);
      gl.uniform1i(this.uniform(this.thresholdProgram, "uThreshold"), this.thresholdConstant);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Readback into a pixel buffer: grey rows first, then mask rows.
      const bytes = target.packedWidth * 4 * height;
      const buffer = this.freeBuffers.pop() ?? gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes * 2, gl.STREAM_READ);
      gl.pixelStorei(gl.PACK_ALIGNMENT, 4);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.readPixels(0, 0, target.packedWidth, height, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      gl.readBuffer(gl.COLOR_ATTACHMENT1);
      gl.readPixels(0, 0, target.packedWidth, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);

      const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (!fence) throw new Error("fenceSync failed");
      gl.flush();

      return { buffer, target, fence };
    } finally {
      restore();
    }
  }

  private readBuffer(
    buffer: WebGLBuffer,
    target: Target,
    out?: PreprocessResult,
  ): PreprocessResult {
    const gl = this.gl;
    const { width, height, packedWidth } = target;
    const result: PreprocessResult = out ?? { grey: new Image(), thresholded: new Image() };
    const grey = result.grey.resize(width, height);
    const mask = result.thresholded.resize(width, height);
    const rowBytes = packedWidth * 4;
    const bytes = rowBytes * height;
    const previous = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING) as WebGLBuffer | null;

    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
    if (rowBytes === width) {
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, grey.data, 0, bytes);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, bytes, mask.data, 0, bytes);
    } else {
      const tmp = new Uint8Array(bytes * 2);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, tmp);
      for (let y = 0; y < height; ++y) {
        grey.data.set(tmp.subarray(y * rowBytes, y * rowBytes + width), y * width);
        mask.data.set(tmp.subarray(bytes + y * rowBytes, bytes + y * rowBytes + width), y * width);
      }
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, previous);

    return result;
  }

  private waitForFence(fence: WebGLSync): Promise<void> {
    const gl = this.gl;
    return new Promise((resolve, reject) => {
      const poll = () => {
        const status = gl.clientWaitSync(fence, 0, 0);
        if (status === gl.WAIT_FAILED) {
          reject(new Error("clientWaitSync failed"));
        } else if (status === gl.TIMEOUT_EXPIRED) {
          setTimeout(poll, 1);
        } else {
          resolve();
        }
      };
      poll();
    });
  }

  private ensureTarget(width: number, height: number): Target {
    const t = this.target;
    if (t && t.width === width && t.height === height) return t;
    this.deleteTarget();

    const gl = this.gl;
    const packedWidth = Math.ceil(width / 4);
    const greyTex = this.createTexture(gl.R8UI, width, height);
    const blurTex = this.createTexture(gl.R8UI, width, height);
    const packedGreyTex = this.createTexture(gl.RGBA8, packedWidth, height);
    const packedMaskTex = this.createTexture(gl.RGBA8, packedWidth, height);

    const greyFbo = this.createFramebuffer([greyTex]);
    const blurFbo = this.createFramebuffer([blurTex]);
    const packedFbo = this.createFramebuffer([packedGreyTex, packedMaskTex]);

    this.target = {
      width,
      height,
      packedWidth,
      greyTex,
      blurTex,
      packedGreyTex,
      packedMaskTex,
      greyFbo,
      blurFbo,
      packedFbo,
    };
    return this.target;
  }

  private deleteTarget(): void {
    const t = this.target;
    if (!t) return;
    const gl = this.gl;
    for (const tex of [t.greyTex, t.blurTex, t.packedGreyTex, t.packedMaskTex]) {
      gl.deleteTexture(tex);
    }
    for (const fbo of [t.greyFbo, t.blurFbo, t.packedFbo]) {
      gl.deleteFramebuffer(fbo);
    }
    this.target = null;
  }

  private createTexture(format: GLenum, width: number, height: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height);
    setNearest(gl);
    return tex;
  }

  private createFramebuffer(textures: WebGLTexture[]): WebGLFramebuffer {
    const gl = this.gl;
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const attachments = textures.map((tex, i) => {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, tex, 0);
      return gl.COLOR_ATTACHMENT0 + i;
    });
    gl.drawBuffers(attachments);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`Framebuffer incomplete: 0x${status.toString(16)}`);
    }
    return fbo;
  }

  private createProgram(fragmentSource: string): WebGLProgram {
    const gl = this.gl;
    const program = gl.createProgram();
    for (const [type, source] of [
      [gl.VERTEX_SHADER, VERTEX_SHADER],
      [gl.FRAGMENT_SHADER, fragmentSource],
    ] as const) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("createShader failed");
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`Shader compile error: ${gl.getShaderInfoLog(shader)}`);
      }
      gl.attachShader(program, shader);
      gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program link error: ${gl.getProgramInfoLog(program)}`);
    }
    return program;
  }

  private uniform(program: WebGLProgram, name: string): WebGLUniformLocation | null {
    const key = `${this.programKey(program)}:${name}`;
    if (!this.uniforms.has(key)) {
      this.uniforms.set(key, this.gl.getUniformLocation(program, name));
    }
    return this.uniforms.get(key) ?? null;
  }

  private programKey(program: WebGLProgram): string {
    return program === this.greyProgram ? "g" : program === this.blurProgram ? "b" : "t";
  }
}

function setNearest(gl: WebGL2RenderingContext): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

/** Saves the GL state the preprocessor changes and returns a function that restores it. */
function saveState(gl: WebGL2RenderingContext): () => void {
  const enabled = [gl.BLEND, gl.DEPTH_TEST, gl.STENCIL_TEST, gl.SCISSOR_TEST, gl.CULL_FACE].map(
    (cap) => [cap, gl.isEnabled(cap)] as const,
  );
  const framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  const readFramebuffer = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
  const viewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
  const program = gl.getParameter(gl.CURRENT_PROGRAM);
  const vao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
  const activeTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
  gl.activeTexture(gl.TEXTURE0);
  const tex0 = gl.getParameter(gl.TEXTURE_BINDING_2D);
  gl.activeTexture(gl.TEXTURE1);
  const tex1 = gl.getParameter(gl.TEXTURE_BINDING_2D);
  const packBuffer = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
  const colorMask = gl.getParameter(gl.COLOR_WRITEMASK) as boolean[];
  const unpackFlipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
  const unpackPremultiply = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
  const unpackColorspace = gl.getParameter(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL);
  const unpackAlignment = gl.getParameter(gl.UNPACK_ALIGNMENT);
  const packAlignment = gl.getParameter(gl.PACK_ALIGNMENT);

  return () => {
    for (const [cap, on] of enabled) {
      if (on) gl.enable(cap);
      else gl.disable(cap);
    }
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFramebuffer);
    gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tex1);
    gl.activeTexture(activeTexture);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, packBuffer);
    gl.colorMask(colorMask[0], colorMask[1], colorMask[2], colorMask[3]);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, unpackFlipY);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, unpackPremultiply);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, unpackColorspace);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, unpackAlignment);
    gl.pixelStorei(gl.PACK_ALIGNMENT, packAlignment);
  };
}
