import QRCode from "qrcode";
import { DEFAULT_MARKER_ID, REPO_URL } from "./common/config.js";
import { drawMarker, markerSvg } from "./common/marker-code.js";

const id = DEFAULT_MARKER_ID;
const markerUrl = new URL(`marker.html?id=${id}`, location.href).href;

const qr = document.querySelector<HTMLCanvasElement>("#qr")!;
void QRCode.toCanvas(qr, markerUrl, { width: 440, margin: 2, errorCorrectionLevel: "M" }).then(
  () => {
    qr.style.width = "220px";
    qr.style.height = "220px";
  },
);

const link = document.querySelector<HTMLAnchorElement>("#marker-link")!;
link.href = markerUrl;

const preview = document.querySelector<HTMLCanvasElement>("#preview")!;
preview.width = 450;
preview.height = 450;
drawMarker(preview.getContext("2d")!, id, 0, 0, 450, 1);
document.querySelector("#marker-id")!.textContent = String(id);

const svg = document.querySelector<HTMLAnchorElement>("#marker-svg")!;
svg.href = URL.createObjectURL(new Blob([markerSvg(id)], { type: "image/svg+xml" }));
svg.download = `aruco-marker-${id}.svg`;

document.querySelector<HTMLAnchorElement>("#repo")!.href = REPO_URL;

if (!("gpu" in navigator)) {
  document.body.classList.add("no-webgpu");
  document.querySelector("#webgpu-note")!.textContent =
    "This browser has no WebGPU, so the Babylon Lite demo will not start here.";
}
