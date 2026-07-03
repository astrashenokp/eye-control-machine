// Gaze-to-command math. Started as a 1:1 port of
// ../../src/eye_control/logic.py, but the web control scheme has since
// diverged on purpose: the car always drives where you look (manual mode),
// 2 blinks locks into a straight-line autopilot so you can look around
// freely, and 3 blinks is an emergency stop -- see main.js and
// ../README.md. Turn sensitivity is also tuned much higher than the
// Python defaults, for a "look there, go there" feel.

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
// Web-tuned turn sensitivity: much lower dead zone and higher gain than the
// Python defaults (0.15 / 0.8) so a small eye movement is enough to reach
// full turn -- you should never have to turn your head far enough to lose
// sight of the screen.
export const GAZE_TURN_ZONE = 0.004;
export const GAZE_TURN_GAIN = 9.0;
export const GAZE_MIN_EYE_SPAN = 0.01; // below this, eye-corner landmarks are too close to trust
export const GAZE_TURN_MAX = 1.0; // hard clamp -- never return an unbounded turn command

export const EAR_THRESHOLD = 0.2;
// How long to wait after the last blink before deciding how many blinks
// were in the sequence. Short enough to feel responsive, long enough that
// two deliberate blinks don't get split into two separate single-blinks.
export const BLINK_SEQUENCE_GAP_SEC = 0.45;

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

// Only the turn component is used by the web app -- forward motion is
// blink-triggered (see BlinkSequenceDetector), not gaze-triggered.
export function gazeToTurn(gazeX) {
  const gazeCenterDist = Math.abs(gazeX - 0.5);
  let turn = gazeCenterDist > GAZE_TURN_ZONE ? (0.5 - gazeX) * GAZE_TURN_GAIN : 0.0;
  turn = Math.max(-GAZE_TURN_MAX, Math.min(GAZE_TURN_MAX, turn));
  return turn;
}

export function eyeAspectRatio(topY, bottomY, leftX, rightX) {
  const height = Math.abs(topY - bottomY);
  const width = Math.abs(rightX - leftX);
  return height / (width + 1e-6);
}

// Counts BLINK EVENTS (open->closed transitions) into a sequence, and
// reports the total once `gapTimeoutSec` passes since the last blink --
// e.g. blink-blink-<pause> resolves to 2, blink-blink-blink-<pause> to 3.
// Distinguishing "2" from "3" needs that pause, so there's an inherent
// ~gapTimeoutSec delay before a sequence is reported.
export class BlinkSequenceDetector {
  constructor(earThreshold = EAR_THRESHOLD, gapTimeoutSec = BLINK_SEQUENCE_GAP_SEC) {
    this.earThreshold = earThreshold;
    this.gapTimeoutSec = gapTimeoutSec;
    this.blinkCount = 0;
    this.lastBlinkTime = null;
    this.wasClosed = false;
  }

  // Clear any in-progress blink sequence. Call whenever face tracking is
  // lost -- otherwise a blink right before a tracking gap and an unrelated
  // blink right after tracking resumes can combine into a false sequence.
  reset() {
    this.blinkCount = 0;
    this.lastBlinkTime = null;
    this.wasClosed = false;
  }

  // Returns the finalized blink count (>=1) once a pause follows a
  // sequence, otherwise null (sequence still in progress, or no blinks).
  update(ear, nowSec) {
    const isClosed = ear < this.earThreshold;
    let finalizedCount = null;

    if (this.blinkCount > 0 && this.lastBlinkTime !== null && nowSec - this.lastBlinkTime > this.gapTimeoutSec) {
      finalizedCount = this.blinkCount;
      this.blinkCount = 0;
      this.lastBlinkTime = null;
    }

    if (isClosed && !this.wasClosed) {
      this.blinkCount += 1;
      this.lastBlinkTime = nowSec;
    }

    this.wasClosed = isClosed;
    return finalizedCount;
  }
}
