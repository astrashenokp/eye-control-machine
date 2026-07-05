# eye-control-machine

A small, standalone eye/gaze-controlled prototype: a webcam watches your
eyes and turns your gaze into a drive command (forward / turn / stop),
plus a double-blink emergency stop. Pure Python — no ROS2, no hardware
required to try it.

Look center to go forward, look left/right to turn, double-blink to stop.

## Setup

```bash
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt
python scripts/download_model.py
```

## Run

```bash
python -m eye_control.main
```

A window opens showing your webcam feed with the detected gaze position
and the resulting command overlaid. Press `q` to quit.

## Tests

```bash
pytest tests/
```

## How it works

- `src/eye_control/logic.py` — pure math: eye-landmark coordinates in, a
  `DriveCommand(forward, turn)` out. No camera/ML imports, fully unit
  tested (`tests/test_logic.py`).
- `src/eye_control/main.py` — webcam capture loop using MediaPipe's
  `FaceLandmarker` (Tasks API) to get eye/iris landmarks each frame, feeds
  them into `logic.py`, and displays the result. This is the "online"
  version — nothing physical moves yet, it just prints/shows what the
  command *would* be.

## Web 3D model

[`web/`](web/) is a browser-only version of the same loop: webcam + MediaPipe
running in-browser (WASM) drives a Three.js car around a 3D scene, no Python
required. See [`web/README.md`](web/README.md) to run it. This is the "drive
a virtual model first" step before wiring up real hardware.

## Hardware build

[`hardware/`](hardware/) is the physical version: a 4WD chassis driven by
an ESP32 over its own Wi-Fi access point (no cable to the laptop), plus an
ESP32-CAM for a live view from the car. See
[`hardware/README.md`](hardware/README.md) for the full wiring guide and
[`hardware/firmware/`](hardware/firmware/) for the ESP32 firmware.

## Roadmap

- [x] Software-only gaze -> command loop (this repo)
- [x] Browser-based 3D model you can drive with your eyes (`web/`)
- [x] Wiring guide + ESP32 firmware for a real 4WD chassis (`hardware/`)
- [ ] Build it, then wire `web/js/main.js` to send `{forward, turn}` to the
      car's Wi-Fi access point instead of (or alongside) the 3D model
- [ ] Swap the webcam overlay for a physical status LED / buzzer for the
      emergency stop

## Credits

Gaze/blink math adapted from a head/eye control module originally written
for a ROS2 assistive-robotics project, trimmed down here to the
eye-control-only parts (no head-pose/neck mode) and stripped of all ROS2
dependencies.

MediaPipe FaceLandmarker — Apache-2.0, Google.
