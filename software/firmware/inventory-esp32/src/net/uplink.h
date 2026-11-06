// Everything that talks to the EcoPantry API, on its own FreeRTOS task (core 0), so a slow
// request (Render can take a minute to wake) never freezes the LCD or the card reader.
//
// The station uploads only during a live session (see lib/ecopantry_core/src/live_session.h):
//   power-on      -> POST /device/session      short session (server: 5 min)
//   card tapped   -> POST /device/rfid-scans   a granted card opens/extends one (15 min)
//   while live    -> POST /device/readings     every report interval
//   session over  -> nothing at all until the next tap or reboot
#pragma once

#include <Arduino.h>

#include "live_session.h"
#include "reading.h"
#include "uid.h"

namespace uplink {

enum class ScanOutcome : uint8_t { Granted, Denied, Offline, Locked, Error };

struct ScanResult {
  ScanOutcome outcome;
  char result[24];       // the server's result code, e.g. "unknown_card"
  char displayName[17];  // up to 16 characters, for the LCD
  bool live;
  bool budgetExhausted;
};

struct Status {
  bool configOk;
  bool wifiConnected;
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

// Why the configuration was refused, or "" when it is fine.
const char* configProblem();

}  // namespace uplink
