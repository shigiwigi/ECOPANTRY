// Everything that talks to the EcoPantry API, on its own FreeRTOS task (core 0), so a slow
// request (Render can take a minute to wake) never freezes the LCD or the card reader.
// The same task owns the radio: it joins the saved WiFi and runs the setup hotspot
// (src/net/setup_portal.cpp; the rules are in lib/ecopantry_core/src/wifi_setup.h).
//
// The station uploads only during a live session (see lib/ecopantry_core/src/live_session.h):
//   power-on      -> POST /device/session      short session (server: 5 min)
//   card tapped   -> POST /device/rfid-scans   a granted card opens/extends one (15 min)
//   while live    -> POST /device/readings     every report interval
//   session over  -> nothing at all until the next tap or reboot
// and makes no API request at all while the setup hotspot is open.
#pragma once

#include <Arduino.h>

#include "live_session.h"
#include "reading.h"
#include "setup_form.h"
#include "uid.h"
#include "wifi_setup.h"

namespace uplink {

enum class ScanOutcome : uint8_t { Granted, Denied, Offline, Setup, Locked, Error };

struct ScanResult {
  ScanOutcome outcome;
  char result[24];       // the server's result code, e.g. "unknown_card"
  char displayName[17];  // up to 16 characters, for the LCD
  bool live;
  bool budgetExhausted;
};

struct Status {
  bool haveSettings;   // WiFi, API address and token saved and valid
  bool wifiConnected;
  bool joining;        // a join attempt is in progress (LCD: CONNECTING TO:)
  char ssid[ecopantry::kSsidMaxLength + 1];  // the saved network's name (not secret)
  bool hotspotOpen;
  ecopantry::HotspotReason hotspotReason;
  char hotspotName[ecopantry::kHotspotNameSize];
  char hotspotPassword[ecopantry::kHotspotPasswordLength + 1];  // for the LCD and serial only
  ecopantry::SessionState state;
  uint32_t remainingMs;
  bool budgetExhausted;
  uint32_t reportIntervalMs;
  int lastHttpCode;  // 0 before the first request; negative for network/TLS errors
  size_t buffered;
  uint32_t uploadsOk;
  uint32_t uploadsFailed;
};

void start();
Status status();

// Milliseconds since boot, 64-bit (never wraps). Used to time readings.
uint64_t uptimeMs();

// Queue a reading for upload. Ignored unless the station is live.
void addReading(const ecopantry::Reading& reading);

// Ask the server about a card. False if a scan is already waiting to be sent.
bool requestScan(const char* uid);
bool takeScanResult(ScanResult* out);

// Ask for a boot session again (serial `session`). Counts against the daily budget.
void restartSession();

// Open the setup hotspot without forgetting anything (serial `setup`).
void openSetup();
// Forget the WiFi name and password and open the hotspot (BOOT held 5 s, `wifi reset`).
// The API address and token stay saved.
void forgetWifi();
// Erase every saved setting and calibration, then restart (`factory reset`).
void factoryReset();

// The saved API address, for `status` (never the token or WiFi password).
void describeSettings(char* out, size_t outSize);

}  // namespace uplink
