// Local "bin nearly full" warning from the waste bin's load cell.
//
// Works offline and outside live sessions: it only looks at the station's own readings.
//   - becomes full when the filtered weight stays at or above `fullGrams` for `confirmMs`
//   - clears when it stays below `clearGrams` for `confirmMs` (hysteresis: no flicker
//     around the threshold, and a hand pressing on the bin doesn't trigger it)
//   - readings from a failed load cell (load_cell_ok false, or NaN) are ignored: they
//     neither raise nor clear the warning
//   - the buzzer sounds once when the bin becomes full, never more often than `beepGapMs`
#pragma once

#include <cstdint>

namespace ecopantry {

class BinAlert {
 public:
  enum class Change : uint8_t { None, BecameFull, Cleared };

  BinAlert(float fullGrams, float clearGrams, uint32_t confirmMs, uint32_t beepGapMs)
      : fullGrams_(fullGrams), clearGrams_(clearGrams), confirmMs_(confirmMs), beepGapMs_(beepGapMs) {}

  Change update(bool sensorOk, float grams, uint32_t nowMs);
  bool full() const { return full_; }
  // True once per "became full" when the buzzer may sound (rate-limited).
  bool takeBeep(uint32_t nowMs);

 private:
  float fullGrams_, clearGrams_;
  uint32_t confirmMs_, beepGapMs_;
  bool full_ = false;
  bool pending_ = false;  // crossed the threshold, waiting for confirmMs
  uint32_t pendingSinceMs_ = 0;
  bool beepDue_ = false;
  bool beeped_ = false;
  uint32_t lastBeepMs_ = 0;
};

}  // namespace ecopantry
