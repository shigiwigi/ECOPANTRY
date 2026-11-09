// When the station joins its saved WiFi and when it opens its setup hotspot.
//
//   no usable settings ───────────────────────────► hotspot open (NotSetUp)
//   settings saved ─► join the WiFi ─ fails 2 min ─► hotspot open too (CannotJoin), keep retrying
//                          │ ok
//                          ▼
//                       ONLINE, hotspot closed ─► uploads allowed
//   server refuses the token (401) ───────────────► hotspot open (TokenRefused)
//   serial `setup` ───────────────────────────────► hotspot open (Requested)
//   BOOT held 5 s / `wifi reset` ─────────────────► WiFi forgotten ─► NotSetUp
//
// While the hotspot is open the station retries the saved WiFi every 30 s (instead of
// every 15 s) and makes no API requests. The hotspot closes again once the station is
// online and:
//   - CannotJoin: at once;
//   - NotSetUp / TokenRefused / Requested: once something has been saved from the page
//     (a few seconds later, so the "saved" page reaches the phone first);
//   - Requested: also after 10 minutes with nothing saved.
//
// Time is passed in (millis()), so this runs on the host in unit tests.
#pragma once

#include <cstddef>
#include <cstdint>

namespace ecopantry {

enum class HotspotReason : uint8_t { None, NotSetUp, CannotJoin, TokenRefused, Requested };

const char* hotspotReasonName(HotspotReason reason);
// At most 16 characters, for the LCD.
const char* hotspotReasonLcd(HotspotReason reason);

struct WifiSetupTiming {
  uint32_t openHotspotAfterMs = 120000;   // failing to join the saved WiFi this long opens the hotspot
  uint32_t retryMs = 15000;               // between join attempts, hotspot closed
  uint32_t retryWithHotspotMs = 30000;    // between join attempts, hotspot open
  uint32_t afterSaveMs = 3000;            // let the "saved" page reach the phone before switching
  uint32_t requestedIdleMs = 600000;      // `setup` with nothing saved closes after this (if online)
  uint32_t attemptShownMs = 12000;        // how long a join attempt counts as "connecting"
};

class WifiSetup {
 public:
  explicit WifiSetup(const WifiSetupTiming& timing = WifiSetupTiming()) : t_(timing) {}

  void begin(bool haveSettings, uint32_t nowMs);

  // Call every loop with the radio's state.
  void update(bool wifiConnected, uint32_t nowMs);

  // True when the driver should start a join attempt (WiFi.begin with the saved details) now.
  bool takeJoinAttempt(uint32_t nowMs);

  // Complete settings were saved from the page. `wifiChanged`: new network name or password.
  void onSaved(bool wifiChanged, uint32_t nowMs);
  void onTokenRefused(uint32_t nowMs);
  void onSetupRequested(uint32_t nowMs);
  // The WiFi details were cleared (BOOT held, `wifi reset`).
  void onWifiForgotten(uint32_t nowMs);

  bool hotspotOpen() const { return reason_ != HotspotReason::None; }
  HotspotReason reason() const { return reason_; }
  bool haveSettings() const { return haveSettings_; }
  bool connected() const { return connected_; }
  bool savedSinceOpened() const { return savedSinceOpened_; }
  // A join attempt started recently and hasn't succeeded yet (LCD: CONNECTING TO:).
  bool joining(uint32_t nowMs) const;
  // Uploads, boot sessions and card checks are allowed only online with the hotspot closed.
  bool apiAllowed() const { return connected_ && !hotspotOpen(); }

 private:
  void open(HotspotReason reason, uint32_t nowMs);

  WifiSetupTiming t_;
  bool haveSettings_ = false;
  bool connected_ = false;
  HotspotReason reason_ = HotspotReason::None;
  bool savedSinceOpened_ = false;
  bool attemptedOnce_ = false;
  uint32_t openedMs_ = 0;
  uint32_t savedMs_ = 0;
  uint32_t failingSinceMs_ = 0;
  uint32_t nextAttemptMs_ = 0;
  uint32_t lastAttemptMs_ = 0;
};

// --- the hotspot itself ---------------------------------------------------------------

// "EcoPantry-A1B2": the last two bytes of the MAC, so neighbouring stations differ.
constexpr size_t kHotspotNameSize = 15;
void makeHotspotName(const uint8_t mac[6], char (&out)[kHotspotNameSize]);

// Eight characters from an alphabet without look-alikes (no 0/o, 1/l/i), so it can be read
// off the LCD. `random` must be a good source (the ESP32's esp_random with the radio on).
constexpr size_t kHotspotPasswordLength = 8;
using RandomSource = uint32_t (*)();
void makeHotspotPassword(RandomSource random, char (&out)[kHotspotPasswordLength + 1]);

// The setup page is only for phones joined to the hotspot: the connection must have come
// in on the hotspot's own address, from an address inside its subnet. Addresses are the
// raw uint32 values of the same byte order (e.g. Arduino's IPAddress casts).
bool isSetupClient(uint32_t localIp, uint32_t remoteIp, uint32_t hotspotIp, uint32_t hotspotMask);

}  // namespace ecopantry
