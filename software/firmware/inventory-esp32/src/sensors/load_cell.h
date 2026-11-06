// HX711 load cell under the waste bin.
//
// The original sketch called get_units(5), which blocks for about half a second at the
// HX711's 10 Hz rate and made card taps feel slow. This reads one sample whenever the
// HX711 has one ready and averages the last few in software instead.
#pragma once

#include <Arduino.h>

class LoadCell {
 public:
  // Tares with the platform empty. Returns false if the HX711 doesn't answer.
  bool begin(float calibrationFactor);
  void update();

  bool available() const { return available_; }
  bool ok() const { return available_ && hasValue_; }
  float grams() const { return grams_; }
  float factor() const { return factor_; }

  bool tare();
  // With a known weight on the platform: works out and applies the factor; returns it (0 on failure).
  float calibrate(float knownGrams);
  void setFactor(float factor);

 private:
  bool available_ = false;
  bool hasValue_ = false;
  float grams_ = 0;
  float factor_ = 1;
};
