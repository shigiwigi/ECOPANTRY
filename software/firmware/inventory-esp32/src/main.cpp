// EcoPantry inventory station: DHT11, HX711 (waste bin), pH probe (experimental), MFRC522,
// 16x2 LCD, LEDs and buzzer on one ESP32. Sensors, screen and card reader run here on
// core 1 and never block on the network; src/net/uplink.cpp talks to the API on core 0.
//
// Readings go to the API only during a live session. When the session ends the station
// keeps measuring and showing values locally but sends nothing until an authorised card
// is tapped. Setup and calibration: README.md.

#include <Arduino.h>
#include <WiFi.h>

#include "config.h"
#include "net/uplink.h"
#include "ph.h"
#include "rfid_reader.h"
#include "sensors/climate.h"
#include "sensors/load_cell.h"
#include "sensors/ph_probe.h"
#include "storage/calibration.h"
#include "ui/display.h"
#include "ui/indicators.h"

#ifndef ECOPANTRY_SERIAL_REPORT
#define ECOPANTRY_SERIAL_REPORT 1
#endif

namespace {

Climate climate;
LoadCell loadCell;
PhProbe phProbe;
RfidReader cardReader;
Display display;
Indicators indicators;

// A message (card result, calibration) replaces the rotating pages for a few seconds.
struct Message {
  bool active = false;
  uint32_t untilMs = 0;
  char line1[17] = "";
  char line2[17] = "";
} message;

bool scanPending = false;
char tappedUid[ecopantry::kUidTextSize] = "";
uint32_t scanStartedMs = 0;
uint32_t lastSampleMs = 0;
uint32_t lastReportMs = 0;

// First point of a two-point pH calibration, until the second one is taken.
float pendingPhVolts = NAN;
float pendingPhValue = NAN;

char serialLine[64];
size_t serialLength = 0;

void showMessage(const char* line1, const char* line2, uint32_t nowMs, uint32_t durationMs = config::kMessageMs) {
  message.active = true;
  message.untilMs = nowMs + durationMs;
  strlcpy(message.line1, line1, sizeof message.line1);
  strlcpy(message.line2, line2, sizeof message.line2);
}

// --- cards ---------------------------------------------------------------------

const char* deniedReason(const char* result) {
  if (strcmp(result, "unknown_card") == 0) return "UNKNOWN CARD";
  if (strcmp(result, "card_revoked") == 0) return "CARD REVOKED";
  if (strcmp(result, "employee_inactive") == 0) return "ACCOUNT INACTIVE";
  return "NOT ALLOWED";
}

void showScanResult(const uplink::ScanResult& r, uint32_t nowMs) {
  // Line 1 is always the card's ID, line 2 the holder's name or why it wasn't accepted.
  switch (r.outcome) {
    case uplink::ScanOutcome::Granted:
      showMessage(tappedUid, r.displayName[0] ? r.displayName : "ACCESS GRANTED", nowMs, config::kCardShownMs);
      indicators.signal(Signal::Granted, nowMs, config::kCardShownMs);
      break;
    case uplink::ScanOutcome::Denied:
      showMessage(tappedUid, deniedReason(r.result), nowMs, config::kCardShownMs);
      indicators.signal(Signal::Denied, nowMs, config::kCardShownMs);
      break;
    case uplink::ScanOutcome::Offline:
      showMessage(tappedUid, "NOT CHECKED:OFFL", nowMs, config::kCardShownMs);
      indicators.signal(Signal::Problem, nowMs, config::kCardShownMs);
      break;
    case uplink::ScanOutcome::Locked:
      showMessage(tappedUid, "DEVICE LOCKED", nowMs, config::kCardShownMs);
      indicators.signal(Signal::Problem, nowMs, config::kCardShownMs);
      break;
    case uplink::ScanOutcome::Error:
      showMessage(tappedUid, "SERVER ERROR", nowMs, config::kCardShownMs);
      indicators.signal(Signal::Problem, nowMs, config::kCardShownMs);
      break;
  }
  Serial.printf("[card] %s %s\n", r.outcome == uplink::ScanOutcome::Granted ? "granted" : "not granted", r.result);
}

void handleCards(uint32_t nowMs) {
  if (scanPending) {
    uplink::ScanResult result;
    if (uplink::takeScanResult(&result)) {
      scanPending = false;
      showScanResult(result, nowMs);
    } else if (nowMs - scanStartedMs > config::kScanAnswerTimeoutMs) {
      scanPending = false;
      showMessage(tappedUid, "NO ANSWER", nowMs, config::kCardShownMs);
      indicators.signal(Signal::Problem, nowMs, config::kCardShownMs);
    }
    return;  // one card at a time
  }

  char uid[ecopantry::kUidTextSize];
  if (!cardReader.poll(nowMs, uid)) return;
  Serial.printf("[card] tapped %s\n", uid);
  if (uplink::requestScan(uid)) {
    scanPending = true;
    scanStartedMs = nowMs;
    strlcpy(tappedUid, uid, sizeof tappedUid);
    showMessage(tappedUid, "CHECKING...", nowMs, config::kScanAnswerTimeoutMs);
  }
}

// --- readings --------------------------------------------------------------------

void sampleForUpload(uint32_t nowMs, const uplink::Status& status) {
  if (status.state != ecopantry::SessionState::Live) return;
  if (lastSampleMs != 0 && nowMs - lastSampleMs < status.reportIntervalMs) return;
  lastSampleMs = nowMs;

  ecopantry::Reading r;
  r.uptimeMs = uplink::uptimeMs();
  r.dhtOk = climate.ok(nowMs);
  r.temperatureC = climate.temperatureC();
  r.humidityPct = climate.humidityPct();
  r.hasTemperature = r.hasHumidity = r.dhtOk;
  r.loadCellOk = loadCell.ok();
  r.weightG = loadCell.grams();
  r.hasWeight = r.loadCellOk;
  r.hasPh = r.hasPhVoltage = phProbe.hasValue();
  r.ph = phProbe.ph();
  r.phVoltage = phProbe.voltage();
  uplink::addReading(r);
}

// --- screen ------------------------------------------------------------------------

// Second line of the home screen: is the station talking to the server?
void connectionLine(const uplink::Status& s, char* line) {
  if (!s.configOk) {
    strcpy(line, "CONFIG ERROR");
  } else if (s.state == ecopantry::SessionState::Locked) {
    strcpy(line, "TOKEN REFUSED");
  } else if (!s.wifiConnected) {
    strcpy(line, "WIFI OFFLINE");
  } else if (s.lastHttpCode == 0) {
    strcpy(line, "CONNECTING...");
  } else if (s.lastHttpCode < 0) {
    strcpy(line, "SERVER OFFLINE");
  } else if (s.lastHttpCode >= 500) {
    strcpy(line, "SERVER ERROR");
  } else if (s.state == ecopantry::SessionState::Live) {
    strcpy(line, "ONLINE - LIVE");
  } else {
    strcpy(line, "ONLINE");
  }
}

// Always on screen: temperature, humidity and the connection. A card tap replaces it for
// a few seconds with the card's ID and the holder's name, then it comes back.
void updateScreen(uint32_t nowMs, const uplink::Status& status) {
  if (message.active) {
    if (static_cast<int32_t>(nowMs - message.untilMs) < 0) {
      display.show(message.line1, message.line2);
      return;
    }
    message.active = false;
  }

  char line1[17], line2[17];
  if (climate.ok(nowMs)) {
    snprintf(line1, sizeof line1, "T:%.1fC  H:%.0f%%", climate.temperatureC(), climate.humidityPct());
  } else {
    strcpy(line1, "DHT11 ERROR");
  }
  connectionLine(status, line2);
  display.show(line1, line2);
}

void updateIndicators(uint32_t nowMs, const uplink::Status& status) {
  if (!status.configOk || status.state == ecopantry::SessionState::Locked) {
    indicators.setAmbient(Ambient::Locked);
  } else if (status.state == ecopantry::SessionState::Live) {
    indicators.setAmbient(Ambient::Live);
  } else {
    indicators.setAmbient(Ambient::Off);
  }
  indicators.update(nowMs);
}

// --- serial console ------------------------------------------------------------------

void printHelp() {
  Serial.println(F("Commands:"));
  Serial.println(F("  status            sensors, WiFi, session and calibration"));
  Serial.println(F("  tare              zero the load cell (bin empty)"));
  Serial.println(F("  cal <grams>       calibrate the load cell with a known weight on it"));
  Serial.println(F("  ph cal <pH>       record a pH buffer point (twice: e.g. 7.00 then 4.01)"));
  Serial.println(F("  ph reset          back to the default pH calibration"));
  Serial.println(F("  cal reset         forget all saved calibration"));
  Serial.println(F("  session           ask the API for a short live session (counts against the daily limit)"));
}

void printStatus(uint32_t nowMs) {
  const uplink::Status s = uplink::status();
  const ecopantry::PhCalibration& ph = phProbe.calibration();
  Serial.printf("firmware %s, uptime %lu s\n", FIRMWARE_VERSION, static_cast<unsigned long>(nowMs / 1000));
  if (!s.configOk) Serial.printf("config error: %s\n", uplink::configProblem());
  Serial.printf("wifi %s", s.wifiConnected ? "connected" : "offline");
  if (s.wifiConnected) Serial.printf(" (%s, RSSI %d dBm)", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  Serial.println();
  Serial.printf("session %s, %lu s left%s, report every %lu s\n", ecopantry::sessionStateName(s.state),
                static_cast<unsigned long>(s.remainingMs / 1000), s.budgetExhausted ? ", daily limit reached" : "",
                static_cast<unsigned long>(s.reportIntervalMs / 1000));
  Serial.printf("uploads ok %lu, failed %lu, buffered %u, last HTTP %d\n", static_cast<unsigned long>(s.uploadsOk),
                static_cast<unsigned long>(s.uploadsFailed), static_cast<unsigned>(s.buffered), s.lastHttpCode);
  Serial.printf("rfid reader 0x%02X (%s)\n", cardReader.version(), cardReader.healthy() ? "ok" : "NOT ANSWERING");
  Serial.printf("temperature %.1f C, humidity %.0f %% (%s)\n", climate.temperatureC(), climate.humidityPct(),
                climate.ok(nowMs) ? "ok" : "DHT11 error");
  Serial.printf("bin weight %.1f g (%s), factor %.4f\n", loadCell.grams(),
                loadCell.ok() ? "ok" : (loadCell.available() ? "reading" : "HX711 not detected"), loadCell.factor());
  Serial.printf("pH %.2f at %.3f V, slope %.3f, intercept %.3f (EXPERIMENTAL)\n", phProbe.ph(), phProbe.voltage(),
                ph.slope, ph.intercept);
}

void phCalibrationPoint(float bufferPh, uint32_t nowMs) {
  if (!phProbe.hasValue()) {
    Serial.println(F("No pH reading yet; wait a second and try again."));
    return;
  }
  const float volts = phProbe.voltage();
  if (isnan(pendingPhVolts)) {
    pendingPhVolts = volts;
    pendingPhValue = bufferPh;
    Serial.printf("Point 1: pH %.2f at %.3f V. Rinse, put the probe in the second buffer, wait for it to settle,\n"
                  "then run `ph cal <pH of that buffer>`.\n", bufferPh, volts);
    showMessage("pH POINT 1 SAVED", "NOW 2ND BUFFER", nowMs);
    return;
  }
  ecopantry::PhCalibration cal{};
  if (!ecopantry::calibrateTwoPoint(pendingPhVolts, pendingPhValue, volts, bufferPh, &cal)) {
    Serial.println(F("The two voltages are too close; was the probe moved to the second buffer? Start again."));
  } else {
    phProbe.setCalibration(cal);
    savePhCalibration(cal);
    Serial.printf("Saved: slope %.3f, intercept %.3f. Still experimental.\n", cal.slope, cal.intercept);
    showMessage("pH CALIBRATED", "SAVED", nowMs);
  }
  pendingPhVolts = pendingPhValue = NAN;
}

void runCommand(char* line, uint32_t nowMs) {
  while (*line == ' ') ++line;
  if (*line == '\0') return;

  float value = 0;
  if (strcmp(line, "help") == 0) {
    printHelp();
  } else if (strcmp(line, "status") == 0) {
    printStatus(nowMs);
  } else if (strcmp(line, "tare") == 0) {
    Serial.println(loadCell.tare() ? F("Tared.") : F("HX711 not ready."));
    showMessage("LOAD CELL", "TARED", nowMs);
  } else if (strcmp(line, "cal reset") == 0) {
    resetCalibration();
    const Calibration defaults = loadCalibration();
    loadCell.setFactor(defaults.loadCellFactor);
    phProbe.setCalibration(defaults.ph);
    Serial.println(F("Calibration reset to the defaults in config.h. Run `tare` with the bin empty."));
  } else if (sscanf(line, "cal %f", &value) == 1) {
    const float factor = loadCell.calibrate(value);
    if (factor == 0) {
      Serial.println(F("Calibration failed: is the HX711 connected and the weight on the platform?"));
    } else {
      saveLoadCellFactor(factor);
      Serial.printf("Saved factor %.4f.\n", factor);
      showMessage("LOAD CELL", "CALIBRATED", nowMs);
    }
  } else if (strcmp(line, "ph reset") == 0) {
    phProbe.setCalibration(ecopantry::kDefaultPhCalibration);
    savePhCalibration(ecopantry::kDefaultPhCalibration);
    pendingPhVolts = pendingPhValue = NAN;
    Serial.println(F("pH calibration back to the default."));
  } else if (sscanf(line, "ph cal %f", &value) == 1) {
    if (value < 0 || value > 14) {
      Serial.println(F("A buffer's pH is between 0 and 14."));
    } else {
      phCalibrationPoint(value, nowMs);
    }
  } else if (strcmp(line, "session") == 0) {
    uplink::restartSession();
    Serial.println(F("Asking the API for a live session..."));
  } else {
    Serial.printf("Unknown command '%s'. Type `help`.\n", line);
  }
}

void handleSerial(uint32_t nowMs) {
  while (Serial.available() > 0) {
    const char c = static_cast<char>(Serial.read());
    if (c == '\r') continue;
    if (c == '\n') {
      serialLine[serialLength] = '\0';
      runCommand(serialLine, nowMs);
      serialLength = 0;
    } else if (serialLength + 1 < sizeof serialLine) {
      serialLine[serialLength++] = static_cast<char>(tolower(c));
    }
  }
}

void serialReport(uint32_t nowMs, const uplink::Status& s) {
#if ECOPANTRY_SERIAL_REPORT
  if (nowMs - lastReportMs < config::kSerialReportMs) return;
  lastReportMs = nowMs;
  Serial.printf("[sensors] %.1f C %.0f%% | bin %.1f g | pH %.2f (exp.) | %s %lus | wifi %s\n",
                climate.temperatureC(), climate.humidityPct(), loadCell.grams(), phProbe.ph(),
                ecopantry::sessionStateName(s.state), static_cast<unsigned long>(s.remainingMs / 1000),
                s.wifiConnected ? "up" : "down");
#else
  (void)nowMs;
  (void)s;
#endif
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.printf("EcoPantry inventory station, firmware %s\n", FIRMWARE_VERSION);

  indicators.begin();
  display.begin();
  display.show("ECOPANTRY", "STARTING " FIRMWARE_VERSION);

  const Calibration calibration = loadCalibration();
  climate.begin();
  phProbe.begin(calibration.ph);
  cardReader.begin();
  if (!cardReader.healthy()) {
    display.show("RFID READER", "NOT ANSWERING");
    delay(2500);
  }

  display.show("TARING LOAD CELL", "KEEP BIN EMPTY");
  delay(1500);
  if (!loadCell.begin(calibration.loadCellFactor)) {
    Serial.println(F("WARNING: HX711 not detected; bin weight will be reported as missing."));
  }

  uplink::start();
  printHelp();
}

void loop() {
  const uint32_t now = millis();
  const uplink::Status status = uplink::status();

  climate.update(now);
  loadCell.update();
  phProbe.update(now);
  handleSerial(now);
  handleCards(now);
  sampleForUpload(now, status);
  updateScreen(now, status);
  updateIndicators(now, status);
  serialReport(now, status);
  delay(1);  // let the idle task run (watchdog)
}
