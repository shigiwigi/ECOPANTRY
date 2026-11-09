// Station configuration: pins (from the working all-sensors sketch), timings and
// calibration defaults. Calibration changed from the serial console is saved in flash
// (NVS) and overrides the defaults here; `cal reset` goes back to them.
// Wiring and cautions: hardware/inventory-station/README.md.
#pragma once

#include <cstddef>
#include <cstdint>

#define FIRMWARE_VERSION "0.2.0"

// Plain-http API addresses (a laptop on the LAN) are refused unless the build sets this to 1
// (the esp32dev-lan environment). Never ship it on.
#ifndef ECOPANTRY_ALLOW_HTTP
#define ECOPANTRY_ALLOW_HTTP 0
#endif

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

// The DevKit's BOOT button. Held 5 s while running, it forgets the WiFi and opens the setup
// hotspot. (Held while powering on or pressing EN, it puts the ESP32 in flashing mode instead.)
constexpr uint8_t kBootButtonPin = 0;

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

// WiFi and the setup hotspot (docs/HARDWARE_INTEGRATION.md). The WiFi details, API address
// and device token are entered on the hotspot's page and saved in flash, never compiled in.
constexpr uint32_t kWifiFailOpenHotspotMs = 2UL * 60UL * 1000UL;  // saved WiFi failing this long opens the hotspot
constexpr uint32_t kWifiRetryMs = 15000;                          // between join attempts
constexpr uint32_t kWifiRetryWithHotspotMs = 30000;               // between join attempts while the hotspot is open
constexpr uint32_t kSetupIdleCloseMs = 10UL * 60UL * 1000UL;      // `setup` with nothing saved closes after this
constexpr uint32_t kBootHoldMs = 5000;
constexpr uint8_t kHotspotMaxClients = 2;
constexpr uint32_t kScreenPageMs = 3000;  // LCD pages rotate this often (setup, bin warning)
constexpr bool kAllowHttpApi = ECOPANTRY_ALLOW_HTTP != 0;
// Only a suggestion pre-filled on the setup page; nothing is used until it is saved there.
constexpr const char* kSuggestedApiUrl = "https://ecopantry-api.onrender.com/api/v1";

// Waste bin "nearly full" warning, on the station itself (LCD, red LED, one short beep).
// Works offline and outside live sessions. Hysteresis: on at 2.0 kg, off below 1.5 kg.
constexpr float kBinFullGrams = 2000.0f;
constexpr float kBinClearGrams = 1500.0f;
constexpr uint32_t kBinConfirmMs = 5000;                  // must stay past a threshold this long
constexpr uint32_t kBinBeepGapMs = 10UL * 60UL * 1000UL;  // at most one beep per 10 minutes
constexpr uint32_t kLoadCellStaleMs = 1000;               // no HX711 sample this long: load_cell_ok false

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
