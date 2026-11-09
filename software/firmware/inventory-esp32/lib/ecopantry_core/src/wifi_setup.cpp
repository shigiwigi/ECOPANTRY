#include "wifi_setup.h"

#include <cstdio>

namespace ecopantry {
namespace {

// Unsigned subtraction keeps working when millis() wraps after 49 days.
uint32_t elapsed(uint32_t nowMs, uint32_t sinceMs) { return nowMs - sinceMs; }
bool due(uint32_t nowMs, uint32_t atMs) { return static_cast<int32_t>(nowMs - atMs) >= 0; }

}  // namespace

const char* hotspotReasonName(HotspotReason reason) {
  switch (reason) {
    case HotspotReason::None: return "closed";
    case HotspotReason::NotSetUp: return "not set up";
    case HotspotReason::CannotJoin: return "can't join the saved WiFi";
    case HotspotReason::TokenRefused: return "device token refused";
    case HotspotReason::Requested: return "opened from the console";
  }
  return "?";
}

const char* hotspotReasonLcd(HotspotReason reason) {
  switch (reason) {
    case HotspotReason::None: return "";
    case HotspotReason::NotSetUp: return "NOT SET UP";
    case HotspotReason::CannotJoin: return "CAN'T JOIN WIFI";
    case HotspotReason::TokenRefused: return "TOKEN REFUSED";
    case HotspotReason::Requested: return "SETUP OPEN";
  }
  return "";
}

void WifiSetup::begin(bool haveSettings, uint32_t nowMs) {
  haveSettings_ = haveSettings;
  connected_ = false;
  reason_ = HotspotReason::None;
  savedSinceOpened_ = false;
  attemptedOnce_ = false;
  failingSinceMs_ = nowMs;
  nextAttemptMs_ = nowMs;
  if (!haveSettings_) open(HotspotReason::NotSetUp, nowMs);
}

void WifiSetup::open(HotspotReason reason, uint32_t nowMs) {
  if (reason_ == HotspotReason::None) openedMs_ = nowMs;
  reason_ = reason;
  savedSinceOpened_ = false;
}

void WifiSetup::update(bool wifiConnected, uint32_t nowMs) {
  if (connected_ && !wifiConnected) failingSinceMs_ = nowMs;  // dropped: the 2-minute clock starts
  connected_ = wifiConnected;

  if (!haveSettings_) {
    if (reason_ != HotspotReason::NotSetUp) open(HotspotReason::NotSetUp, nowMs);
    return;
  }

  if (connected_) {
    const bool settled = savedSinceOpened_ && elapsed(nowMs, savedMs_) >= t_.afterSaveMs;
    bool close = false;
    switch (reason_) {
      case HotspotReason::None: break;
      case HotspotReason::CannotJoin: close = !savedSinceOpened_ || settled; break;
      case HotspotReason::NotSetUp:
      case HotspotReason::TokenRefused: close = settled; break;
      case HotspotReason::Requested: close = settled || elapsed(nowMs, openedMs_) >= t_.requestedIdleMs; break;
    }
    if (close) {
      reason_ = HotspotReason::None;
      savedSinceOpened_ = false;
    }
    return;
  }

  if (reason_ == HotspotReason::None && elapsed(nowMs, failingSinceMs_) >= t_.openHotspotAfterMs) {
    open(HotspotReason::CannotJoin, nowMs);
  }
}

bool WifiSetup::takeJoinAttempt(uint32_t nowMs) {
  if (!haveSettings_ || connected_ || !due(nowMs, nextAttemptMs_)) return false;
  attemptedOnce_ = true;
  lastAttemptMs_ = nowMs;
  nextAttemptMs_ = nowMs + (hotspotOpen() ? t_.retryWithHotspotMs : t_.retryMs);
  return true;
}

void WifiSetup::onSaved(bool wifiChanged, uint32_t nowMs) {
  haveSettings_ = true;
  savedSinceOpened_ = true;
  savedMs_ = nowMs;
  if (wifiChanged) {
    failingSinceMs_ = nowMs;
    nextAttemptMs_ = nowMs + t_.afterSaveMs;  // after the "saved" page has gone out
  }
}

void WifiSetup::onTokenRefused(uint32_t nowMs) { open(HotspotReason::TokenRefused, nowMs); }

void WifiSetup::onSetupRequested(uint32_t nowMs) {
  if (!hotspotOpen()) open(HotspotReason::Requested, nowMs);
}

void WifiSetup::onWifiForgotten(uint32_t nowMs) {
  haveSettings_ = false;
  attemptedOnce_ = false;
  open(HotspotReason::NotSetUp, nowMs);
}

bool WifiSetup::joining(uint32_t nowMs) const {
  return haveSettings_ && !connected_ && attemptedOnce_ && elapsed(nowMs, lastAttemptMs_) < t_.attemptShownMs;
}

// --- the hotspot itself ---------------------------------------------------------------

void makeHotspotName(const uint8_t mac[6], char (&out)[kHotspotNameSize]) {
  snprintf(out, sizeof out, "EcoPantry-%02X%02X", mac[4], mac[5]);
}

void makeHotspotPassword(RandomSource random, char (&out)[kHotspotPasswordLength + 1]) {
  static const char kAlphabet[] = "abcdefghjkmnpqrstuvwxyz23456789";
  constexpr uint32_t kSize = sizeof kAlphabet - 1;
  // Values at or above `limit` are drawn again, so every character is equally likely.
  constexpr uint32_t kLimit = UINT32_MAX - (UINT32_MAX % kSize);
  for (size_t i = 0; i < kHotspotPasswordLength; ++i) {
    uint32_t value;
    do {
      value = random();
    } while (value >= kLimit);
    out[i] = kAlphabet[value % kSize];
  }
  out[kHotspotPasswordLength] = '\0';
}

bool isSetupClient(uint32_t localIp, uint32_t remoteIp, uint32_t hotspotIp, uint32_t hotspotMask) {
  return localIp == hotspotIp && remoteIp != hotspotIp && (remoteIp & hotspotMask) == (hotspotIp & hotspotMask);
}

}  // namespace ecopantry
