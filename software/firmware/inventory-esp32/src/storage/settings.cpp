#include "settings.h"

#include <Preferences.h>
#include <nvs_flash.h>

namespace {
constexpr const char* kNamespace = "ep_net";

template <size_t N>
void readString(Preferences& prefs, const char* key, char (&out)[N]) {
  out[0] = '\0';
  if (prefs.isKey(key)) prefs.getString(key, out, N);
  out[N - 1] = '\0';
}

bool writeString(Preferences& prefs, const char* key, const char* value) {
  return prefs.putString(key, value) == strlen(value);
}
}  // namespace

void loadSettings(ecopantry::StationSettings* out) {
  *out = ecopantry::StationSettings();
  Preferences prefs;
  if (!prefs.begin(kNamespace, true)) return;  // nothing saved yet
  readString(prefs, "ssid", out->ssid);
  readString(prefs, "pass", out->wifiPassword);
  readString(prefs, "api", out->apiUrl);
  readString(prefs, "token", out->deviceToken);
  prefs.end();
}

bool saveSettings(const ecopantry::StationSettings& s) {
  Preferences prefs;
  if (!prefs.begin(kNamespace, false)) return false;
  const bool ok = writeString(prefs, "ssid", s.ssid) && writeString(prefs, "pass", s.wifiPassword) &&
                  writeString(prefs, "api", s.apiUrl) && writeString(prefs, "token", s.deviceToken);
  prefs.end();
  return ok;
}

void forgetWifiSettings() {
  Preferences prefs;
  if (!prefs.begin(kNamespace, false)) return;
  prefs.remove("ssid");
  prefs.remove("pass");
  prefs.end();
}

void eraseAllSettings() {
  nvs_flash_deinit();
  nvs_flash_erase();
}
