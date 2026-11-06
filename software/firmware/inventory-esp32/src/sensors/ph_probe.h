// Analog pH probe board through a resistor divider into GPIO34.
// EXPERIMENTAL: never use the value on its own to decide whether food is safe or spoiled.
//
// Samples are taken one at a time, 2 ms apart, across loop() calls (the sketch took all
// 30 in a blocking burst every second).
#pragma once

#include <Arduino.h>

#include "ph.h"

class PhProbe {
 public:
  void begin(const ecopantry::PhCalibration& calibration);
  void update(uint32_t nowMs);

  bool hasValue() const { return hasValue_; }
  float voltage() const { return voltage_; }
  float ph() const { return ecopantry::voltageToPh(voltage_, calibration_); }

  const ecopantry::PhCalibration& calibration() const { return calibration_; }
  void setCalibration(const ecopantry::PhCalibration& calibration) { calibration_ = calibration; }

 private:
  ecopantry::PhCalibration calibration_ = ecopantry::kDefaultPhCalibration;
  uint32_t total_ = 0;
  uint8_t taken_ = 0;
  uint32_t lastSampleMs_ = 0;
  uint32_t lastBurstMs_ = 0;
  float voltage_ = 0;
  bool hasValue_ = false;
};
