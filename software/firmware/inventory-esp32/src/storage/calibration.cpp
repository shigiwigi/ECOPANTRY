#include "calibration.h"

#include <Preferences.h>

#include "config.h"

namespace {
constexpr const char* kNamespace = "ecopantry";
}

Calibration loadCalibration() {
  Preferences prefs;
  Calibration cal{config::kLoadCellFactor, ecopantry::kDefaultPhCalibration};
  if (!prefs.begin(kNamespace, true)) return cal;  // nothing saved yet
  cal.loadCellFactor = prefs.getFloat("lc_factor", cal.loadCellFactor);
  cal.ph.slope = prefs.getFloat("ph_slope", cal.ph.slope);
  cal.ph.intercept = prefs.getFloat("ph_int", cal.ph.intercept);
  prefs.end();
  return cal;
}

void saveLoadCellFactor(float factor) {
  Preferences prefs;
  if (!prefs.begin(kNamespace, false)) return;
  prefs.putFloat("lc_factor", factor);
  prefs.end();
}

void savePhCalibration(const ecopantry::PhCalibration& ph) {
  Preferences prefs;
  if (!prefs.begin(kNamespace, false)) return;
  prefs.putFloat("ph_slope", ph.slope);
  prefs.putFloat("ph_int", ph.intercept);
  prefs.end();
}

void resetCalibration() {
  Preferences prefs;
  if (!prefs.begin(kNamespace, false)) return;
  prefs.clear();
  prefs.end();
}
