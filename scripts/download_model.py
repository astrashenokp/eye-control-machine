"""Downloads the MediaPipe FaceLandmarker model bundle needed by
eye_control.main. Run once before the first launch:

    python scripts/download_model.py
"""
import os
import urllib.request

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
    "face_landmarker/float16/latest/face_landmarker.task"
)
DEST_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")
DEST_PATH = os.path.join(DEST_DIR, "face_landmarker.task")


def main():
    os.makedirs(DEST_DIR, exist_ok=True)
    if os.path.exists(DEST_PATH):
        print(f"Already present: {DEST_PATH}")
        return
    print(f"Downloading {MODEL_URL} -> {DEST_PATH}")
    urllib.request.urlretrieve(MODEL_URL, DEST_PATH)
    print("Done.")


if __name__ == "__main__":
    main()
