import { verticalFieldOfView } from "ts-aruco";
import { Flight, type FlightFrame } from "./flight.js";
import { MODE_LABELS, type Mode, Tracker } from "./tracker.js";

const ALL_MODES: readonly Mode[] = ["webgpu", "webgl2", "cpu"];

export interface DemoRenderer {
  /** Creates the engine on `canvas`. May throw with a user readable message. */
  init(canvas: HTMLCanvasElement): Promise<void>;
  /** Called when the stage changes size. `fovY` is in radians. */
  resize(width: number, height: number, fovY: number): void;
  /** Starts the render loop. `frame(dtMs)` advances the demo and returns what to draw. */
  start(frame: (dtMs: number) => FlightFrame): void;
  /** "WebGPU" or "WebGL2", for the stats line. Known after `init()`. */
  readonly backend: string;
  /** The renderer's own WebGL2 context, shared with the WebGL2 preprocessor when available. */
  readonly gl?: WebGL2RenderingContext | undefined;
  /** The renderer's own WebGPU device, shared with the WebGPU preprocessor when available. */
  readonly device?: GPUDevice | undefined;
}

interface Elements {
  stage: HTMLElement;
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  overlay: HTMLCanvasElement;
  stats: HTMLElement;
  message: HTMLElement;
  mode: HTMLSelectElement;
  mirror: HTMLInputElement;
  outline: HTMLInputElement;
  mask: HTMLInputElement;
  flip: HTMLButtonElement;
}

function elements(): Elements {
  const q = <T extends HTMLElement>(sel: string) => {
    const el = document.querySelector<T>(sel);
    if (!el) throw new Error(`missing ${sel}`);
    return el;
  };
  return {
    stage: q("#stage"),
    video: q("#video"),
    canvas: q("#canvas"),
    overlay: q("#overlay"),
    stats: q("#stats"),
    message: q("#message"),
    mode: q("#mode"),
    mirror: q("#mirror"),
    outline: q("#outline"),
    mask: q("#mask"),
    flip: q("#flip"),
  };
}

function showMessage(el: HTMLElement, html: string): void {
  el.innerHTML = html;
  el.hidden = false;
}

/** `?renderer=webgl2` makes the demos with a WebGL2 fallback use it even when WebGPU works. */
export function forceWebGL(): boolean {
  return new URLSearchParams(location.search).get("renderer") === "webgl2";
}

