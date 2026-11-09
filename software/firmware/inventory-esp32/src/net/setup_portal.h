// The setup hotspot: a WPA2 access point "EcoPantry-XXXX", a captive-portal DNS that sends
// every name to 192.168.4.1, and the setup page there. Runs on the uplink task (core 0),
// which owns the radio; the decisions about when it is open are in wifi_setup.h.
//
// The page is answered only for phones joined to the hotspot (see isSetupClient). It never
// sends back the saved WiFi password or device token.
#pragma once

#include <Arduino.h>

#include "setup_form.h"
#include "wifi_setup.h"

namespace setup_portal {

// What the page shows about the station. Owned and kept up to date by the uplink task.
struct Context {
  const ecopantry::StationSettings* saved;
  ecopantry::HotspotReason reason;
  bool wifiConnected;
};

// Called with the complete, checked settings from the page. Returns false if they couldn't
// be written to flash.
using SaveHandler = bool (*)(const ecopantry::StationSettings& next);

void open(const char* name, const char* password, const Context* context, SaveHandler onSave);
void close();
bool isOpen();
// Answers web requests and collects WiFi scan results. Call often while open.
void loop();
// A WiFi scan is running; join attempts wait for it.
bool scanning();

}  // namespace setup_portal
