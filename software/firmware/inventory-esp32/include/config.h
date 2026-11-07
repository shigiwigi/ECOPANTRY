// Station configuration: pins (from the working all-sensors sketch), timings and
// calibration defaults. Calibration changed from the serial console is saved in flash
// (NVS) and overrides the defaults here; `cal reset` goes back to them.
// Wiring and cautions: hardware/inventory-station/README.md.
#pragma once

#include <cstddef>
#include <cstdint>

#define FIRMWARE_VERSION "0.1.0"

namespace config {

// --- pins ------------------------------------------------------------------
constexpr uint8_t kDhtPin = 15;  // DHT11 data

constexpr uint8_t kRfidSsPin = 5;  // MFRC522 SDA/SS. MFRC522 is 3.3 V only.
constexpr uint8_t kRfidRstPin = 4;
constexpr uint8_t kSpiSckPin = 18;
constexpr uint8_t kSpiMisoPin = 19;
constexpr uint8_t kSpiMosiPin = 23;

constexpr uint8_t kI2cSdaPin = 21;  // LCD backpack (PCF8574)
constexpr uint8_t kI2cSclPin = 22;
constexpr uint8_t kLcdAddress = 0x27;
constexpr uint8_t kLcdColumns = 16;
constexpr uint8_t kLcdRows = 2;

constexpr uint8_t kHx711DataPin = 32;  // waste-bin load cell
constexpr uint8_t kHx711ClockPin = 33;

constexpr uint8_t kPhPin = 34;  // ADC1, input-only. Board output goes through the divider first.

constexpr uint8_t kGreenLedPin = 25;
constexpr uint8_t kRedLedPin = 26;
constexpr uint8_t kBuzzerPin = 27;
constexpr bool kBuzzerActiveLow = true;  // the sketch's buzzer is on when the pin is LOW

// --- timing (ms) -------------------------------------------------------------
constexpr uint32_t kDhtIntervalMs = 2000;        // DHT11 can't be read faster than ~1 Hz
constexpr uint32_t kDhtStaleMs = 3 * kDhtIntervalMs;
constexpr uint32_t kPhSampleSpacingMs = 2;       // 30 samples, 2 ms apart, like the sketch
constexpr uint8_t kPhSamples = 30;
constexpr uint32_t kPhIntervalMs = 1000;
constexpr uint32_t kCardShownMs = 3500;  // how long a card's ID and name stay on the LCD
constexpr uint32_t kMessageMs = 2500;
constexpr uint32_t kSerialReportMs = 5000;
constexpr uint32_t kSameCardIgnoreMs = 3000;     // one tap, one request
constexpr uint32_t kScanAnswerTimeoutMs = 20000; // Render can take ~a minute to wake; the LCD gives up sooner

// Uploads. The server sends the real interval in every answer (DEVICE_REPORT_INTERVAL_SECONDS).
constexpr uint32_t kDefaultReportIntervalMs = 3000;
constexpr uint32_t kHttpTimeoutMs = 15000;
constexpr uint32_t kMaxSessionMs = 60UL * 60UL * 1000UL;  // local cap, whatever the server says
constexpr uint32_t kRetryMinMs = 5000;
constexpr uint32_t kRetryMaxMs = 60000;
constexpr uint32_t kWifiRetryMinMs = 2000;
constexpr uint32_t kWifiRetryMaxMs = 30000;

// About 10 minutes of readings at 10 s, kept while the network is down. The API takes 50 per request.
constexpr size_t kReadingBufferSize = 60;
constexpr size_t kMaxBatch = 50;

// --- calibration defaults (from the working sketch) --------------------------
constexpr float kLoadCellFactor = 23.11f;
constexpr uint8_t kTareSamples = 15;
constexpr float kAdcReferenceVolts = 3.3f;
constexpr float kAdcMax = 4095.0f;
constexpr float kPhDividerRatio = 3.2f;  // board output = pin voltage * 3.2

}  // namespace config
