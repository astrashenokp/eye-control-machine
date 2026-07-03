import * as THREE from "three";
import { DrawingUtils, FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import {
  LEFT_EYE_BOTTOM,
  LEFT_EYE_INNER,
  LEFT_EYE_OUTER,
  LEFT_EYE_TOP,
  LEFT_IRIS_CENTER,
  RIGHT_EYE_OUTER,
  RIGHT_IRIS_CENTER,
  BlinkSequenceDetector,
  computeGazeX,
  computeGazeY,
  eyeAspectRatio,
  gazeToTurn,
} from "./logic.js?v=3";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";

const SPEED_SCALE = 6.0; // world units per second while driving
const TURN_RATE = 2.2; // radians per second at turn=1.0

// ---------- Three.js scene ----------

const container = document.getElementById("scene-container");
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1f2a);
scene.fog = new THREE.Fog(0x1b1f2a, 20, 70);

const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 200);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setPixelRatio(window.devicePixelRatio);
container.appendChild(renderer.domElement);

function resizeToContainer() {
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
}

window.addEventListener("resize", resizeToContainer);

const hemiLight = new THREE.HemisphereLight(0xbfd9ff, 0x2a2a2a, 1.1);
scene.add(hemiLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(8, 12, 6);
scene.add(dirLight);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(300, 300),
  new THREE.MeshStandardMaterial({ color: 0x2a2f3a })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const grid = new THREE.GridHelper(300, 60, 0x4a5468, 0x36404f);
scene.add(grid);

// ---- vehicle: simple low-poly car so heading is obvious ----
const car = new THREE.Group();

const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6 });
const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 2.4), bodyMat);
body.position.y = 0.45;
car.add(body);

const roof = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.4, 1.2), bodyMat);
roof.position.set(0, 0.9, -0.1);
car.add(roof);

const headlightMat = new THREE.MeshStandardMaterial({ color: 0xffffaa, emissive: 0xffee88 });
for (const x of [-0.5, 0.5]) {
  const headlight = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 12), headlightMat);
  headlight.position.set(x, 0.45, -1.25);
  car.add(headlight);
}

const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.3, 16);
for (const x of [-0.75, 0.75]) {
  for (const z of [-0.8, 0.8]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.35, z);
    car.add(wheel);
  }
}

scene.add(car);

// ---------- vehicle state ----------
//
// Driving is blink-triggered, not gaze-triggered: 2 blinks = go, 3 blinks =
// stop. That way looking around doesn't start/stop the car -- only turning
// (steering left/right) follows gaze while driving.

let heading = 0; // radians
let driving = false;
let estopFlashUntilMs = 0;

function forwardVector() {
  return new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(0, heading, 0));
}

function updateVehicle(turn, dt) {
  const effectiveTurn = driving ? turn : 0;
  heading += effectiveTurn * TURN_RATE * dt;
  car.rotation.y = heading;
  const fwd = forwardVector();
  const forwardSpeed = driving ? SPEED_SCALE : 0;
  car.position.addScaledVector(fwd, forwardSpeed * dt);

  const camOffset = fwd.clone().multiplyScalar(-6).add(new THREE.Vector3(0, 3.2, 0));
  camera.position.lerp(car.position.clone().add(camOffset), 0.08);
  camera.lookAt(car.position.x, car.position.y + 0.6, car.position.z);
}

// ---------- HUD ----------

const hud = document.getElementById("hud");
const hudLine1 = document.getElementById("hud-line1");
const hudLine2 = document.getElementById("hud-line2");

function describeCommand(turn) {
  const base = driving ? "FORWARD" : "PARKED (2 моргання = вперед)";
  if (turn > 0.05) return `${base} + LEFT`;
  if (turn < -0.05) return `${base} + RIGHT`;
  return base;
}

function updateHud({ gazeX, gazeY, turn, noFace }, nowMs) {
  const flashingStop = nowMs < estopFlashUntilMs;
  hud.classList.toggle("estop", flashingStop);
  hud.classList.toggle("no-face", noFace);
  faceCamWrap.classList.toggle("no-face", noFace);
  faceCamLabel.textContent = noFace ? "обличчя не знайдено" : "скан обличчя — очі відслідковуються";

  if (noFace) {
    hudLine1.textContent = "обличчя не знайдено";
    hudLine2.textContent = "command: NO FACE - STOP";
    return;
  }

  hudLine1.textContent = `gaze_x=${gazeX.toFixed(2)} gaze_y=${gazeY.toFixed(2)}`;
  const label = flashingStop ? "EMERGENCY STOP (3 моргання)" : describeCommand(turn);
  hudLine2.textContent = `command: ${label}`;
}

// ---------- face scan overlay ----------

const faceCamWrap = document.getElementById("face-cam");
const faceCamLabel = document.getElementById("face-cam-label");
const overlayCanvas = document.getElementById("face-overlay");
const overlayCtx = overlayCanvas.getContext("2d");
let drawingUtils = null;

function drawPupil(landmark, color) {
  overlayCtx.beginPath();
  overlayCtx.arc(landmark.x * overlayCanvas.width, landmark.y * overlayCanvas.height, 6, 0, Math.PI * 2);
  overlayCtx.fillStyle = color;
  overlayCtx.fill();
  overlayCtx.lineWidth = 2;
  overlayCtx.strokeStyle = "#ffffff";
  overlayCtx.stroke();
}

function resizeOverlayCanvas() {
  overlayCanvas.width = overlayCanvas.clientWidth;
  overlayCanvas.height = overlayCanvas.clientHeight;
}

