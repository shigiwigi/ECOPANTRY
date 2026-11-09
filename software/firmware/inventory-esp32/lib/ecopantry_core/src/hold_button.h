// A button that must be held down for a while (BOOT held 5 s forgets the WiFi).
// Fires once per press; any release starts the count again. Time is passed in.
#pragma once

#include <cstdint>

namespace ecopantry {

class HoldButton {
 public:
  explicit HoldButton(uint32_t holdMs) : holdMs_(holdMs) {}

  // Returns true once, when the button has been held for `holdMs` without a release.
  bool update(bool pressed, uint32_t nowMs) {
    if (!pressed) {
      pressed_ = fired_ = false;
      return false;
    }
    if (!pressed_) {
      pressed_ = true;
      sinceMs_ = nowMs;
    }
    if (fired_ || nowMs - sinceMs_ < holdMs_) return false;
    fired_ = true;
    return true;
  }

  // How long the current press has lasted (0 when released or once it has fired).
  uint32_t heldMs(uint32_t nowMs) const { return pressed_ && !fired_ ? nowMs - sinceMs_ : 0; }
  uint32_t holdMs() const { return holdMs_; }

 private:
  uint32_t holdMs_;
  bool pressed_ = false;
  bool fired_ = false;
  uint32_t sinceMs_ = 0;
};

}  // namespace ecopantry
