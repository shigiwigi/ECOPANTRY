// DHT11 temperature and humidity.
#pragma once

#include <Arduino.h>

class Climate {
 public:
  void begin();
  void update(uint32_t nowMs);

  // False until the first good read, and again if no good read for a few intervals.
  bool ok(uint32_t nowMs) const;
  float temperatureC() const { return temperatureC_; }
  float humidityPct() const { return humidityPct_; }

 private:
  float temperatureC_ = NAN;
  float humidityPct_ = NAN;
  uint32_t lastReadMs_ = 0;
  uint32_t lastGoodMs_ = 0;
  bool everGood_ = false;
};
