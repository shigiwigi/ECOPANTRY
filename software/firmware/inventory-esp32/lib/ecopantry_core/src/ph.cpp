#include "ph.h"

#include <cmath>

namespace ecopantry {

float adcToProbeVoltage(float averageAdc, float adcMax, float adcReferenceVolts, float dividerRatio) {
  if (adcMax <= 0.0f) return NAN;
  const float pinVolts = (averageAdc / adcMax) * adcReferenceVolts;
  return pinVolts * dividerRatio;
}

float voltageToPh(float probeVolts, const PhCalibration& calibration) {
  return calibration.slope * probeVolts + calibration.intercept;
}

bool calibrateTwoPoint(float volts1, float ph1, float volts2, float ph2, PhCalibration* out) {
  const float dv = volts2 - volts1;
  if (out == nullptr || std::fabs(dv) < 0.01f || !std::isfinite(dv)) return false;
  const float slope = (ph2 - ph1) / dv;
  out->slope = slope;
  out->intercept = ph1 - slope * volts1;
  return true;
}

}  // namespace ecopantry
