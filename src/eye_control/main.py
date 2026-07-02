"""Standalone eye-control demo: webcam -> MediaPipe FaceLandmarker -> gaze ->
drive command, all in a plain Python loop, no ROS2 / no motors required.

Run: python -m eye_control.main
Quit: press 'q' in the video window.
Emergency stop: two distinct blinks within 1 second.
"""
import os
import time

import cv2
import mediapipe as mp

from eye_control.logic import (
    LEFT_EYE_BOTTOM,
    LEFT_EYE_INNER,
    LEFT_EYE_OUTER,
    LEFT_EYE_TOP,
    LEFT_IRIS_CENTER,
    RIGHT_IRIS_CENTER,
    RIGHT_EYE_OUTER,
    DoubleBlinkDetector,
    compute_gaze_x,
    compute_gaze_y,
    eye_aspect_ratio,
    gaze_to_command,
)

PACKAGE_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_MODEL_PATH = os.path.join(PACKAGE_ROOT, "models", "face_landmarker.task")


def describe_command(cmd) -> str:
    if cmd.forward > 0:
        base = "FORWARD"
    else:
        base = "STOP"
    if cmd.turn > 0.05:
        return f"{base} + LEFT"
    if cmd.turn < -0.05:
        return f"{base} + RIGHT"
    return base


def main():
    model_path = DEFAULT_MODEL_PATH
    if not os.path.exists(model_path):
        raise FileNotFoundError(
            f"Model not found at {model_path}. Run: python scripts/download_model.py"
        )

    base_options = mp.tasks.BaseOptions(model_asset_path=model_path)
    options = mp.tasks.vision.FaceLandmarkerOptions(
        base_options=base_options,
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        num_faces=1,
        min_face_detection_confidence=0.7,
    )
    landmarker = mp.tasks.vision.FaceLandmarker.create_from_options(options)

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise RuntimeError("Could not open webcam (index 0).")

    blink_detector = DoubleBlinkDetector()
    start_time = time.time()

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                print("Frame read failed, skipping.")
                continue

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            timestamp_ms = int((time.time() - start_time) * 1000)

            try:
                result = landmarker.detect_for_video(mp_image, timestamp_ms)
            except Exception as e:
                print(f"FaceLandmarker error: {e}")
                continue

            if not result.face_landmarks:
                blink_detector.reset()
                cv2.putText(frame, "NO FACE - STOP", (10, 30),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
                cv2.imshow("eye-control-machine", frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
                continue

            lm = result.face_landmarks[0]

            gaze_x = compute_gaze_x(
                lm[LEFT_IRIS_CENTER].x, lm[RIGHT_IRIS_CENTER].x,
                lm[LEFT_EYE_OUTER].x, lm[RIGHT_EYE_OUTER].x,
            )
            gaze_y = compute_gaze_y(lm[LEFT_IRIS_CENTER].y, lm[LEFT_EYE_TOP].y, lm[LEFT_EYE_BOTTOM].y)
            command = gaze_to_command(gaze_x)

            ear = eye_aspect_ratio(
                lm[LEFT_EYE_TOP].y, lm[LEFT_EYE_BOTTOM].y,
                lm[LEFT_EYE_OUTER].x, lm[LEFT_EYE_INNER].x,
            )
            estop = blink_detector.update(ear, timestamp_ms / 1000.0)
            if estop:
                print("DOUBLE BLINK -> EMERGENCY STOP")

            label = "EMERGENCY STOP" if estop else describe_command(command)
            cv2.putText(frame, f"gaze_x={gaze_x:.2f} gaze_y={gaze_y:.2f}", (10, 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
            cv2.putText(frame, f"command: {label}", (10, 60),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 200, 255), 2)

            cv2.imshow("eye-control-machine", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
    finally:
        landmarker.close()
        cap.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
