// Eye-controlled car -- main ESP32 firmware.
//
// Raises its own Wi-Fi access point ("EyeCar") and a tiny HTTP server.
// GET /drive?forward=<-1..1>&turn=<-1..1> mixes the two into left/right
// motor speeds (same DriveCommand shape as ../../src/eye_control/logic.py
// and ../../web/js/logic.js) and drives a TB6612FNG dual motor driver.
//
// If no /drive request arrives for COMMAND_TIMEOUT_MS, motors stop --
// mirrors the "no face -> stop" safety fallback in the software versions.
//
// Board package: esp32 by Espressif, version 2.0.x (ledcSetup/ledcWrite
// API used below changed in 3.x). Board: "ESP32 Dev Module".
//
// See ../../README.md for wiring and the full build guide.

#include <WiFi.h>
#include <WebServer.h>

// ---------- Wi-Fi access point ----------

const char *AP_SSID = "EyeCar";
const char *AP_PASSWORD = "eyecar123"; // WPA2 requires 8+ chars

WebServer server(80);

// ---------- TB6612FNG pins (see hardware/README.md section 6) ----------

const int PIN_STBY = 4;
const int PIN_AIN1 = 16;
const int PIN_AIN2 = 17;
const int PIN_PWMA = 18; // left side
const int PIN_BIN1 = 19;
const int PIN_BIN2 = 21;
const int PIN_PWMB = 22; // right side

const int PWM_CHANNEL_A = 0;
const int PWM_CHANNEL_B = 1;
const int PWM_FREQ_HZ = 5000;
const int PWM_RESOLUTION_BITS = 8; // duty 0-255

// Caps max duty cycle so the (6V-rated) motors don't run flat-out on the
// 7.4V pack indefinitely -- see hardware/README.md section 2.3.
const int PWM_MAX_DUTY = 204; // ~80% of 255

// Flip these if a side spins backwards after wiring -- easier than
// re-soldering the motor leads.
const bool INVERT_LEFT = false;
const bool INVERT_RIGHT = false;

// ---------- safety timeout ----------

const unsigned long COMMAND_TIMEOUT_MS = 500;
unsigned long lastCommandMillis = 0;

// ---------- motor control ----------

// speed in [-1, 1]; positive drives the car forward on that side.
void driveSide(int pinIn1, int pinIn2, int pwmChannel, float speed, bool invert) {
  if (invert) speed = -speed;
  speed = constrain(speed, -1.0f, 1.0f);

  if (speed > 0.01f) {
    digitalWrite(pinIn1, HIGH);
    digitalWrite(pinIn2, LOW);
  } else if (speed < -0.01f) {
    digitalWrite(pinIn1, LOW);
    digitalWrite(pinIn2, HIGH);
  } else {
    digitalWrite(pinIn1, LOW);
    digitalWrite(pinIn2, LOW);
  }

  int duty = (int)(fabs(speed) * PWM_MAX_DUTY);
  ledcWrite(pwmChannel, duty);
}

void stopMotors() {
  driveSide(PIN_AIN1, PIN_AIN2, PWM_CHANNEL_A, 0.0f, INVERT_LEFT);
  driveSide(PIN_BIN1, PIN_BIN2, PWM_CHANNEL_B, 0.0f, INVERT_RIGHT);
}

// Same differential-drive mixing as a typical two-wheel DriveCommand:
// forward moves both sides together, turn spreads them apart.
void applyDriveCommand(float forward, float turn) {
  float left = forward + turn;
  float right = forward - turn;

  // re-normalize if mixing pushed either side past [-1, 1], so turning
  // hard doesn't just clip one side and silently lose the other's speed
  float maxMag = fmax(fabs(left), fabs(right));
  if (maxMag > 1.0f) {
    left /= maxMag;
    right /= maxMag;
  }

  driveSide(PIN_AIN1, PIN_AIN2, PWM_CHANNEL_A, left, INVERT_LEFT);
  driveSide(PIN_BIN1, PIN_BIN2, PWM_CHANNEL_B, right, INVERT_RIGHT);
}

// ---------- HTTP handlers ----------

void handleDrive() {
  float forward = server.hasArg("forward") ? server.arg("forward").toFloat() : 0.0f;
  float turn = server.hasArg("turn") ? server.arg("turn").toFloat() : 0.0f;

  forward = constrain(forward, -1.0f, 1.0f);
  turn = constrain(turn, -1.0f, 1.0f);

  applyDriveCommand(forward, turn);
  lastCommandMillis = millis();

  server.send(200, "text/plain", "ok");
}

void handleRoot() {
  String html = "<html><body style='font-family:sans-serif'>";
  html += "<h1>EyeCar</h1>";
  html += "<p>Status: alive</p>";
  html += "<p>Uptime: " + String(millis() / 1000) + "s</p>";
  html += "<p>Send commands to <code>/drive?forward=0..1&turn=-1..1</code></p>";
  html += "</body></html>";
  server.send(200, "text/html", html);
}

// ---------- setup / loop ----------

void setup() {
  Serial.begin(115200);

  pinMode(PIN_STBY, OUTPUT);
  pinMode(PIN_AIN1, OUTPUT);
  pinMode(PIN_AIN2, OUTPUT);
  pinMode(PIN_BIN1, OUTPUT);
  pinMode(PIN_BIN2, OUTPUT);

  ledcSetup(PWM_CHANNEL_A, PWM_FREQ_HZ, PWM_RESOLUTION_BITS);
  ledcAttachPin(PIN_PWMA, PWM_CHANNEL_A);
  ledcSetup(PWM_CHANNEL_B, PWM_FREQ_HZ, PWM_RESOLUTION_BITS);
  ledcAttachPin(PIN_PWMB, PWM_CHANNEL_B);

  digitalWrite(PIN_STBY, HIGH); // enable the driver
  stopMotors();

  WiFi.softAP(AP_SSID, AP_PASSWORD);
  Serial.print("AP started, IP: ");
  Serial.println(WiFi.softAPIP()); // normally 192.168.4.1

  server.on("/", handleRoot);
  server.on("/drive", handleDrive);
  server.begin();

  lastCommandMillis = millis();
}

void loop() {
  server.handleClient();

  if (millis() - lastCommandMillis > COMMAND_TIMEOUT_MS) {
    stopMotors();
  }
}
