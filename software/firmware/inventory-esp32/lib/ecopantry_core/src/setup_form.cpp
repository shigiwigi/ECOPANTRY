#include "setup_form.h"

#include <cstring>

namespace ecopantry {
namespace {

bool isSpace(char c) { return c == ' ' || c == '\t' || c == '\r' || c == '\n'; }
bool isDigit(char c) { return c >= '0' && c <= '9'; }
bool isAlnum(char c) { return isDigit(c) || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); }

int hexValue(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

// Drops leading and trailing whitespace in place.
void trim(char* text) {
  size_t start = 0;
  while (isSpace(text[start])) ++start;
  size_t end = strlen(text);
  while (end > start && isSpace(text[end - 1])) --end;
  memmove(text, text + start, end - start);
  text[end - start] = '\0';
}

// Copies a field that has already been checked to fit.
template <size_t N>
void copyField(char (&out)[N], const char* value) {
  strncpy(out, value, N - 1);
  out[N - 1] = '\0';
}

SettingsError fieldStatusError(FieldStatus status) {
  switch (status) {
    case FieldStatus::TooLong: return SettingsError::TooLong;
    case FieldStatus::BadEncoding: return SettingsError::BadEncoding;
    default: return SettingsError::None;
  }
}

// Every field is decoded into this much room first, so spaces around a pasted value can
// be trimmed before its real length limit is checked.
constexpr size_t kScratchSize = 192;

}  // namespace

const char* settingsErrorText(SettingsError error) {
  switch (error) {
    case SettingsError::None: return "";
    case SettingsError::BadEncoding: return "Contains characters that aren't allowed.";
    case SettingsError::TooLong: return "Too long.";
    case SettingsError::SsidMissing: return "Pick a network or type its name.";
    case SettingsError::PasswordLength:
      return "WiFi passwords are 8 to 63 characters. Leave it empty for an open network.";
    case SettingsError::PasswordCharacters: return "Use plain letters, digits and symbols (no accents or emoji).";
    case SettingsError::ApiUrlMissing: return "Enter the API address.";
    case SettingsError::ApiUrlScheme: return "The API address must start with https://.";
    case SettingsError::ApiUrlHttpNotAllowed:
      return "http:// only works with the esp32dev-lan firmware. Use the https:// address.";
    case SettingsError::ApiUrlFormat: return "Use the form https://your-service.onrender.com/api/v1.";
    case SettingsError::TokenMissing: return "Enter the device token. None is saved yet.";
    case SettingsError::TokenFormat: return "A device token is epd_ followed by 43 letters, digits, - or _.";
  }
  return "";
}

SettingsError checkSsid(const char* ssid) {
  const size_t length = strlen(ssid);
  if (length == 0) return SettingsError::SsidMissing;
  if (length > kSsidMaxLength) return SettingsError::TooLong;
  for (size_t i = 0; i < length; ++i) {
    const unsigned char c = static_cast<unsigned char>(ssid[i]);
    if (c < 0x20 || c == 0x7F) return SettingsError::BadEncoding;
  }
  return SettingsError::None;
}

SettingsError checkWifiPassword(const char* password) {
  const size_t length = strlen(password);
  if (length == 0) return SettingsError::None;  // open network
  if (length < kWifiPasswordMinLength || length > kWifiPasswordMaxLength) return SettingsError::PasswordLength;
  for (size_t i = 0; i < length; ++i) {
    const unsigned char c = static_cast<unsigned char>(password[i]);
    if (c < 0x20 || c > 0x7E) return SettingsError::PasswordCharacters;  // WPA2 passphrases are printable ASCII
  }
  return SettingsError::None;
}

SettingsError checkApiUrl(const char* url, bool allowHttp) {
  const size_t length = strlen(url);
  if (length == 0) return SettingsError::ApiUrlMissing;
  if (length > kApiUrlMaxLength) return SettingsError::TooLong;

  const char* rest;
  if (strncmp(url, "https://", 8) == 0) {
    rest = url + 8;
  } else if (strncmp(url, "http://", 7) == 0) {
    if (!allowHttp) return SettingsError::ApiUrlHttpNotAllowed;
    rest = url + 7;
  } else {
    return SettingsError::ApiUrlScheme;
  }

  // Host: letters, digits, dots and dashes (a name or an IPv4 address), then an optional port.
  const char* p = rest;
  while (isAlnum(*p) || *p == '.' || *p == '-') ++p;
  if (p == rest || *rest == '.' || *rest == '-' || p[-1] == '.' || p[-1] == '-') return SettingsError::ApiUrlFormat;
  if (*p == ':') {
    ++p;
    const char* digits = p;
    long port = 0;
    while (isDigit(*p) && p - digits < 5) port = port * 10 + (*p++ - '0');
    if (p == digits || isDigit(*p) || port < 1 || port > 65535) return SettingsError::ApiUrlFormat;
  }
  if (strcmp(p, "/api/v1") != 0) return SettingsError::ApiUrlFormat;
  return SettingsError::None;
}

SettingsError checkDeviceToken(const char* token) {
  const size_t length = strlen(token);
  if (length == 0) return SettingsError::TokenMissing;
  if (length != kTokenLength || strncmp(token, "epd_", kTokenPrefixLength) != 0) return SettingsError::TokenFormat;
  for (size_t i = kTokenPrefixLength; i < length; ++i) {
    if (!isAlnum(token[i]) && token[i] != '-' && token[i] != '_') return SettingsError::TokenFormat;
  }
  return SettingsError::None;
}

bool settingsComplete(const StationSettings& s, bool allowHttp) {
  return checkSsid(s.ssid) == SettingsError::None && checkWifiPassword(s.wifiPassword) == SettingsError::None &&
         checkApiUrl(s.apiUrl, allowHttp) == SettingsError::None &&
         checkDeviceToken(s.deviceToken) == SettingsError::None;
}

bool sameWifi(const StationSettings& a, const StationSettings& b) {
  return strcmp(a.ssid, b.ssid) == 0 && strcmp(a.wifiPassword, b.wifiPassword) == 0;
}

long urlDecode(const char* in, size_t inLength, char* out, size_t outSize, bool* tooLong) {
  if (tooLong) *tooLong = false;
  if (outSize == 0) return -1;
  size_t o = 0;
  for (size_t i = 0; i < inLength; ++i) {
    unsigned char c = static_cast<unsigned char>(in[i]);
    if (c == '+') {
      c = ' ';
    } else if (c == '%') {
      if (i + 2 >= inLength) return -1;  // needs two hex digits after it
      const int high = hexValue(in[i + 1]);
      const int low = hexValue(in[i + 2]);
      if (high < 0 || low < 0) return -1;
      c = static_cast<unsigned char>(high * 16 + low);
      i += 2;
    }
    if (c < 0x20 || c == 0x7F) return -1;
    if (o + 1 >= outSize) {
      if (tooLong) *tooLong = true;
      return -1;
    }
    out[o++] = static_cast<char>(c);
  }
  out[o] = '\0';
  return static_cast<long>(o);
}

FieldStatus formField(const char* body, size_t bodyLength, const char* name, char* out, size_t outSize) {
  const size_t nameLength = strlen(name);
  size_t start = 0;
  while (start <= bodyLength) {
    size_t end = start;
    while (end < bodyLength && body[end] != '&') ++end;
    const char* pair = body + start;
    const size_t pairLength = end - start;
    if (pairLength >= nameLength && strncmp(pair, name, nameLength) == 0 &&
        (pairLength == nameLength || pair[nameLength] == '=')) {
      const size_t valueStart = pairLength == nameLength ? pairLength : nameLength + 1;
      bool tooLong = false;
      if (urlDecode(pair + valueStart, pairLength - valueStart, out, outSize, &tooLong) < 0) {
        if (outSize > 0) out[0] = '\0';
        return tooLong ? FieldStatus::TooLong : FieldStatus::BadEncoding;
      }
      return FieldStatus::Ok;
    }
    start = end + 1;
  }
  if (outSize > 0) out[0] = '\0';
  return FieldStatus::Missing;
}

bool applySetupForm(const char* body, size_t bodyLength, const StationSettings& saved, bool allowHttp,
                    StationSettings* next, SetupErrors* errors) {
  SetupErrors e;
  StationSettings result;
  char value[kScratchSize];

  // Network name: typed (trimmed, phone keyboards add a space) wins over the picked one.
  FieldStatus status = formField(body, bodyLength, "ssid_other", value, sizeof value);
  trim(value);
  if (status == FieldStatus::Ok && value[0] == '\0') {
    status = formField(body, bodyLength, "ssid", value, sizeof value);  // picked from the list: exact
  } else if (status == FieldStatus::Missing) {
    status = formField(body, bodyLength, "ssid", value, sizeof value);
  }
  e.ssid = fieldStatusError(status);
  if (e.ssid == SettingsError::None) e.ssid = checkSsid(value);
  if (e.ssid == SettingsError::None) copyField(result.ssid, value);

  // WiFi password: never trimmed (spaces are allowed in passphrases).
  status = formField(body, bodyLength, "password", value, sizeof value);
  e.wifiPassword = fieldStatusError(status);
  if (e.wifiPassword == SettingsError::None) {
    if (value[0] == '\0' && e.ssid == SettingsError::None && strcmp(result.ssid, saved.ssid) == 0) {
      copyField(value, saved.wifiPassword);  // unchanged network: keep its saved password
    }
    e.wifiPassword = checkWifiPassword(value);
  }
  if (e.wifiPassword == SettingsError::None) copyField(result.wifiPassword, value);

  status = formField(body, bodyLength, "api_url", value, sizeof value);
  trim(value);
  const size_t urlLength = strlen(value);
  if (urlLength > 0 && value[urlLength - 1] == '/') value[urlLength - 1] = '\0';
  e.apiUrl = fieldStatusError(status);
  if (e.apiUrl == SettingsError::None) e.apiUrl = checkApiUrl(value, allowHttp);
  if (e.apiUrl == SettingsError::None) copyField(result.apiUrl, value);

  status = formField(body, bodyLength, "token", value, sizeof value);
  trim(value);
  e.deviceToken = fieldStatusError(status);
  if (e.deviceToken == SettingsError::None) {
    if (value[0] == '\0' && checkDeviceToken(saved.deviceToken) == SettingsError::None) {
      copyField(value, saved.deviceToken);  // empty keeps the saved token
    }
    e.deviceToken = checkDeviceToken(value);
  }
  if (e.deviceToken == SettingsError::None) copyField(result.deviceToken, value);

  memset(value, 0, sizeof value);  // it held a password or token
  if (errors) *errors = e;
  if (e.any()) return false;
  *next = result;
  return true;
}

size_t htmlEscape(const char* in, char* out, size_t outSize) {
  if (outSize == 0) return 0;
  size_t o = 0;
  for (const char* p = in; *p; ++p) {
    const char* entity = nullptr;
    switch (*p) {
      case '&': entity = "&amp;"; break;
      case '<': entity = "&lt;"; break;
      case '>': entity = "&gt;"; break;
      case '"': entity = "&quot;"; break;
      case '\'': entity = "&#39;"; break;
      default: break;
    }
    const size_t n = entity ? strlen(entity) : 1;
    if (o + n >= outSize) break;
    if (entity) {
      memcpy(out + o, entity, n);
    } else {
      out[o] = *p;
    }
    o += n;
  }
  out[o] = '\0';
  return o;
}

}  // namespace ecopantry
