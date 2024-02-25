import { Detector } from '../../src/aruco.ts';
import { CVContour, CVImage, otsu, threshold, warp } from '../../src/cv.ts';

let camera: HTMLVideoElement;
let canvas: HTMLCanvasElement;
let context: CanvasRenderingContext2D;
let imageData: ImageData;
let detector: Detector;

let debugImage: ImageData;
let warpImage: ImageData;
let homographyImage: any;

export function onLoad() {
  camera = document.getElementById("video") as HTMLVideoElement;
  canvas = document.getElementById("canvas") as HTMLCanvasElement;
  context = canvas!.getContext("2d")!;

  camera.width = 320;
  camera.height = 240;

  canvas.width = parseInt(canvas.style.width);
  canvas.height = parseInt(canvas.style.height);

  navigator.mediaDevices
    .getUserMedia({ video: true })
    .then((stream) => {
      camera.srcObject = stream;
    })
    .catch(function (err) {
      console.log(err.name + ": " + err.message);
    }
    );

  imageData = context.getImageData(0, 0, camera.width, camera.height);
  detector = new Detector();

  debugImage = context.createImageData(camera.width, camera.height);
  warpImage = context.createImageData(49, 49);
  homographyImage = new CVImage();

  requestAnimationFrame(tick);
}

function tick() {
  requestAnimationFrame(tick);

  if (camera.readyState === camera.HAVE_ENOUGH_DATA) {
    snapshot();

    var markers = detector.detect(imageData as any as CVImage);
    drawDebug();
    drawCorners(markers);
    drawId(markers);
  }
}

function snapshot() {
  context.drawImage(camera, 0, 0, camera.width, camera.height);
  imageData = context.getImageData(0, 0, camera.width, camera.height);
}

function drawDebug() {
  var width = camera.width, height = camera.height;

  context.clearRect(0, 0, canvas.width, canvas.height);

  context.putImageData(imageData, 0, 0);
  context.putImageData(createImage(detector.grey, debugImage), width, 0);
  context.putImageData(createImage(detector.thres, debugImage), width * 2, 0);

  drawContours(detector.contours, 0, height, function (hole: any) { return hole ? "magenta" : "blue"; });
  drawContours(detector.polys, width, height, function () { return "green"; });
  drawContours(detector.candidates, width * 2, height, function () { return "red"; });

  drawWarps(detector.grey, detector.candidates, height * 2 + 20);
}

function drawContours(contours: CVContour[], x: number, y: number, fn: any) {
  var i = contours.length, j, contour, point;

  while (i--) {
    contour = contours[i];

    context.strokeStyle = fn(contour.hole);
    context.beginPath();

    for (j = 0; j < contour.points?.length; ++j) {
      point = contour.points[j];
      context.moveTo(x + point.x, y + point.y);
      point = contour.points[(j + 1) % contour.points.length];
      context.lineTo(x + point.x, y + point.y);
    }

    context.stroke();
    context.closePath();
  }
}

function drawWarps(imageSrc: any, contours: any, y: number) {
  var i = contours.length, contour;

  var offset = (canvas.width - ((warpImage.width + 10) * contours.length)) / 2
  while (i--) {
    contour = contours[i];

    warp(imageSrc, homographyImage, contour, warpImage.width);
    context.putImageData(createImage(homographyImage, warpImage), offset + i * (warpImage.width + 10), y);

    threshold(homographyImage, homographyImage, otsu(homographyImage));
    context.putImageData(createImage(homographyImage, warpImage), offset + i * (warpImage.width + 10), y + 60);
  }
}

function drawCorners(markers: any) {
  var corners, corner, i, j;

  context.lineWidth = 3;

  for (i = 0; i !== markers.length; ++i) {
    corners = markers[i].corners;

    context.strokeStyle = "red";
    context.beginPath();

    for (j = 0; j !== corners.length; ++j) {
      corner = corners[j];
      context.moveTo(corner.x, corner.y);
      corner = corners[(j + 1) % corners.length];
      context.lineTo(corner.x, corner.y);
    }

    context.stroke();
    context.closePath();

    context.strokeStyle = "green";
    context.strokeRect(corners[0].x - 2, corners[0].y - 2, 4, 4);
  }
}

function drawId(markers: any) {
  var corners, corner, x, y, i, j;

  context.strokeStyle = "blue";
  context.lineWidth = 1;

  for (i = 0; i !== markers.length; ++i) {
    corners = markers[i].corners;

    x = Infinity;
    y = Infinity;

    for (j = 0; j !== corners.length; ++j) {
      corner = corners[j];

      x = Math.min(x, corner.x);
      y = Math.min(y, corner.y);
    }

    context.strokeText(markers[i].id, x, y)
  }
}

function createImage(src: any, dst: any) {
  var i = src.data.length, j = (i * 4) + 3;

  while (i--) {
    dst.data[j -= 4] = 255;
    dst.data[j - 1] = dst.data[j - 2] = dst.data[j - 3] = src.data[i];
  }

  return dst;
};


window.onload = onLoad;
