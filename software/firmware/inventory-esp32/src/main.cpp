// EcoPantry inventory station: DHT11, HX711 (waste bin), pH probe (experimental), MFRC522,
// 16x2 LCD, LEDs and buzzer on one ESP32. Sensors, screen and card reader run here on
// core 1 and never block on the network; src/net/uplink.cpp talks to the API on core 0.
//
// Readings go to the API only during a live session. When the session ends the station
// keeps measuring and showing values locally but sends nothing until an authorised card
// is tapped. The WiFi and API details are entered on the station's own setup hotspot
// (src/net/setup_portal.cpp), not compiled in. A local "bin nearly full" warning works even
// offline. Setup and calibration: README.md.

#include <Arduino.h>
#include <WiFi.h>

#include "bin_alert.h"
#include "config.h"
#include "hold_button.h"
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
ecopantry::BinAlert binAlert(config::kBinFullGrams, config::kBinClearGrams, config::kBinConfirmMs,
                           config::kBinBeepGapMs);
ecopantry::HoldButton bootButton(config::kBootHoldMs);

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
    case uplink::ScanOutcome::Setup:
      showMessage(tappedUid, "SETUP OPEN", nowMs, config::kCardShownMs);
      indicators.signal(Signal::Problem, nowMs, config::kCardShownMs);
      break;
    case uplink::ScanOutcome::Locked:
      showMessage(tappedUid, "TOKEN REFUSED", nowMs, config::kCardShownMs);
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

// --- local alarms and the BOOT button ---------------------------------------------------

// Works offline and outside live sessions: it only looks at the station's own load cell.
void handleBinAlert(uint32_t nowMs) {
  const auto change = binAlert.update(loadCell.ok(), loadCell.grams(), nowMs);
  if (change == ecopantry::BinAlert::Change::BecameFull) {
    Serial.printf("[bin] nearly full: %.1f kg\n", loadCell.grams() / 1000.0f);
  } else if (change == ecopantry::BinAlert::Change::Cleared) {
    Serial.println("[bin] emptied: warning cleared");
  }
  if (binAlert.takeBeep(nowMs)) indicators.beepOnce(nowMs);
}

// Held 5 s while running: forget the WiFi and open the setup hotspot. (Held while powering
// on or pressing EN, the same button puts the ESP32 in flashing mode instead.)
void handleBootButton(uint32_t nowMs) {
  if (!bootButton.update(digitalRead(config::kBootButtonPin) == LOW, nowMs)) return;
  uplink::forgetWifi();
  showMessage("WIFI FORGOTTEN", "SETUP STARTING", nowMs);
  indicators.signal(Signal::Granted, nowMs, config::kMessageMs);
  Serial.println("[setup] BOOT held: forgetting the WiFi details and opening the setup hotspot.");
}

// --- screen ------------------------------------------------------------------------

