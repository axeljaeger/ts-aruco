# ts-aruco

TypeScript port of [js-aruco](https://github.com/jcmellado/js-aruco) by Juan Mellado: ArUco
marker detection and coplanar POSIT pose estimation, without dependencies.

The port produces exactly the same results as the original js-aruco (checked by tests against
the original scripts in `reference/js-aruco/`) and is about 30% faster on the CPU thanks to typed
arrays and reused buffers.

## Usage

```ts
import { Detector, Posit, estimatePose, poseToMatrix } from "ts-aruco";

const detector = new Detector(); // optional: new Detector({ adaptiveThresholdConstant: 7, ... })
const markers = detector.detect(imageData); // any { width, height, data } RGBA image

const posit = new Posit(markerSizeInMillimeters, canvas.width); // focal length in pixels
for (const marker of markers) {
  const pose = estimatePose(posit, marker, canvas.width, canvas.height);
  const matrix = poseToMatrix(pose.bestRotation, pose.bestTranslation, "right");
  // three.js:   object.matrix.fromArray(matrix)
  // Babylon.js: Matrix.FromArray(matrix) (use "left" unless useRightHandedSystem is set)
}
```

`marker.id` is the marker id (0-1023), `marker.corners` the four image corners, clockwise
starting at the marker's top-left corner.

`poseToMatrix` returns a camera-space model matrix. Give your 3D camera the same focal length,
e.g. `camera.fov = verticalFieldOfView(canvas.width, canvas.height)` (radians).

### Detector options

| Option | Default | Meaning |
| --- | --- | --- |
| `adaptiveThresholdKernelSize` | 2 | Blur radius of the adaptive threshold |
| `adaptiveThresholdConstant` | 7 | How much darker than its surroundings a pixel must be |
| `minContourLengthRatio` | 0.2 | Minimum contour length as a fraction of the image width |
| `polygonEpsilonRatio` | 0.05 | Polygon approximation accuracy |
| `minEdgeLength` | 10 | Minimum marker edge length in pixels |
| `minCornerDistance` | 10 | Candidates closer than this are merged |
| `warpSize` | 49 | Size of the rectified marker image |
| `compensateShading` | false | Re-read failed candidates relative to the local black level |

Glare on a phone screen lifts the grey level of one part of the marker, so a global threshold
reads its black cells as white. For such scenes use a wider threshold window and
`compensateShading`: when the normal bit reading finds no valid code, each cell is compared with
the black border cells near it. The demos use `adaptiveThresholdKernelSize: 5` (also the
preprocessors' `kernelSize`) together with `compensateShading: true`. The defaults keep the
results identical to the original js-aruco.

`detector.detectPreprocessed(grey, thresholded)` skips greyscale conversion and thresholding,
for callers that compute those elsewhere (e.g. on the GPU).

### Choosing a backend automatically

`createPreprocessor()` picks the first backend that works: WebGPU, then WebGL2, then the CPU.
The GPU backends are loaded on demand. Pass a renderer's device or context to share it:

```ts
import { createPreprocessor, Detector } from "ts-aruco";

const pre = await createPreprocessor({ device: rendererDevice, gl: rendererGl });
console.log(pre.backend); // "webgpu" | "webgl2" | "cpu"
const { grey, thresholded } = await pre.process(video);
const markers = new Detector().detectPreprocessed(grey, thresholded);
```

`backends: ["webgl2", "cpu"]` restricts or reorders the choice.

### GPU preprocessing (WebGL2)

Greyscale conversion, blur and adaptive threshold can run on the GPU. The camera frame is
uploaded as a texture (or an existing texture of the same context is used), and only the
results are read back:

```ts
import { Detector } from "ts-aruco";
import { WebGL2Preprocessor } from "ts-aruco/webgl2";

const gpu = WebGL2Preprocessor.create(); // or new WebGL2Preprocessor(renderer.getContext())
const detector = new Detector();

video.requestVideoFrameCallback(async function frame() {
  const { grey, thresholded } = await gpu.process(video); // async readback, no GPU stall
  const markers = detector.detectPreprocessed(grey, thresholded);
  video.requestVideoFrameCallback(frame);
});
```

Blur and threshold match the CPU version bit for bit. The integer greyscale conversion can be
1 lower than the original's floating point result for about 0.02% of colours. Browser tests
compare both paths on synthetic images. `samples/webgl2-detector/` shows both paths side by
side with timings and has a synthetic benchmark (`npm run dev:samples`, then open
`http://127.0.0.1:4173/samples/webgl2-detector/`).

### GPU preprocessing (WebGPU)

The same pipeline as compute shaders. Videos are imported as external textures without a copy,
results come back through `mapAsync`:

```ts
import { WebGPUPreprocessor } from "ts-aruco/webgpu";

const gpu = await WebGPUPreprocessor.create(); // or new WebGPUPreprocessor(engineDevice)
const { grey, thresholded } = await gpu.process(video);
const markers = detector.detectPreprocessed(grey, thresholded);
```

Measured on an Apple M4 (Chrome), from submit to data on the CPU: 1.5 ms at 640x480,
1.6 ms at 1280x720, 2.9 ms at 1920x1080. The CPU path needs 1.9, 6.0 and 13.0 ms for the
same steps, plus `getImageData`.

If the browser cannot import a video as an external texture, the preprocessor copies the frame
instead, and as a last resort reads it through a 2D canvas (seen with software adapters).

### Compatibility with js-aruco

`AR.Detector`, `AR.Marker`, `POS.Posit` (posit1) and `POS2.Posit` (posit2) keep the original
names. `Posit.pose()` still expects corners centered on the image with y pointing up;
`centerCorners()` does that conversion.

## Markers

A 7x7 grid with a black border. The inner 5x5 cells carry the id; each row must be one of:

```
white - black - black - black - black
white - black - white - white - white
black - white - black - black - white
black - white - white - white - black
```

## Demo site

`site/` is a small Vite site that GitHub Pages publishes on every push to `master`
(`.github/workflows/pages.yml`):

- a landing page with a QR code that opens `marker.html` on a phone (full screen, rotation lock
  where the browser allows it, screen wake lock),
- AR demos for three.js (WebGPURenderer with WebGL2 fallback), Babylon.js (WebGPU engine with
  WebGL2 fallback) and Babylon Lite (WebGPU): a small plane sits on the marker and leaves a smoke
  trail when you move it,
- the original js-aruco samples from `reference/js-aruco/samples/`.

The demos take `?mode=webgpu|webgl2|cpu` for the preprocessing and `?renderer=webgl2` to force
the WebGL2 renderer. The plane is generated by `scripts/make-airplane.mjs` (no third-party art).

```sh
npm run site:dev    # http://localhost:5173/
npm run site:build  # writes site-dist/
```

Publishing needs **Settings → Pages → Source** set to **GitHub Actions**.

## Development

```sh
npm install
npm test          # unit and reference tests (Vitest)
npm run test:e2e  # browser tests (Playwright)
npm run bench     # CPU benchmark, port vs. original
npm run check     # Biome + type checks
```

CI (`.github/workflows/ci.yml`) runs lint and type checks, unit tests on Node 22 and 24, the
library and site builds and the browser tests on every push and pull request. Dependabot
(`.github/dependabot.yml`) proposes weekly updates for npm packages and GitHub Actions.

Playwright screenshots are stored per platform. In environments with a preinstalled Chromium,
set `PW_CHROMIUM_PATH`.

The original js-aruco sources live once in `reference/js-aruco/src/`; the reference tests and the
original samples in `reference/js-aruco/samples/` both load them from there. The Flash webcam
sample of the original was dropped, no browser runs Flash any more.

## License

MIT (original js-aruco), see `LICENSE.txt`.
