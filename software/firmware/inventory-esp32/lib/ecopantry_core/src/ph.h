// pH probe maths. EXPERIMENTAL: a cheap analog pH board read through the ESP32 ADC is
// not a food-safety instrument, and its reading must never be used on its own to decide
// whether food is safe or spoiled.
#pragma once

namespace ecopantry {

struct PhCalibration {
  float slope;      // pH per volt at the probe board output
  float intercept;  // pH at 0 V
};

// The working sketch's experimental calibration (fitted with its divider and ADC maths).
constexpr PhCalibration kDefaultPhCalibration{-10.95f, 18.86f};

// Average raw ADC count -> voltage at the probe board output, undoing the resistor divider
// that keeps the board's 0-5 V output under the ESP32's 3.3 V ADC limit.
float adcToProbeVoltage(float averageAdc, float adcMax, float adcReferenceVolts, float dividerRatio);

float voltageToPh(float probeVolts, const PhCalibration& calibration);

// Two buffer solutions (for example pH 7.00 and pH 4.01). Returns false, leaving `out`
// untouched, when the two voltages are too close to give a usable slope.
bool calibrateTwoPoint(float volts1, float ph1, float volts2, float ph2, PhCalibration* out);

}  // namespace ecopantry