// Second line of the home screen: is the station talking to the server?
void connectionLine(const uplink::Status& s, char* line) {
  if (s.state == ecopantry::SessionState::Locked) {
    strcpy(line, "TOKEN REFUSED");
  } else if (s.hotspotOpen || !s.haveSettings) {
    strcpy(line, s.hotspotOpen ? ecopantry::hotspotReasonLcd(s.hotspotReason) : "NOT SET UP");
  } else if (!s.wifiConnected) {
    strcpy(line, s.joining ? "CONNECTING..." : "WIFI OFFLINE");
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

// The screen rotates through pages every kScreenPageMs. The home page (temperature, humidity
// and the connection or token problem) is always one of them, and "BIN NEARLY FULL" and the
// setup instructions are added while they apply, so no critical state is ever hidden.
enum class Page : uint8_t { Home, SetupName, SetupPassword, SetupAddress, Connecting, BinFull };

void showPage(Page page, uint32_t nowMs, const uplink::Status& status) {
  char line1[17], line2[17];
  switch (page) {
    case Page::SetupName:
      strlcpy(line1, ecopantry::hotspotReasonLcd(status.hotspotReason), sizeof line1);
      strlcpy(line2, status.hotspotName, sizeof line2);
      break;
    case Page::SetupPassword:
      strcpy(line1, "HOTSPOT PASSWORD");
      strlcpy(line2, status.hotspotPassword, sizeof line2);
      break;
    case Page::SetupAddress:
      strcpy(line1, "OPEN IN BROWSER:");
      strcpy(line2, "192.168.4.1");
      break;
    case Page::Connecting:
      strcpy(line1, "CONNECTING TO:");
      strlcpy(line2, status.ssid, sizeof line2);
      break;
    case Page::BinFull:
      strcpy(line1, "BIN NEARLY FULL");
      snprintf(line2, sizeof line2, "%.1f KG - EMPTY IT", loadCell.grams() / 1000.0f);
      break;
    case Page::Home:
    default:
      if (climate.ok(nowMs)) {
        snprintf(line1, sizeof line1, "T:%.1fC  H:%.0f%%", climate.temperatureC(), climate.humidityPct());
      } else {
        strcpy(line1, "DHT11 ERROR");
      }
      connectionLine(status, line2);
      break;
  }
  display.show(line1, line2);
}

void updateScreen(uint32_t nowMs, const uplink::Status& status) {
  // A card tap or calibration message replaces the pages for a few seconds.
  if (message.active) {
    if (static_cast<int32_t>(nowMs - message.untilMs) < 0) {
      display.show(message.line1, message.line2);
      return;
    }
    message.active = false;
  }

  // A button hold in progress is shown at once, so the person knows it is being counted.
  if (bootButton.heldMs(nowMs) > 500) {
    display.show("KEEP HOLDING...", "TO RESET WIFI");
    return;
  }

  Page pages[6];
  size_t count = 0;
  if (status.hotspotOpen) {
    pages[count++] = Page::SetupName;
    pages[count++] = Page::SetupPassword;
    pages[count++] = Page::SetupAddress;
  } else if (status.joining) {
    pages[count++] = Page::Connecting;
  }
  pages[count++] = Page::Home;
  if (binAlert.full()) pages[count++] = Page::BinFull;
  showPage(pages[(nowMs / config::kScreenPageMs) % count], nowMs, status);
}

void updateIndicators(uint32_t nowMs, const uplink::Status& status) {
  if (status.hotspotOpen) {
    indicators.setAmbient(Ambient::Setup);
  } else if (status.state == ecopantry::SessionState::Locked) {
    indicators.setAmbient(Ambient::Locked);
  } else if (status.state == ecopantry::SessionState::Live) {
    indicators.setAmbient(Ambient::Live);
  } else {
    indicators.setAmbient(Ambient::Off);
  }
  indicators.setBinFull(binAlert.full());
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
  Serial.println(F("  setup             open the setup hotspot (nothing is forgotten)"));
  Serial.println(F("  wifi reset        forget the WiFi name and password, open the setup hotspot"));
  Serial.println(F("  factory reset     erase ALL saved settings and calibration, then restart"));
}

void printStatus(uint32_t nowMs) {
  const uplink::Status s = uplink::status();
  const ecopantry::PhCalibration& ph = phProbe.calibration();
  Serial.printf("firmware %s, uptime %lu s\n", FIRMWARE_VERSION, static_cast<unsigned long>(nowMs / 1000));
  char saved[160];
  uplink::describeSettings(saved, sizeof saved);
  Serial.printf("settings: %s, WiFi network \"%s\"\n", saved, s.ssid[0] ? s.ssid : "(none)");
  Serial.printf("wifi %s", s.wifiConnected ? "connected" : "offline");
  if (s.wifiConnected) Serial.printf(" (%s, RSSI %d dBm)", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  Serial.println();
  if (s.hotspotOpen) {
    Serial.printf("setup hotspot OPEN (%s): %s, password %s, http://192.168.4.1\n",
                  ecopantry::hotspotReasonName(s.hotspotReason), s.hotspotName, s.hotspotPassword);
  }
  Serial.printf("bin %s\n", binAlert.full() ? "NEARLY FULL" : "ok");
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
  } else if (strcmp(line, "setup") == 0) {
    uplink::openSetup();
    Serial.println(F("Opening the setup hotspot (uploads pause while it is open)."));
  } else if (strcmp(line, "wifi reset") == 0) {
    uplink::forgetWifi();
    showMessage("WIFI FORGOTTEN", "SETUP STARTING", nowMs);
    Serial.println(F("Forgetting the WiFi name and password; the API address and token stay saved."));
  } else if (strcmp(line, "factory reset") == 0) {
    Serial.println(F("Erasing ALL saved settings and calibration, then restarting."));
    display.show("FACTORY RESET", "RESTARTING...");
    uplink::factoryReset();
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

  pinMode(config::kBootButtonPin, INPUT_PULLUP);
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
  handleBootButton(now);
  handleBinAlert(now);
  sampleForUpload(now, status);
  updateScreen(now, status);
  updateIndicators(now, status);
  serialReport(now, status);
  delay(1);  // let the idle task run (watchdog)
}
