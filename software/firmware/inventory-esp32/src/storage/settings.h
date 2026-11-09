// WiFi details, API address and device token, saved in flash (NVS) from the setup page.
//
// Stored in plain NVS: anyone with the board and a USB cable can read them back, just as
// they could when they were compiled in. They are never printed or sent to the page.
// Kept in their own NVS namespace, so `cal reset` doesn't touch them.
#pragma once

#include "setup_form.h"

// Fills `out` with whatever is saved (empty fields when nothing is).
void loadSettings(ecopantry::StationSettings* out);
bool saveSettings(const ecopantry::StationSettings& settings);
// Forgets the WiFi name and password; the API address and token stay.
void forgetWifiSettings();
// Erases the whole NVS partition: settings, calibration and the WiFi driver's own data
// (older firmware let the driver keep a copy of the WiFi password there). Restart after it.
void eraseAllSettings();
