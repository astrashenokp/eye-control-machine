# Web 3D model — eye-controlled

Browser version of the eye-control loop: no Python, no install. A webcam
feed drives a MediaPipe FaceLandmarker running in-browser (WASM), the exact
same gaze math as [`src/eye_control/logic.py`](../src/eye_control/logic.py)
(ported line-for-line in [`js/logic.js`](js/logic.js)) turns that into a
`{forward, turn}` command, and a Three.js scene moves a little car around a
grid accordingly. Double-blink toggles an emergency stop.

Three.js and `@mediapipe/tasks-vision` are loaded from CDN via an import
map — no npm install, no build step.

## Run

Browsers block camera access from `file://` pages, so serve the folder over
HTTP:

```bash
cd web
python -m http.server 8000
```

Then open http://localhost:8000 and click the button to grant camera
access. Look center to drive forward, look left/right to turn, double-blink
to stop (double-blink again to resume).

## Next step: the real thing

This is the "online model" step. To go from here to an actual physical
robot, see the roadmap in the [root README](../README.md) — the same
`{forward, turn}` command computed here (or in the Python version) is what
would get sent over serial to a microcontroller driving real motors.