// The <video> uses object-fit: cover (uniform scale + crop, no distortion),
// but <canvas> has no object-fit -- so before drawing, replicate that same
// crop as a 2D transform. DrawingUtils and drawPupil() both compute raw
// coordinates as landmark * canvas.width/height; this transform maps that
// convention onto the visible (cropped) video instead of the full frame.
function applyCoverTransform(videoW, videoH) {
  const boxW = overlayCanvas.width;
  const boxH = overlayCanvas.height;
  const scale = Math.max(boxW / videoW, boxH / videoH);
  const drawW = videoW * scale;
  const drawH = videoH * scale;
  const offsetX = (boxW - drawW) / 2;
  const offsetY = (boxH - drawH) / 2;
  overlayCtx.setTransform(drawW / boxW, 0, 0, drawH / boxH, offsetX, offsetY);
}

function drawFaceOverlay(faceLandmarksList, videoW, videoH) {
  overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
  if (!overlayCanvas.width || !overlayCanvas.height) return;
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (!faceLandmarksList || faceLandmarksList.length === 0) return;

  if (!drawingUtils) drawingUtils = new DrawingUtils(overlayCtx);
  applyCoverTransform(videoW, videoH);

  for (const landmarks of faceLandmarksList) {
    drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_TESSELATION, {
      color: "#30ff6340",
      lineWidth: 0.5,
    });
    drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, {
      color: "#e8f0ff",
      lineWidth: 1.5,
    });
    drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, { color: "#30ff30", lineWidth: 2 });
    drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW, {
      color: "#30ff30",
      lineWidth: 1.5,
    });
    drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, { color: "#30ff30", lineWidth: 2 });
    drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW, {
      color: "#30ff30",
      lineWidth: 1.5,
    });
    drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS, { color: "#ffd23f", lineWidth: 2 });
    drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS, {
      color: "#ffd23f",
      lineWidth: 2,
    });

    // pupil centers, drawn extra large so they're unmistakable
    drawPupil(landmarks[LEFT_IRIS_CENTER], "#ff4d4d");
    drawPupil(landmarks[RIGHT_IRIS_CENTER], "#ff4d4d");
  }

  overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
}

// ---------- webcam + MediaPipe ----------

const video = document.getElementById("webcam");
const startBtn = document.getElementById("start-btn");

const blinkDetector = new BlinkSequenceDetector();
let landmarker = null;
let startTimeMs = 0;
let lastFrameTime = performance.now();

async function setupLandmarker() {
  const filesetResolver = await FilesetResolver.forVisionTasks(WASM_URL);
  landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
    runningMode: "VIDEO",
    numFaces: 1,
    minFaceDetectionConfidence: 0.7,
  });
}

async function setupWebcam() {
  const stream = await navigator.mediaDevices.getUserMedia({
    // wide-ish capture matches the display box's aspect ratio better, so
    // the cover crop below doesn't have to cut away as much of the frame
    video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  await new Promise((resolve) => {
    video.onloadedmetadata = () => resolve();
  });
  video.play();
  resizeOverlayCanvas();
  resizeToContainer();
}

window.addEventListener("resize", resizeOverlayCanvas);

function processFrame(nowMs) {
  const dt = Math.min((nowMs - lastFrameTime) / 1000, 0.1);
  lastFrameTime = nowMs;

  let turn = 0;
  let gazeX = 0.5;
  let gazeY = 0.5;
  let noFace = true;

  if (landmarker && video.readyState >= 2) {
    const timestampMs = nowMs - startTimeMs;
    const result = landmarker.detectForVideo(video, timestampMs);
    drawFaceOverlay(result.faceLandmarks, video.videoWidth, video.videoHeight);

    if (result.faceLandmarks && result.faceLandmarks.length > 0) {
      noFace = false;
      const lm = result.faceLandmarks[0];

      gazeX = computeGazeX(lm[LEFT_IRIS_CENTER].x, lm[RIGHT_IRIS_CENTER].x, lm[LEFT_EYE_OUTER].x, lm[RIGHT_EYE_OUTER].x);
      gazeY = computeGazeY(lm[LEFT_IRIS_CENTER].y, lm[LEFT_EYE_TOP].y, lm[LEFT_EYE_BOTTOM].y);
      turn = gazeToTurn(gazeX);

      const ear = eyeAspectRatio(lm[LEFT_EYE_TOP].y, lm[LEFT_EYE_BOTTOM].y, lm[LEFT_EYE_OUTER].x, lm[LEFT_EYE_INNER].x);
      const blinkCount = blinkDetector.update(ear, timestampMs / 1000);
      if (blinkCount === 2) {
        driving = true;
      } else if (blinkCount >= 3) {
        driving = false;
        estopFlashUntilMs = nowMs + 1500;
      }
    } else {
      blinkDetector.reset();
    }
  }

  updateVehicle(turn, dt);
  updateHud({ gazeX, gazeY, turn, noFace }, nowMs);

  requestAnimationFrame(processFrame);
  renderer.render(scene, camera);
}

startBtn.addEventListener("click", async () => {
  startBtn.textContent = "Завантаження моделі...";
  startBtn.disabled = true;
  try {
    await Promise.all([setupWebcam(), setupLandmarker()]);
    startTimeMs = performance.now();
    lastFrameTime = startTimeMs;
    startBtn.classList.add("hidden");
    requestAnimationFrame(processFrame);
  } catch (err) {
    console.error(err);
    startBtn.textContent = "Помилка. Перевір дозвіл на камеру і спробуй ще раз.";
    startBtn.disabled = false;
  }
});

// render an idle frame so the scene isn't blank before the user hits start
renderer.render(scene, camera);
camera.position.set(0, 4, 8);
camera.lookAt(0, 0, 0);
renderer.render(scene, camera);
