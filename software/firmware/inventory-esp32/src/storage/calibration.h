// Calibration values kept in flash (NVS) across reboots and reflashes.
#pragma once

#include "ph.h"

struct Calibration {
  float loadCellFactor;
  ecopantry::PhCalibration ph;
};

Calibration loadCalibration();
void saveLoadCellFactor(float factor);
void savePhCalibration(const ecopantry::PhCalibration& ph);
// Forgets saved values; the defaults in config.h apply after this.
void resetCalibration();
