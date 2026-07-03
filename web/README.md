# Web 3D model — eye-controlled

Browser version of the eye-control loop: no Python, no install. A webcam
feed drives a MediaPipe FaceLandmarker running in-browser (WASM). The gaze
math started as a line-for-line port of
[`src/eye_control/logic.py`](../src/eye_control/logic.py)
([`js/logic.js`](js/logic.js)) but the control scheme has since diverged on
purpose (see below) so looking around doesn't fight with driving.

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
access.

- **Manual (default)** — the car always drives, and heading follows your
  gaze directly: look left/right and it turns that way
- **2 blinks** — lock into autopilot: the car keeps driving straight on its
  own, ignoring gaze, so you can look around freely. 2 blinks again returns
  to manual.
- **3 blinks** — emergency stop, from any mode. 2 blinks resumes in manual.
- **Squint** (narrow your eyes short of a full blink) — speeds the car up,
  the narrower the faster

## Next step: the real thing

This is the "online model" step. To go from here to an actual physical
robot, see the roadmap in the [root README](../README.md) — the same
`{forward, turn}` command computed here (or in the Python version) is what
would get sent over serial to a microcontroller driving real motors.
