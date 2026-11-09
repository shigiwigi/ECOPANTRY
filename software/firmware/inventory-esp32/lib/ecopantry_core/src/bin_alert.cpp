#include "bin_alert.h"

#include <cmath>

namespace ecopantry {

BinAlert::Change BinAlert::update(bool sensorOk, float grams, uint32_t nowMs) {
  if (!sensorOk || std::isnan(grams)) {
    pending_ = false;  // a fault neither raises nor clears it, and restarts the confirmation
    return Change::None;
  }

  const bool crossing = full_ ? grams < clearGrams_ : grams >= fullGrams_;
  if (!crossing) {
    pending_ = false;
    return Change::None;
  }
  if (!pending_) {
    pending_ = true;
    pendingSinceMs_ = nowMs;
  }
  if (nowMs - pendingSinceMs_ < confirmMs_) return Change::None;

  pending_ = false;
  full_ = !full_;
  if (full_) beepDue_ = true;
  return full_ ? Change::BecameFull : Change::Cleared;
}

bool BinAlert::takeBeep(uint32_t nowMs) {
  if (!beepDue_) return false;
  beepDue_ = false;
  if (beeped_ && nowMs - lastBeepMs_ < beepGapMs_) return false;
  beeped_ = true;
  lastBeepMs_ = nowMs;
  return true;
}

}  // namespace ecopantry
