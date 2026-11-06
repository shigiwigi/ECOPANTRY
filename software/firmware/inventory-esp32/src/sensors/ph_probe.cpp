#include "ph_probe.h"

#include "config.h"

void PhProbe::begin(const ecopantry::PhCalibration& calibration) {
  calibration_ = calibration;
  analogReadResolution(12);
  analogSetPinAttenuation(config::kPhPin, ADC_11db);
}

void PhProbe::update(uint32_t nowMs) {
  if (taken_ == 0 && hasValue_ && nowMs - lastBurstMs_ < config::kPhIntervalMs) return;
  if (taken_ > 0 && nowMs - lastSampleMs_ < config::kPhSampleSpacingMs) return;

  if (taken_ == 0) lastBurstMs_ = nowMs;
  total_ += analogRead(config::kPhPin);
  lastSampleMs_ = nowMs;
  if (++taken_ < config::kPhSamples) return;

  const float averageAdc = static_cast<float>(total_) / config::kPhSamples;
  voltage_ = ecopantry::adcToProbeVoltage(averageAdc, config::kAdcMax, config::kAdcReferenceVolts,
                                          config::kPhDividerRatio);
  hasValue_ = true;
  total_ = 0;
  taken_ = 0;
}