/** Wires camera, tracker, airplane logic and a renderer into a demo page. */
export async function runDemo(renderer: DemoRenderer): Promise<void> {
  const el = elements();
  const params = new URLSearchParams(location.search);
  const requested = params.get("mode") as Mode | null;
  const modes: readonly Mode[] =
    requested && ALL_MODES.includes(requested) ? [requested] : ALL_MODES;

  const auto = document.createElement("option");
  auto.value = "";
  auto.textContent = "Preprocessing: best available";
  el.mode.append(auto);
  for (const m of ALL_MODES) {
    const option = document.createElement("option");
    option.value = m;
    option.textContent = `Preprocessing: ${MODE_LABELS[m]}`;
    el.mode.append(option);
  }
  el.mode.value = requested ?? "";
  el.mode.addEventListener("change", () => {
    if (el.mode.value) params.set("mode", el.mode.value);
    else params.delete("mode");
    location.search = params.toString();
  });

  let facing: "user" | "environment" =
    params.get("camera") === "environment" ? "environment" : "user";
  el.mirror.checked = params.has("mirror") ? params.get("mirror") !== "0" : facing === "user";
  const applyMirror = () => el.stage.classList.toggle("mirrored", el.mirror.checked);
  el.mirror.addEventListener("change", applyMirror);
  applyMirror();

  try {
    await renderer.init(el.canvas);
  } catch (e) {
    showMessage(el.message, `Could not start the renderer: ${(e as Error).message}`);
    throw e;
  }

  let tracker: Tracker;
  try {
    tracker = await Tracker.create({ modes, gl: renderer.gl, device: renderer.device });
  } catch (e) {
    showMessage(el.message, `Could not start the preprocessing: ${(e as Error).message}`);
    throw e;
  }

  const startCamera = async () => {
    const old = el.video.srcObject as MediaStream | null;
    for (const track of old?.getTracks() ?? []) track.stop();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    el.video.srcObject = stream;
    await el.video.play();
  };

  try {
    await startCamera();
  } catch (e) {
    showMessage(
      el.message,
      `No camera: ${(e as Error).message}.<br>The demo needs camera access (and HTTPS or localhost).`,
    );
    throw e;
  }

  el.flip.addEventListener("click", async () => {
    facing = facing === "user" ? "environment" : "user";
    el.mirror.checked = facing === "user";
    applyMirror();
    await startCamera().catch((e) =>
      showMessage(el.message, `Camera switch failed: ${(e as Error).message}`),
    );
  });

  // Fit the stage to the window while keeping the video's aspect ratio.
  const layout = () => {
    const vw = el.video.videoWidth || 1280;
    const vh = el.video.videoHeight || 720;
    const scale = Math.min(window.innerWidth / vw, window.innerHeight / vh);
    const w = Math.round(vw * scale);
    const h = Math.round(vh * scale);
    el.stage.style.width = `${w}px`;
    el.stage.style.height = `${h}px`;
    el.overlay.width = w;
    el.overlay.height = h;
    renderer.resize(w, h, verticalFieldOfView(vw, vh));
  };
  window.addEventListener("resize", layout);
  el.video.addEventListener("resize", layout);
  layout();

  const mode = tracker.mode;
  const shared = (mode === "webgpu" && renderer.device) || (mode === "webgl2" && renderer.gl);
  const rendererInfo = `renderer ${renderer.backend}${shared ? ", shared GPU device" : ""}`;
  const flight = new Flight();
  const overlay = el.overlay.getContext("2d")!;
  let detections = 0;
  let lastStats = performance.now();
  let preMs = 0;
  let detMs = 0;
  let latencyMs = 0;
  let latencyExact = false;

  const detectLoop = async () => {
    for (;;) {
      const frame = await nextVideoFrame(el.video);
      if (el.video.readyState < 2) continue;
      try {
        const result = await tracker.track(el.video);
        flight.update(result.poses);
        preMs += result.preprocessMs;
        detMs += result.detectMs;
        latencyMs += performance.now() - frame.captured;
        latencyExact = frame.exact;
        ++detections;

        overlay.clearRect(0, 0, el.overlay.width, el.overlay.height);
        if (el.mask.checked) {
          Tracker.drawMask(overlay, result.thresholded);
        }
        if (el.outline.checked) {
          Tracker.drawOutlines(overlay, result.markers, el.overlay.width / result.width);
        }

        const now = performance.now();
        if (now - lastStats > 500) {
          const n = Math.max(1, detections);
          el.stats.textContent =
            `${MODE_LABELS[mode]} preprocessing (${rendererInfo}) · ${result.width}×${result.height} · ` +
            `${((detections * 1000) / (now - lastStats)).toFixed(0)} detections/s · ` +
            `preprocess ${(preMs / n).toFixed(1)} ms · contours+POSIT ${(detMs / n).toFixed(1)} ms · ` +
            `${latencyExact ? "camera" : "frame"}→pose ${(latencyMs / n).toFixed(0)} ms · ` +
            `${result.markers.length ? `marker ${result.markers.map((m) => m.id).join(", ")}` : "no marker"}`;
          detections = 0;
          preMs = 0;
          detMs = 0;
          latencyMs = 0;
          lastStats = now;
        }
      } catch (e) {
        console.error(e);
        showMessage(el.message, `Tracking failed: ${(e as Error).message}`);
        return;
      }
    }
  };
  void detectLoop();

  renderer.start((dt) => flight.step(dt));
}

/**
 * Waits for the next video frame. Resolves with the frame's capture time (performance.now()
 * clock) when the browser reports one, else with the time the frame was handed to the page.
 */
function nextVideoFrame(video: HTMLVideoElement): Promise<{ captured: number; exact: boolean }> {
  return new Promise((resolve) => {
    if ("requestVideoFrameCallback" in video) {
      video.requestVideoFrameCallback((now, meta) => {
        const captured = meta.captureTime;
        resolve(
          captured !== undefined && captured > 0
            ? { captured, exact: true }
            : { captured: now, exact: false },
        );
      });
    } else {
      requestAnimationFrame((now) => resolve({ captured: now, exact: false }));
    }
  });
}
