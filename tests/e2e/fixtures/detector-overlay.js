import { Detector } from "../../../dist/index.js";

const width = 640;
const height = 480;
const rowPatterns = [
  [1, 0, 0, 0, 0],
  [1, 0, 1, 1, 1],
  [0, 1, 0, 0, 1],
  [0, 1, 1, 1, 0],
];
const scenarios = {
  single: {
    markers: [{ id: 1001, x: 222, y: 138, size: 196 }],
  },
  small: {
    markers: [{ id: 1001, x: 252, y: 168, size: 140 }],
  },
  differentId: {
    markers: [{ id: 37, x: 222, y: 138, size: 196 }],
  },
  double: {
    markers: [
      { id: 1001, x: 92, y: 130, size: 168 },
      { id: 37, x: 390, y: 168, size: 140 },
    ],
  },
  empty: {
    markers: [],
  },
};

const overlay = document.querySelector("#overlay");
const fixtureFrame = document.querySelector("#fixture-frame");
const status = document.querySelector("#status");
const overlayContext = overlay.getContext("2d");
const fixtureContext = fixtureFrame.getContext("2d");
const scenarioName = new URLSearchParams(window.location.search).get("scenario") ?? "single";
const scenario = scenarios[scenarioName];

window.__arucoRegression = {
  ready: false,
  markerIds: [],
  markerCount: 0,
  cameraMocked: false,
  markers: [],
};

function markerRowsFromId(id) {
  const bits = id.toString(2).padStart(10, "0").slice(-10);
  const rows = [];

  for (let i = 0; i < bits.length; i += 2) {
    rows.push(rowPatterns[Number.parseInt(bits.slice(i, i + 2), 2)]);
  }

  return rows;
}

function drawMarker(context, marker) {
  const cellSize = marker.size / 7;
  const rows = markerRowsFromId(marker.id);

  context.fillStyle = "#111111";
  context.fillRect(marker.x, marker.y, marker.size, marker.size);

  context.fillStyle = "#ffffff";
  for (let row = 0; row < rows.length; row += 1) {
    for (let column = 0; column < rows[row].length; column += 1) {
      if (rows[row][column] === 1) {
        context.fillRect(
          marker.x + (column + 1) * cellSize,
          marker.y + (row + 1) * cellSize,
          cellSize,
          cellSize,
        );
      }
    }
  }
}

function drawFixtureFrame(context) {
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  for (const marker of scenario.markers) {
    drawMarker(context, marker);
  }
}

function drawCorners(context, markers) {
  context.lineWidth = 3;

  for (const marker of markers) {
    const corners = marker.corners;

    context.strokeStyle = "red";
    context.beginPath();

    for (let i = 0; i < corners.length; i += 1) {
      let corner = corners[i];
      context.moveTo(corner.x, corner.y);
      corner = corners[(i + 1) % corners.length];
      context.lineTo(corner.x, corner.y);
    }

    context.stroke();
    context.closePath();

    context.strokeStyle = "green";
    context.strokeRect(corners[0].x - 2, corners[0].y - 2, 4, 4);
  }
}

function drawId(context, markers) {
  context.strokeStyle = "blue";
  context.lineWidth = 1;
  context.font = "16px monospace";

  for (const marker of markers) {
    let x = Number.POSITIVE_INFINITY;
    let y = Number.POSITIVE_INFINITY;

    for (const corner of marker.corners) {
      x = Math.min(x, corner.x);
      y = Math.min(y, corner.y);
    }

    context.strokeText(marker.id, x, y);
  }
}

async function mockCameraWithFixtureFrame() {
  if (!navigator.mediaDevices) {
    navigator.mediaDevices = {};
  }

  const stream = fixtureFrame.captureStream(1);
  navigator.mediaDevices.getUserMedia = async () => stream;
  await navigator.mediaDevices.getUserMedia({ video: true });
  window.__arucoRegression.cameraMocked = true;
}

function summarizeMarkers(markers) {
  return markers.map((marker) => ({
    id: marker.id,
    corners: marker.corners.map((corner) => ({
      x: Math.round(corner.x),
      y: Math.round(corner.y),
    })),
  }));
}

async function run() {
  if (!scenario) {
    throw new Error(`Unknown scenario: ${scenarioName}`);
  }

  drawFixtureFrame(fixtureContext);
  await mockCameraWithFixtureFrame();

  overlayContext.drawImage(fixtureFrame, 0, 0);

  const detector = new Detector();
  const imageData = overlayContext.getImageData(0, 0, width, height);
  const markers = detector.detect(imageData).sort((a, b) => a.id - b.id);

  drawCorners(overlayContext, markers);
  drawId(overlayContext, markers);

  window.__arucoRegression.markerIds = markers.map((marker) => marker.id);
  window.__arucoRegression.markerCount = markers.length;
  window.__arucoRegression.markers = summarizeMarkers(markers);
  window.__arucoRegression.ready = true;
  status.textContent = `detected ${markers.map((marker) => marker.id).join(", ")}`;
}

run().catch((error) => {
  window.__arucoRegression.error = error instanceof Error ? error.message : String(error);
  status.textContent = window.__arucoRegression.error;
  throw error;
});
