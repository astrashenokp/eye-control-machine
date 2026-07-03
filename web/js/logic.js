// Pure gaze-to-command math. 1:1 port of ../../src/eye_control/logic.py --
// keep both in sync if the math ever changes. No DOM/MediaPipe imports here.

// Landmark indices (MediaPipe FaceLandmarker, 478-point mesh incl. iris).
export const LEFT_EYE_OUTER = 33;
export const LEFT_EYE_INNER = 133;
export const RIGHT_EYE_INNER = 362;
export const RIGHT_EYE_OUTER = 263;
export const LEFT_IRIS_CENTER = 468;
export const RIGHT_IRIS_CENTER = 473;
export const LEFT_EYE_TOP = 159;
export const LEFT_EYE_BOTTOM = 145;

export const GAZE_FORWARD_SPEED = 0.15;
export const GAZE_CENTER_DEAD_ZONE = 0.1;
export const GAZE_TURN_ZONE = 0.15;
export const GAZE_TURN_GAIN = 0.8;
export const GAZE_MIN_EYE_SPAN = 0.01; // below this, eye-corner landmarks are too close to trust
export const GAZE_TURN_MAX = 1.0; // hard clamp -- never return an unbounded turn command

export const EAR_THRESHOLD = 0.2;
export const DOUBLE_BLINK_COUNT = 2;
export const DOUBLE_BLINK_MAX_GAP_SEC = 1.0;

// 0 = looking full left, 1 = looking full right, 0.5 = center.
export function computeGazeX(irisLeftX, irisRightX, eyeLeftX, eyeRightX) {
  const irisX = (irisLeftX + irisRightX) / 2.0;
  const span = eyeRightX - eyeLeftX;
  if (Math.abs(span) < GAZE_MIN_EYE_SPAN) return 0.5;
  return (irisX - eyeLeftX) / span;
}

// 0 = looking full up, 1 = looking full down, 0.5 = center.
export function computeGazeY(irisY, eyeTopY, eyeBottomY) {
  const span = eyeBottomY - eyeTopY;
  if (Math.abs(span) < GAZE_MIN_EYE_SPAN) return 0.5;
  return (irisY - eyeTopY) / span;
}

export function gazeToCommand(gazeX) {
  const gazeCenterDist = Math.abs(gazeX - 0.5);
  const forward = gazeCenterDist < GAZE_CENTER_DEAD_ZONE ? GAZE_FORWARD_SPEED : 0.0;
  let turn = gazeCenterDist > GAZE_TURN_ZONE ? (0.5 - gazeX) * GAZE_TURN_GAIN : 0.0;
  turn = Math.max(-GAZE_TURN_MAX, Math.min(GAZE_TURN_MAX, turn));
  return { forward, turn };
}

export function eyeAspectRatio(topY, bottomY, leftX, rightX) {
  const height = Math.abs(topY - bottomY);
  const width = Math.abs(rightX - leftX);
  return height / (width + 1e-6);
}

// Counts BLINK EVENTS (open->closed transitions), not closed-eye frames.
export class DoubleBlinkDetector {
  constructor(
    earThreshold = EAR_THRESHOLD,
    requiredBlinks = DOUBLE_BLINK_COUNT,
    maxGapSec = DOUBLE_BLINK_MAX_GAP_SEC
  ) {
    this.earThreshold = earThreshold;
    this.requiredBlinks = requiredBlinks;
    this.maxGapSec = maxGapSec;
    this.blinkCount = 0;
    this.firstBlinkTime = null;
    this.wasClosed = false;
  }

  // Clear any in-progress blink sequence. Call whenever face tracking is
  // lost -- otherwise a blink right before a tracking gap and an unrelated
  // blink right after tracking resumes can combine into a false trigger.
  reset() {
    this.blinkCount = 0;
    this.firstBlinkTime = null;
    this.wasClosed = false;
  }

  // Returns true exactly once when `requiredBlinks` blinks complete within
  // `maxGapSec` of the first one.
  update(ear, nowSec) {
    const isClosed = ear < this.earThreshold;
    let triggered = false;

    if (isClosed && !this.wasClosed) {
      if (this.blinkCount > 0 && nowSec - this.firstBlinkTime > this.maxGapSec) {
        this.blinkCount = 0;
      }
      if (this.blinkCount === 0) {
        this.firstBlinkTime = nowSec;
      }
      this.blinkCount += 1;
      if (this.blinkCount >= this.requiredBlinks) {
        triggered = true;
        this.blinkCount = 0;
        this.firstBlinkTime = null;
      }
    }

    this.wasClosed = isClosed;
    return triggered;
  }
}
