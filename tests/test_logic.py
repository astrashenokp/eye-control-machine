import sys
from pathlib import Path

SRC_ROOT = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC_ROOT))

from eye_control.logic import (  # noqa: E402
    DoubleBlinkDetector,
    compute_gaze_x,
    compute_gaze_y,
    eye_aspect_ratio,
    gaze_to_command,
)


def test_compute_gaze_x_center():
    assert compute_gaze_x(iris_left_x=0.45, iris_right_x=0.45, eye_left_x=0.4, eye_right_x=0.5) == 0.5


def test_compute_gaze_x_zero_span_does_not_crash():
    assert compute_gaze_x(0.5, 0.5, 0.5, 0.5) == 0.5


def test_compute_gaze_x_near_zero_span_does_not_blow_up():
    result = compute_gaze_x(iris_left_x=0.41, iris_right_x=0.41, eye_left_x=0.4, eye_right_x=0.4001)
    assert 0.0 <= result <= 1.0


def test_compute_gaze_y_center():
    assert compute_gaze_y(iris_y=0.45, eye_top_y=0.4, eye_bottom_y=0.5) == 0.5


def test_compute_gaze_y_near_zero_span_does_not_blow_up():
    result = compute_gaze_y(iris_y=0.41, eye_top_y=0.4, eye_bottom_y=0.4001)
    assert 0.0 <= result <= 1.0


def test_gaze_to_command_center_moves_forward():
    cmd = gaze_to_command(0.5)
    assert cmd.forward > 0.0
    assert cmd.turn == 0.0


def test_gaze_to_command_far_side_turns():
    cmd = gaze_to_command(0.9)
    assert cmd.turn != 0.0


def test_gaze_to_command_clamps_extreme_gaze_x():
    cmd = gaze_to_command(5000.0)
    assert -1.0 <= cmd.turn <= 1.0
    cmd_negative = gaze_to_command(-5000.0)
    assert -1.0 <= cmd_negative.turn <= 1.0


def test_eye_aspect_ratio_open_vs_closed():
    open_ear = eye_aspect_ratio(top_y=0.10, bottom_y=0.14, left_x=0.30, right_x=0.40)
    closed_ear = eye_aspect_ratio(top_y=0.12, bottom_y=0.121, left_x=0.30, right_x=0.40)
    assert closed_ear < open_ear


def test_double_blink_requires_two_distinct_blinks_not_one_sustained_closure():
    detector = DoubleBlinkDetector()
    assert detector.update(ear=0.05, now_sec=0.00) is False
    assert detector.update(ear=0.05, now_sec=0.05) is False  # still closed, same blink
    assert detector.update(ear=0.05, now_sec=0.10) is False  # still closed, same blink
    assert detector.update(ear=0.30, now_sec=0.15) is False  # eyes reopen


def test_double_blink_triggers_on_two_distinct_blinks():
    detector = DoubleBlinkDetector()
    assert detector.update(ear=0.05, now_sec=0.0) is False   # blink 1 starts
    assert detector.update(ear=0.30, now_sec=0.1) is False   # blink 1 ends
    assert detector.update(ear=0.05, now_sec=0.3) is True    # blink 2 starts -> trigger


def test_double_blink_resets_after_max_gap():
    detector = DoubleBlinkDetector(max_gap_sec=1.0)
    assert detector.update(ear=0.05, now_sec=0.0) is False
    assert detector.update(ear=0.30, now_sec=0.1) is False
    assert detector.update(ear=0.05, now_sec=5.0) is False   # too late, counts as new blink 1
    assert detector.update(ear=0.30, now_sec=5.1) is False
    assert detector.update(ear=0.05, now_sec=5.3) is True    # blink 2 within gap of the reset blink 1


def test_double_blink_reset_clears_in_progress_sequence():
    detector = DoubleBlinkDetector()
    assert detector.update(ear=0.05, now_sec=0.0) is False
    assert detector.update(ear=0.30, now_sec=0.1) is False
    detector.reset()  # tracking lost here
    assert detector.update(ear=0.05, now_sec=0.3) is False
