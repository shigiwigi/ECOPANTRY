#include "setup_portal.h"

#include <DNSServer.h>
#include <WebServer.h>
#include <WiFi.h>

#include "config.h"

using ecopantry::HotspotReason;
using ecopantry::SettingsError;
using ecopantry::StationSettings;

namespace setup_portal {
namespace {

const IPAddress kHotspotIp(192, 168, 4, 1);
const IPAddress kHotspotMask(255, 255, 255, 0);
constexpr uint8_t kHotspotChannel = 1;  // moves to the router's channel once the station joins it
constexpr size_t kMaxNetworks = 20;
constexpr uint32_t kRescanMinMs = 10000;
constexpr size_t kMaxBody = 1024;  // the form is at most ~800 bytes even fully %-encoded

WebServer server(80);
DNSServer dns;
bool handlersAdded = false;
bool opened = false;
const Context* context = nullptr;
SaveHandler saveHandler = nullptr;
char hotspotName[ecopantry::kHotspotNameSize] = "";

struct Network {
  char ssid[ecopantry::kSsidMaxLength + 1];
  int32_t rssi;
  bool open;
};
Network networks[kMaxNetworks];
size_t networkCount = 0;
bool scanRunning = false;
bool scannedOnce = false;
uint32_t lastScanMs = 0;

char body[kMaxBody + 1];
size_t bodyLength = 0;
bool bodyTooLong = false;

// --- helpers -------------------------------------------------------------------------

bool fromHotspot() {
  NetworkClient& client = server.client();
  return ecopantry::isSetupClient(static_cast<uint32_t>(client.localIP()), static_cast<uint32_t>(client.remoteIP()),
                                  static_cast<uint32_t>(WiFi.softAPIP()),
                                  static_cast<uint32_t>(WiFi.softAPSubnetMask()));
}

void appendEscaped(String& out, const char* text) {
  static char escaped[ecopantry::kApiUrlMaxLength * 6 + 1];
  ecopantry::htmlEscape(text, escaped, sizeof escaped);
  out += escaped;
}

void startScan() {
  if (scanRunning) return;
  // Asynchronous: results are collected in loop(). Hidden networks are typed by hand.
  if (WiFi.scanNetworks(true, false) == WIFI_SCAN_RUNNING) {
    scanRunning = true;
    lastScanMs = millis();
  }
}

void collectScan() {
  if (!scanRunning) return;
  const int16_t found = WiFi.scanComplete();
  if (found == WIFI_SCAN_RUNNING) return;
  scanRunning = false;
  scannedOnce = true;
  networkCount = 0;
  for (int16_t i = 0; i < found; ++i) {
    const String ssid = WiFi.SSID(i);
    if (ssid.isEmpty() || ssid.length() > ecopantry::kSsidMaxLength) continue;
    const int32_t rssi = WiFi.RSSI(i);
    bool duplicate = false;  // one entry per name (several access points), keep the strongest
    for (size_t j = 0; j < networkCount; ++j) {
      if (strcmp(networks[j].ssid, ssid.c_str()) == 0) {
        if (rssi > networks[j].rssi) networks[j].rssi = rssi;
        duplicate = true;
        break;
      }
    }
    if (duplicate || networkCount == kMaxNetworks) continue;
    Network& n = networks[networkCount++];
    strlcpy(n.ssid, ssid.c_str(), sizeof n.ssid);
    n.rssi = rssi;
    n.open = WiFi.encryptionType(i) == WIFI_AUTH_OPEN;
  }
  if (found >= 0) WiFi.scanDelete();
  // Strongest first (insertion sort; at most 20 entries).
  for (size_t i = 1; i < networkCount; ++i) {
    const Network n = networks[i];
    size_t j = i;
    for (; j > 0 && networks[j - 1].rssi < n.rssi; --j) networks[j] = networks[j - 1];
    networks[j] = n;
  }
}

const char* signalWord(int32_t rssi) {
  if (rssi >= -60) return "strong";
  if (rssi >= -72) return "good";
  return "weak";
}

const char* reasonNote(HotspotReason reason) {
  switch (reason) {
    case HotspotReason::NotSetUp: return "This station has no WiFi details saved yet.";
    case HotspotReason::CannotJoin:
      return "The station couldn't join its saved WiFi for 2 minutes. It keeps trying every 30 s while this page "
             "is open.";
    case HotspotReason::TokenRefused:
      return "The server refused the device token: it was rotated, or the device was disabled. Paste the current "
             "token from the portal's Devices page.";
    case HotspotReason::Requested:
      return "Setup was opened from the serial console. It closes by itself after 10 minutes if nothing is saved.";
    case HotspotReason::None: break;
  }
  return "";
}

// --- the page --------------------------------------------------------------------------

const char kHead[] = R"html(<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>EcoPantry station setup</title>
<style>
:root{--bg:#F6F2E8;--card:#fff;--ink:#0E3529;--muted:#4f5f57;--line:#d9d0bb;--btn:#215F47;--err:#9b2c1f;--accent:#B89B4A}
@media(prefers-color-scheme:dark){:root{--bg:#0b211a;--card:#12302a;--ink:#f1ece0;--muted:#b9c4bd;--line:#2c4a40;--btn:#4B8A6C;--err:#f0a497}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 system-ui,sans-serif}
main{max-width:30rem;margin:0 auto;padding:16px}h1{font-size:1.3rem;margin:.2rem 0 1rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:16px;margin-bottom:16px}
label{display:block;font-weight:600;margin:14px 0 4px}input,select{width:100%;padding:10px;font:inherit;color:var(--ink);
background:var(--bg);border:1px solid var(--line);border-radius:6px}input:focus,select:focus{outline:2px solid var(--accent);outline-offset:1px}
.hint{color:var(--muted);font-size:.875rem;margin:4px 0 0}.err{color:var(--err);font-size:.875rem;font-weight:600;margin:4px 0 0}
.note{border-left:4px solid var(--accent);padding:8px 12px;margin:0 0 16px;background:var(--card)}
button{margin-top:20px;width:100%;padding:12px;font:inherit;font-weight:600;color:#fff;background:var(--btn);border:0;border-radius:6px}
a{color:inherit}small{color:var(--muted)}
</style></head><body><main>
)html";

const char kFoot[] = R"html(<p><small>This page is only reachable from the station's own hotspot. The saved WiFi password and
device token are never shown.</small></p></main></body></html>)html";

void appendError(String& page, SettingsError error) {
  if (error == SettingsError::None) return;
  page += F("<p class=\"err\">");
  page += ecopantry::settingsErrorText(error);
  page += F("</p>");
}

void sendHtml(int code, const String& page) {
  server.sendHeader("Cache-Control", "no-store");
  server.sendHeader("X-Content-Type-Options", "nosniff");
  server.send(code, "text/html; charset=utf-8", page);
}

// `typedSsid` / `typedUrl`: what was just submitted (non-secret fields only), to refill the
// form after an error. Null shows the saved values.
void sendForm(int code, const ecopantry::SetupErrors* errors, const char* typedSsid, const char* typedUrl) {
  const StationSettings& saved = *context->saved;
  const char* currentSsid = typedSsid ? typedSsid : saved.ssid;
  const char* currentUrl = typedUrl ? typedUrl : (saved.apiUrl[0] ? saved.apiUrl : config::kSuggestedApiUrl);
  const bool tokenSaved = ecopantry::checkDeviceToken(saved.deviceToken) == SettingsError::None;

  String page;
  page.reserve(6144);
  page += kHead;
  if (scanRunning) page.replace(F("<title>"), F("<meta http-equiv=\"refresh\" content=\"4\"><title>"));
  page += F("<h1>EcoPantry station setup</h1>");
  page += F("<p class=\"note\">");
  page += reasonNote(context->reason);
  if (saved.ssid[0]) {
    page += F("<br>Saved network: <b>");
    appendEscaped(page, saved.ssid);
    page += context->wifiConnected ? F("</b> (connected)") : F("</b> (not connected)");
  }
  page += F("</p><form class=\"card\" method=\"post\" action=\"/save\">");

  // Network: picked from the scan, or typed for a hidden one.
  page += F("<label for=\"ssid\">WiFi network (2.4 GHz)</label><select id=\"ssid\" name=\"ssid\">");
  bool currentListed = false;
  for (size_t i = 0; i < networkCount; ++i) {
    if (strcmp(networks[i].ssid, currentSsid) == 0) currentListed = true;
  }
  if (currentSsid[0] && !currentListed) {
    page += F("<option value=\"");
    appendEscaped(page, currentSsid);
    page += F("\" selected>");
    appendEscaped(page, currentSsid);
    page += F(" (saved, not in range)</option>");
  }
  for (size_t i = 0; i < networkCount; ++i) {
    page += F("<option value=\"");
    appendEscaped(page, networks[i].ssid);
    page += '"';
    if (strcmp(networks[i].ssid, currentSsid) == 0) page += F(" selected");
    page += '>';
    appendEscaped(page, networks[i].ssid);
    page += F(" (");
    page += signalWord(networks[i].rssi);
    if (networks[i].open) page += F(", open");
    page += F(")</option>");
  }
  page += F("<option value=\"\"");
  if (!currentSsid[0] && networkCount == 0) page += F(" selected");
  page += F(">Other or hidden network: type it below</option></select>");
  if (scanRunning) {
    page += F("<p class=\"hint\">Looking for networks...</p>");
  } else {
    page += F("<p class=\"hint\"><a href=\"/?scan=1\">Scan again</a>");
    if (scannedOnce && networkCount == 0) page += F(" (no networks found)");
    page += F("</p>");
  }
  page += F("<label for=\"ssid_other\">Network name, if not in the list</label>"
            "<input id=\"ssid_other\" name=\"ssid_other\" maxlength=\"32\" autocomplete=\"off\" "
            "autocapitalize=\"none\" spellcheck=\"false\">");
  if (errors) appendError(page, errors->ssid);

  page += F("<label for=\"password\">WiFi password</label><input id=\"password\" name=\"password\" type=\"password\" "
            "maxlength=\"63\" autocomplete=\"off\"><p class=\"hint\">8 to 63 characters. Leave empty for an open "
            "network");
  if (saved.wifiPassword[0]) page += F(", or to keep the saved password for the same network");
  page += F(".</p>");
  if (errors) appendError(page, errors->wifiPassword);

  page += F("<label for=\"api_url\">API address</label><input id=\"api_url\" name=\"api_url\" type=\"url\" "
            "maxlength=\"120\" autocomplete=\"off\" autocapitalize=\"none\" spellcheck=\"false\" value=\"");
  appendEscaped(page, currentUrl);
  page += F("\"><p class=\"hint\">The API on Render, ending in /api/v1 (not the website's address).");
  if (config::kAllowHttpApi) page += F(" This LAN build also accepts http://.");
  page += F("</p>");
  if (errors) appendError(page, errors->apiUrl);

  page += F("<label for=\"token\">Device token</label><input id=\"token\" name=\"token\" type=\"password\" "
            "maxlength=\"60\" autocomplete=\"off\" autocapitalize=\"none\" spellcheck=\"false\" placeholder=\"epd_...\">"
            "<p class=\"hint\">");
  page += tokenSaved ? F("A token is saved. Leave empty to keep it, or paste a new one.")
                     : F("Shown once when the station is registered (portal Devices page).");
  page += F("</p>");
  if (errors) appendError(page, errors->deviceToken);

  page += F("<button type=\"submit\">Save and connect</button></form>");
  page += kFoot;
  sendHtml(code, page);
}

void sendSaved(const StationSettings& next) {
  String page;
  page.reserve(2048);
  page += kHead;
  page += F("<h1>Saved</h1><div class=\"card\"><p>The station is connecting to <b>");
  appendEscaped(page, next.ssid);
  page += F("</b>. Its screen shows <b>CONNECTING TO:</b> and then <b>ONLINE</b>.</p>"
            "<p>Once it is online this hotspot closes, and your phone may disconnect before that. If it can't "
            "connect, the hotspot stays open: join <b>");
  appendEscaped(page, hotspotName);
  page += F("</b> again and check the details.</p><p><a href=\"/\">Back to setup</a></p></div>");
  page += kFoot;
  sendHtml(200, page);
}

// --- handlers --------------------------------------------------------------------------

void refuse() { server.send(403, "text/plain", "Setup is only available on the station's own hotspot."); }

void handleRoot() {
  if (!fromHotspot()) return refuse();
  if (server.hasArg("scan") && millis() - lastScanMs > kRescanMinMs) startScan();
  sendForm(200, nullptr, nullptr, nullptr);
}

void handleSaveBody() {
  HTTPRaw& raw = server.raw();
  if (raw.status == RAW_START) {
    bodyLength = 0;
    bodyTooLong = false;
  } else if (raw.status == RAW_WRITE) {
    if (bodyLength + raw.currentSize > kMaxBody) {
      bodyTooLong = true;
    } else {
      memcpy(body + bodyLength, raw.buf, raw.currentSize);
      bodyLength += raw.currentSize;
    }
  }
}

void handleSave() {
  if (!fromHotspot()) return refuse();
  if (bodyTooLong) {
    bodyLength = 0;
    return server.send(413, "text/plain", "Too much data.");
  }
  body[bodyLength] = '\0';

  StationSettings next;
  ecopantry::SetupErrors errors;
  const bool valid =
      ecopantry::applySetupForm(body, bodyLength, *context->saved, config::kAllowHttpApi, &next, &errors);
  if (!valid) {
    // Refill only the non-secret fields; passwords and tokens are typed again.
    char typedSsid[ecopantry::kSsidMaxLength + 1];
    char typedUrl[ecopantry::kApiUrlMaxLength + 1];
    if (ecopantry::formField(body, bodyLength, "ssid_other", typedSsid, sizeof typedSsid) != ecopantry::FieldStatus::Ok ||
        typedSsid[0] == '\0') {
      if (ecopantry::formField(body, bodyLength, "ssid", typedSsid, sizeof typedSsid) != ecopantry::FieldStatus::Ok) {
        typedSsid[0] = '\0';
      }
    }
    if (ecopantry::formField(body, bodyLength, "api_url", typedUrl, sizeof typedUrl) != ecopantry::FieldStatus::Ok) {
      typedUrl[0] = '\0';
    }
    memset(body, 0, sizeof body);
    bodyLength = 0;
    Serial.println("[setup] the form had errors; nothing saved");
    return sendForm(400, &errors, typedSsid, typedUrl);
  }
  memset(body, 0, sizeof body);
  bodyLength = 0;

  if (!saveHandler(next)) {
    memset(&next, 0, sizeof next);
    return server.send(500, "text/plain", "Couldn't write the settings to flash. Try again.");
  }
  sendSaved(next);
  memset(&next, 0, sizeof next);
}

void handleOther() {
  if (!fromHotspot()) return server.send(404, "text/plain", "Not found");
  // Phones probe a known address to detect a captive portal; sending them to the setup page
  // makes them offer "sign in to network", which opens it.
  server.sendHeader("Location", "http://192.168.4.1/");
  server.send(302, "text/plain", "");
}

}  // namespace

void open(const char* name, const char* password, const Context* ctx, SaveHandler onSave) {
  if (opened) return;
  context = ctx;
  saveHandler = onSave;
  strlcpy(hotspotName, name, sizeof hotspotName);

  WiFi.mode(WIFI_AP_STA);
  WiFi.softAPConfig(kHotspotIp, kHotspotIp, kHotspotMask);
  if (!WiFi.softAP(name, password, kHotspotChannel, 0, config::kHotspotMaxClients)) {
    Serial.println("[setup] couldn't start the hotspot");
    return;
  }
  dns.setErrorReplyCode(DNSReplyCode::NoError);
  dns.start(53, "*", kHotspotIp);

  if (!handlersAdded) {
    server.on("/", HTTP_GET, handleRoot);
    server.on("/save", HTTP_POST, handleSave, handleSaveBody);
    server.onNotFound(handleOther);
    handlersAdded = true;
  }
  server.begin();
  opened = true;
  networkCount = 0;
  scannedOnce = false;
  startScan();
}

void close() {
  if (!opened) return;
  server.stop();
  dns.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  if (scanRunning) {
    WiFi.scanDelete();
    scanRunning = false;
  }
  opened = false;
}

bool isOpen() { return opened; }

void loop() {
  if (!opened) return;
  collectScan();
  server.handleClient();
}

bool scanning() { return scanRunning; }

}  // namespace setup_portal
