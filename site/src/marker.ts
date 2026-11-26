import { DEFAULT_MARKER_ID } from "./common/config.js";
import { drawMarker, MAX_MARKER_ID } from "./common/marker-code.js";

const canvas = document.querySelector<HTMLCanvasElement>("#marker")!;
const panel = document.querySelector<HTMLElement>("#panel")!;
const start = document.querySelector<HTMLButtonElement>("#start")!;
const idLabel = document.querySelector<HTMLElement>("#id")!;
const params = new URLSearchParams(location.search);

let id = clampId(Number(params.get("id") ?? DEFAULT_MARKER_ID));

function clampId(n: number): number {
  return Number.isInteger(n) && n >= 0 && n <= MAX_MARKER_ID ? n : DEFAULT_MARKER_ID;
}

/** Draws the marker as large as the screen allows, pixel aligned. */
function draw(): void {
  const dpr = window.devicePixelRatio || 1;
  const css = Math.floor(Math.min(window.innerWidth, window.innerHeight) * 0.92);
  const cells = 9; // 7 marker cells plus one white cell of quiet zone on each side.
  const px = Math.floor((css * dpr) / cells) * cells;
  canvas.width = px;
  canvas.height = px;
  canvas.style.width = `${px / dpr}px`;
  canvas.style.height = `${px / dpr}px`;
  drawMarker(canvas.getContext("2d")!, id, 0, 0, px, 1);
  idLabel.textContent = String(id);
}

function setId(next: number): void {
  id = (next + MAX_MARKER_ID + 1) % (MAX_MARKER_ID + 1);
  params.set("id", String(id));
  history.replaceState(null, "", `?${params}`);
  draw();
}

async function keepAwake(): Promise<void> {
  try {
    await navigator.wakeLock?.request("screen");
  } catch {
    // No wake lock (old browser, or denied): the display may dim, nothing else breaks.
  }
}

document.addEventListener("visibilitychange", () => {
  // The browser drops the wake lock when the page is hidden; take it again while presenting.
  if (document.visibilityState === "visible" && panel.hidden) {
    void keepAwake();
  }
});

type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type LockableOrientation = ScreenOrientation & { lock?: (o: string) => Promise<void> };

async function present(): Promise<void> {
  const root = document.documentElement as FullscreenElement;
  try {
    if (root.requestFullscreen) {
      await root.requestFullscreen({ navigationUI: "hide" });
    } else {
      await root.webkitRequestFullscreen?.();
    }
  } catch {
    // Not allowed here (e.g. iPhone Safari); the hint in the panel explains the alternatives.
  }
  try {
    // Only works while full screen, and only on browsers that support it (mostly Android).
    await (screen.orientation as LockableOrientation | undefined)?.lock?.("portrait");
  } catch {
    // Ignored: the marker is square and centred, so a rotation only moves the panel.
  }
  await keepAwake();
  panel.hidden = true;
}

start.addEventListener("click", () => void present());
canvas.addEventListener("click", () => {
  panel.hidden = !panel.hidden;
});
document.querySelector("#prev")!.addEventListener("click", () => setId(id - 1));
document.querySelector("#next")!.addEventListener("click", () => setId(id + 1));
window.addEventListener("resize", draw);

const isIOS =
  /iP(hone|od|ad)/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const canFullscreen = document.fullscreenEnabled || "webkitFullscreenEnabled" in document;
if (isIOS || !canFullscreen) {
  document.documentElement.classList.add("ios");
}
// Already started from the home screen: no browser chrome to get rid of.
if (matchMedia("(display-mode: fullscreen), (display-mode: standalone)").matches) {
  start.textContent = "Keep display on";
}

draw();
