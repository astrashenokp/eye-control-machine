"""Pure helper functions: gaze-landmark-to-command math, gaze normalization,
and double-blink detection. No mediapipe/cv2 imports here -- testable with
synthetic (x, y) landmark values.

Ported from a related ROS2 project's head_control_logic.py, keeping only the
eye/gaze parts (this repo is eye control only, no head-pose/neck mode).
"""
from dataclasses import dataclass

# Landmark indices (mediapipe FaceLandmarker, 478-point mesh incl. iris).
LEFT_EYE_OUTER, LEFT_EYE_INNER = 33, 133
RIGHT_EYE_INNER, RIGHT_EYE_OUTER = 362, 263
LEFT_IRIS_CENTER, RIGHT_IRIS_CENTER = 468, 473
LEFT_EYE_TOP, LEFT_EYE_BOTTOM = 159, 145

GAZE_FORWARD_SPEED = 0.15
GAZE_CENTER_DEAD_ZONE = 0.1
GAZE_TURN_ZONE = 0.15
GAZE_TURN_GAIN = 0.8
GAZE_MIN_EYE_SPAN = 0.01  # below this, eye-corner landmarks are too close together to trust
GAZE_TURN_MAX = 1.0  # hard clamp -- never return an unbounded turn command

EAR_THRESHOLD = 0.2
DOUBLE_BLINK_COUNT = 2
DOUBLE_BLINK_MAX_GAP_SEC = 1.0


@dataclass(frozen=True)
class DriveCommand:
    forward: float
    turn: float


def compute_gaze_x(iris_left_x: float, iris_right_x: float, eye_left_x: float, eye_right_x: float) -> float:
    """0 = looking full left, 1 = looking full right, 0.5 = center.

    Guards the whole near-zero eye-span range, not just the exact-zero
    point -- a near-zero-but-nonzero span (extreme head angle, landmark
    jitter) divided through unguarded produces a huge/nonsensical gaze_x.
    """
    iris_x = (iris_left_x + iris_right_x) / 2.0
    span = eye_right_x - eye_left_x
    if abs(span) < GAZE_MIN_EYE_SPAN:
        return 0.5
    return (iris_x - eye_left_x) / span


def compute_gaze_y(iris_y: float, eye_top_y: float, eye_bottom_y: float) -> float:
    """0 = looking full up, 1 = looking full down, 0.5 = center. Same
    near-zero-span guard as compute_gaze_x."""
    span = eye_bottom_y - eye_top_y
    if abs(span) < GAZE_MIN_EYE_SPAN:
        return 0.5
    return (iris_y - eye_top_y) / span


def gaze_to_command(gaze_x: float) -> DriveCommand:
    gaze_center_dist = abs(gaze_x - 0.5)
    forward = GAZE_FORWARD_SPEED if gaze_center_dist < GAZE_CENTER_DEAD_ZONE else 0.0
    turn = (0.5 - gaze_x) * GAZE_TURN_GAIN if gaze_center_dist > GAZE_TURN_ZONE else 0.0
    # Defense in depth: clamp regardless of how gaze_x was derived, so a bad
    # upstream value can never produce a runaway turn command.
    turn = max(-GAZE_TURN_MAX, min(GAZE_TURN_MAX, turn))
    return DriveCommand(forward, turn)


def eye_aspect_ratio(top_y: float, bottom_y: float, left_x: float, right_x: float) -> float:
    height = abs(top_y - bottom_y)
    width = abs(right_x - left_x)
    return height / (width + 1e-6)


class DoubleBlinkDetector:
    """Counts BLINK EVENTS (open->closed transitions), not closed-eye frames.

    Tracks the rising edge only, and resets if too much time passes between
    the first and second blink so two unrelated blinks minutes apart don't
    combine into an accidental trigger.
    """

    def __init__(
        self,
        ear_threshold: float = EAR_THRESHOLD,
        required_blinks: int = DOUBLE_BLINK_COUNT,
        max_gap_sec: float = DOUBLE_BLINK_MAX_GAP_SEC,
    ):
        self._ear_threshold = ear_threshold
        self._required_blinks = required_blinks
        self._max_gap_sec = max_gap_sec
        self._blink_count = 0
        self._first_blink_time = None
        self._was_closed = False

    def reset(self) -> None:
        """Clear any in-progress blink sequence. Call this whenever face
        tracking is lost -- otherwise a blink right before a tracking gap
        and an unrelated blink right after tracking resumes can combine
        into a false trigger."""
        self._blink_count = 0
        self._first_blink_time = None
        self._was_closed = False

    def update(self, ear: float, now_sec: float) -> bool:
        """Returns True exactly once when `required_blinks` blinks complete
        within `max_gap_sec` of the first one."""
        is_closed = ear < self._ear_threshold
        triggered = False

        if is_closed and not self._was_closed:
            if self._blink_count > 0 and (now_sec - self._first_blink_time) > self._max_gap_sec:
                self._blink_count = 0
            if self._blink_count == 0:
                self._first_blink_time = now_sec
            self._blink_count += 1
            if self._blink_count >= self._required_blinks:
                triggered = True
                self._blink_count = 0
                self._first_blink_time = None

        self._was_closed = is_closed
        return triggered
