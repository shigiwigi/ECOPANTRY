// The station's network settings and the setup page's form: decoding, checks and merging
// with what is already saved. Pure C++ so it is unit-tested on the host.
//
// The setup page posts application/x-www-form-urlencoded fields:
//   ssid        network picked from the scanned list ("" when "other" is picked)
//   ssid_other  network name typed by hand (hidden networks); wins over `ssid`
//   password    WiFi password: 8-63 characters, or empty
//   api_url     https://<host>/api/v1 (http:// only in the esp32dev-lan build)
//   token       device token, epd_ + 43 characters, or empty to keep the saved one
//
// The saved WiFi password and token are never sent back to the page.
#pragma once

#include <cstddef>
#include <cstdint>

namespace ecopantry {

constexpr size_t kSsidMaxLength = 32;
constexpr size_t kWifiPasswordMinLength = 8;
constexpr size_t kWifiPasswordMaxLength = 63;
constexpr size_t kApiUrlMaxLength = 120;
constexpr size_t kTokenPrefixLength = 4;                         // "epd_"
constexpr size_t kTokenLength = kTokenPrefixLength + 43;         // secrets.token_urlsafe(32)

struct StationSettings {
  char ssid[kSsidMaxLength + 1] = "";
  char wifiPassword[kWifiPasswordMaxLength + 1] = "";
  char apiUrl[kApiUrlMaxLength + 1] = "";
  char deviceToken[kTokenLength + 1] = "";
};

enum class SettingsError : uint8_t {
  None,
  BadEncoding,    // malformed %-escape, or a control character
  TooLong,
  SsidMissing,
  PasswordLength,
  PasswordCharacters,
  ApiUrlMissing,
  ApiUrlScheme,          // not https:// (or http:// in the LAN build)
  ApiUrlHttpNotAllowed,  // http:// in a normal build
  ApiUrlFormat,          // not <scheme>://<host>[:port]/api/v1
  TokenMissing,
  TokenFormat,
};

// A short sentence for the setup page.
const char* settingsErrorText(SettingsError error);

SettingsError checkSsid(const char* ssid);
SettingsError checkWifiPassword(const char* password);  // empty (open network) or 8-63 printable ASCII
SettingsError checkApiUrl(const char* url, bool allowHttp);
SettingsError checkDeviceToken(const char* token);      // empty is TokenMissing

// True when every saved setting is present and valid, so the station can go online.
bool settingsComplete(const StationSettings& settings, bool allowHttp);

// Same network name and password.
bool sameWifi(const StationSettings& a, const StationSettings& b);

// Decodes form text ('+' is a space, %XX a byte) into `out`, NUL-terminated. Returns the
// decoded length, or -1 when an escape is malformed, the text holds a control character
// (including NUL), or it doesn't fit in `out` with its terminator (`*tooLong` is then set).
long urlDecode(const char* in, size_t inLength, char* out, size_t outSize, bool* tooLong = nullptr);

enum class FieldStatus : uint8_t { Missing, Ok, TooLong, BadEncoding };

// Finds the first `name=value` pair in a form body and decodes the value into `out`.
FieldStatus formField(const char* body, size_t bodyLength, const char* name, char* out, size_t outSize);

struct SetupErrors {
  SettingsError ssid = SettingsError::None;
  SettingsError wifiPassword = SettingsError::None;
  SettingsError apiUrl = SettingsError::None;
  SettingsError deviceToken = SettingsError::None;
  bool any() const {
    return ssid != SettingsError::None || wifiPassword != SettingsError::None || apiUrl != SettingsError::None ||
           deviceToken != SettingsError::None;
  }
};

// Reads the setup page's POST body and merges it with `saved`:
//   - a typed network name wins over the one picked from the list
//   - an empty password keeps the saved one when the network name is unchanged and a
//     password is saved; otherwise it means an open network
//   - an empty token keeps the saved one (TokenMissing when none is saved)
//   - spaces around the API address and token are dropped, and so is one trailing '/'
// Returns true and fills `next` when every field is valid; otherwise fills `errors` and
// leaves `next` alone.
bool applySetupForm(const char* body, size_t bodyLength, const StationSettings& saved, bool allowHttp,
                    StationSettings* next, SetupErrors* errors);

// Escapes & < > " ' for HTML text and attribute values. Never cuts an entity in half:
// stops early (still NUL-terminated) when `out` is full. Returns the length written.
size_t htmlEscape(const char* in, char* out, size_t outSize);

}  // namespace ecopantry
