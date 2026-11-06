#include "load_cell.h"

#include <HX711.h>

#include "config.h"
#include "moving_average.h"

namespace {
HX711 scale;
ecopantry::MovingAverage<5> average;
}  // namespace

bool LoadCell::begin(float calibrationFactor) {
  scale.begin(config::kHx711DataPin, config::kHx711ClockPin);
  available_ = scale.wait_ready_timeout(5000);
  if (!available_) return false;
  setFactor(calibrationFactor);
  return tare();
}

void LoadCell::update() {
  if (!available_ || !scale.is_ready()) return;
  average.add(scale.get_units(1));
  float value = average.value();
  if (value < 0 && value > -0.5f) value = 0.0f;  // tare drift around zero, as in the sketch
  grams_ = value;
  hasValue_ = average.size() > 0;
}

bool LoadCell::tare() {
  if (!available_ || !scale.wait_ready_timeout(2000)) return false;
  scale.tare(config::kTareSamples);
  average.reset();
  hasValue_ = false;
  return true;
}

float LoadCell::calibrate(float knownGrams) {
  if (!available_ || knownGrams <= 0 || !scale.wait_ready_timeout(2000)) return 0;
  scale.set_scale(1.0f);
  const float raw = scale.get_units(10);  // blocks ~1 s; only from the serial console
  if (raw == 0) {
    scale.set_scale(factor_);
    return 0;
  }
  setFactor(raw / knownGrams);
  return factor_;
}

void LoadCell::setFactor(float factor) {
  if (factor == 0 || isnan(factor)) return;
  factor_ = factor;
  scale.set_scale(factor_);
  average.reset();
}
