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

`detector.detectPreprocessed(grey, thresholded)` skips greyscale conversion and thresholding,
for callers that compute those elsewhere (e.g. on the GPU).

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

## Development

```sh
npm install
npm test          # unit and reference tests (Vitest)
npm run test:e2e  # browser tests (Playwright)
npm run bench     # CPU benchmark, port vs. original
npm run check     # Biome + type checks
```

Playwright screenshots are stored per platform. In environments with a preinstalled Chromium,
set `PW_CHROMIUM_PATH`.

The original samples (including the Flash webcam demo) are kept unchanged in `samples/legacy/`.

## License

MIT (original js-aruco), see `LICENSE.txt`.
