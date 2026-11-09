#include "uplink.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_random.h>
#include <esp_timer.h>

#include "ca_certs.h"
#include "config.h"
#include "net/setup_portal.h"
#include "ring_buffer.h"
#include "storage/settings.h"

using ecopantry::Backoff;
using ecopantry::LiveSession;
using ecopantry::Reading;
using ecopantry::RingBuffer;
using ecopantry::SessionState;
using ecopantry::StationSettings;

namespace uplink {
namespace {

constexpr uint32_t kTaskStackBytes = 16384;  // HTTPS (mbedTLS) needs a deep stack
constexpr uint32_t kHotspotRetryMs = 5000;   // if the access point fails to start

SemaphoreHandle_t mutex = nullptr;
QueueHandle_t scanRequests = nullptr;
QueueHandle_t scanResults = nullptr;

// Guarded by `mutex`.
RingBuffer<Reading, config::kReadingBufferSize> buffer;
Status shared{};
char sharedApiUrl[ecopantry::kApiUrlMaxLength + 1] = "";
bool sharedTokenSaved = false;

// Network task only.
StationSettings settings;
ecopantry::WifiSetup wifiSetup([] {
  ecopantry::WifiSetupTiming t;
  t.openHotspotAfterMs = config::kWifiFailOpenHotspotMs;
  t.retryMs = config::kWifiRetryMs;
  t.retryWithHotspotMs = config::kWifiRetryWithHotspotMs;
  t.requestedIdleMs = config::kSetupIdleCloseMs;
  return t;
}());
setup_portal::Context portalContext{&settings, ecopantry::HotspotReason::None, false};
char hotspotName[ecopantry::kHotspotNameSize] = "";
char hotspotPassword[ecopantry::kHotspotPasswordLength + 1] = "";
uint32_t nextHotspotTryMs = 0;

LiveSession session(config::kMaxSessionMs);
Backoff retryBackoff(config::kRetryMinMs, config::kRetryMaxMs);
WiFiClientSecure secureClient;
WiFiClient plainClient;
bool useHttps = true;
uint32_t reportIntervalMs = config::kDefaultReportIntervalMs;
uint32_t nextBootAttemptMs = 0;
uint32_t nextUploadMs = 0;
int lastHttpCode = 0;
uint32_t uploadsOk = 0;
uint32_t uploadsFailed = 0;

// Requests from the main loop (core 1).
volatile bool restartRequested = false;
volatile bool setupRequested = false;
volatile bool forgetRequested = false;
volatile bool factoryResetRequested = false;

// Upload scratch space; static so it isn't on the task stack.
Reading batch[config::kMaxBatch];
char batchJson[config::kMaxBatch * ecopantry::kMaxReadingJsonSize + 64];

struct Lock {
  Lock() { xSemaphoreTake(mutex, portMAX_DELAY); }
  ~Lock() { xSemaphoreGive(mutex); }
};

bool due(uint32_t nowMs, uint32_t atMs) { return static_cast<int32_t>(nowMs - atMs) >= 0; }

bool tokenSaved() { return ecopantry::checkDeviceToken(settings.deviceToken) == ecopantry::SettingsError::None; }

void publishSettingsInfo() {
  Lock lock;
  strlcpy(sharedApiUrl, settings.apiUrl, sizeof sharedApiUrl);
  sharedTokenSaved = tokenSaved();
}

// --- API -------------------------------------------------------------------------------

struct Response {
  int code;
  String body;
};

Response post(const char* path, const char* body) {
  HTTPClient http;
  const String url = String(settings.apiUrl) + path;
  const bool begun = useHttps ? http.begin(secureClient, url) : http.begin(plainClient, url);
  if (!begun) return {-1, String()};
  http.setConnectTimeout(config::kHttpTimeoutMs);
  http.setTimeout(config::kHttpTimeoutMs);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + settings.deviceToken);
  http.addHeader("X-Device-Firmware", FIRMWARE_VERSION);
  const int code = http.POST(reinterpret_cast<uint8_t*>(const_cast<char*>(body)), strlen(body));
  Response response{code, code > 0 ? http.getString() : String()};
  http.end();
  lastHttpCode = code;
  // Never log the token or the request body; the path and status are enough.
  Serial.printf("[api] POST %s -> %d\n", path, code);
  return response;
}

// Every 2xx answer says whether the station is live and for how long.
bool applyStatus(const JsonDocument& doc, uint32_t nowMs) {
  const uint32_t interval = doc["report_interval_seconds"] | 0u;
  if (interval >= 2 && interval <= 3600) reportIntervalMs = interval * 1000u;
  const bool wasLive = session.mayUpload();
  session.onStatus(doc["live"] | false, doc["live_seconds_remaining"] | 0u, doc["budget_exhausted"] | false, nowMs);
  if (session.mayUpload() && !wasLive) nextUploadMs = nowMs + reportIntervalMs;
  return true;
}

// 401: the token was rotated or the device disabled. Stop calling the API and open the
// setup hotspot so the current token can be entered without a cable.
void lockOut() {
  session.onUnauthorized();
  wifiSetup.onTokenRefused(millis());
  Serial.println("[api] 401: the device token was refused (rotated, or the device was disabled).");
  Serial.println("[api] No more requests until a token is saved on the setup hotspot, or a reboot.");
}

void handleScan(const char* uid, uint32_t nowMs) {
  ScanResult result{};
  if (session.state() == SessionState::Locked) {
    result.outcome = ScanOutcome::Locked;
  } else if (wifiSetup.hotspotOpen()) {
    result.outcome = ScanOutcome::Setup;
  } else if (!wifiSetup.apiAllowed()) {
    result.outcome = ScanOutcome::Offline;
  } else {
    char body[64];
    snprintf(body, sizeof body, "{\"uid\":\"%s\"}", uid);
    const Response response = post("/device/rfid-scans", body);
    JsonDocument doc;
    if (response.code == 200 && !deserializeJson(doc, response.body)) {
      applyStatus(doc, nowMs);
      const bool granted = doc["granted"] | false;
      result.outcome = granted ? ScanOutcome::Granted : ScanOutcome::Denied;
      strlcpy(result.result, doc["result"] | "", sizeof result.result);
      strlcpy(result.displayName, doc["display_name"] | "", sizeof result.displayName);
    } else if (response.code == 401) {
      lockOut();
      result.outcome = ScanOutcome::Locked;
    } else if (response.code <= 0) {
      result.outcome = ScanOutcome::Offline;
    } else {
      result.outcome = ScanOutcome::Error;
    }
  }
  result.live = session.mayUpload();
  result.budgetExhausted = session.budgetExhausted();
  xQueueSend(scanResults, &result, 0);
}

void askForBootSession(uint32_t nowMs) {
  const Response response = post("/device/session", "{}");
  JsonDocument doc;
  if (response.code == 200 && !deserializeJson(doc, response.body)) {
    retryBackoff.reset();
    applyStatus(doc, nowMs);
    Serial.printf("[session] %s, %u s left%s\n", ecopantry::sessionStateName(session.state()),
                  static_cast<unsigned>(session.remainingMs(nowMs) / 1000),
                  session.budgetExhausted() ? " (daily limit reached)" : "");
  } else if (response.code == 401) {
    lockOut();
  } else {
    session.onBootAttemptFailed();
    nextBootAttemptMs = nowMs + retryBackoff.next();
  }
}

void upload(uint32_t nowMs) {
  size_t count;
  {
    Lock lock;
    count = buffer.peekOldest(batch, config::kMaxBatch);
  }
  if (count == 0) {
    nextUploadMs = nowMs + 1000;
    return;
  }
  const size_t length = ecopantry::writeBatchJson(batch, count, uptimeMs(), batchJson, sizeof batchJson);
  if (length == 0) {  // can't happen with the sizes in config.h; drop rather than loop
    Lock lock;
    buffer.dropOldest(count);
    return;
  }

  const Response response = post("/device/readings", batchJson);
  JsonDocument doc;
  switch (response.code) {
    case 201:
      {
        Lock lock;
        buffer.dropOldest(count);
      }
      ++uploadsOk;
      retryBackoff.reset();
      if (!deserializeJson(doc, response.body)) applyStatus(doc, nowMs);
      nextUploadMs = nowMs + reportIntervalMs;
      break;
    case 409:  // session_not_live: the server says stop
      session.onNotLive();
      Serial.println("[session] server ended the live session; uploads paused. Tap a card to go live.");
      break;
    case 429:  // too soon
      nextUploadMs = nowMs + config::kRetryMinMs;
      break;
    case 400:
    case 422: {  // the server will never accept this batch; don't retry it forever
      Lock lock;
      buffer.dropOldest(count);
      ++uploadsFailed;
      Serial.printf("[api] dropped %u readings the server rejected\n", static_cast<unsigned>(count));
      nextUploadMs = nowMs + reportIntervalMs;
      break;
    }
    case 401:
      lockOut();
      break;
    default:  // network, TLS, 5xx or Render waking up: retry later, the session clock keeps running
      ++uploadsFailed;
      nextUploadMs = nowMs + retryBackoff.next();
      break;
  }
}

// --- WiFi and the setup hotspot -------------------------------------------------------

void joinWifi() {
  Serial.printf("[wifi] connecting to \"%s\"...\n", settings.ssid);
  WiFi.disconnect();
  WiFi.begin(settings.ssid, settings.wifiPassword[0] ? settings.wifiPassword : nullptr);
}

// Called by the setup page with complete, checked settings.
bool onSettingsSaved(const StationSettings& next) {
  if (!saveSettings(next)) {
    Serial.println("[setup] couldn't write the settings to flash");
    return false;
  }
  const uint32_t now = millis();
  const bool wifiChanged = !wifiSetup.haveSettings() || !ecopantry::sameWifi(settings, next);
  settings = next;
  useHttps = strncmp(settings.apiUrl, "https://", 8) == 0;
  lastHttpCode = 0;
  session.onTokenSaved();  // a refused token gets another chance with what was just saved
  retryBackoff.reset();
  nextBootAttemptMs = now;
  wifiSetup.onSaved(wifiChanged, now);
  if (wifiChanged && WiFi.status() == WL_CONNECTED) WiFi.disconnect();
  publishSettingsInfo();
  // The SSID and API address aren't secret; the WiFi password and token are never printed.
  Serial.printf("[setup] saved: network \"%s\", API %s%s\n", settings.ssid, settings.apiUrl,
                useHttps ? "" : " (plain http: LAN testing only)");
  return true;
}

void reconcileHotspot(uint32_t nowMs) {
  portalContext.reason = wifiSetup.reason();
  portalContext.wifiConnected = WiFi.status() == WL_CONNECTED;

  if (wifiSetup.hotspotOpen() && !setup_portal::isOpen() && due(nowMs, nextHotspotTryMs)) {
    // A new password every time it opens. esp_random() is a true RNG while the radio is on.
    ecopantry::makeHotspotPassword(esp_random, hotspotPassword);
    setup_portal::open(hotspotName, hotspotPassword, &portalContext, onSettingsSaved);
    if (setup_portal::isOpen()) {
      Serial.printf("[setup] hotspot %s is open (%s). Password %s, then open http://192.168.4.1\n", hotspotName,
                    ecopantry::hotspotReasonName(wifiSetup.reason()), hotspotPassword);
      Serial.println("[setup] uploads are paused while the hotspot is open.");
    } else {
      nextHotspotTryMs = nowMs + kHotspotRetryMs;
    }
  } else if (!wifiSetup.hotspotOpen() && setup_portal::isOpen()) {
    setup_portal::close();
    memset(hotspotPassword, 0, sizeof hotspotPassword);
    Serial.println("[setup] hotspot closed; the station is online.");
  }
}

void handleRequests(uint32_t nowMs) {
  if (factoryResetRequested) {
    Serial.println("[setup] factory reset: erasing all settings and calibration, then restarting.");
    setup_portal::close();
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
    eraseAllSettings();
    delay(200);
    ESP.restart();
  }
  if (forgetRequested) {
    forgetRequested = false;
    forgetWifiSettings();
    settings.ssid[0] = '\0';
    memset(settings.wifiPassword, 0, sizeof settings.wifiPassword);
    WiFi.disconnect();
    wifiSetup.onWifiForgotten(nowMs);
    Serial.println("[setup] WiFi details forgotten (API address and token kept).");
  }
  if (setupRequested) {
    setupRequested = false;
    wifiSetup.onSetupRequested(nowMs);
  }
  if (restartRequested) {
    restartRequested = false;
    session.restart();
    nextBootAttemptMs = nowMs;
  }
}

void publishStatus(uint32_t nowMs) {
  Lock lock;
  if (!session.mayUpload()) buffer.clear();  // nothing is sent outside a session
  shared.haveSettings = wifiSetup.haveSettings();
  shared.wifiConnected = WiFi.status() == WL_CONNECTED;
  shared.joining = wifiSetup.joining(nowMs);
  strlcpy(shared.ssid, settings.ssid, sizeof shared.ssid);
  shared.hotspotOpen = setup_portal::isOpen();
  shared.hotspotReason = wifiSetup.reason();
  strlcpy(shared.hotspotName, hotspotName, sizeof shared.hotspotName);
  strlcpy(shared.hotspotPassword, hotspotPassword, sizeof shared.hotspotPassword);
  shared.state = session.state();
  shared.remainingMs = session.remainingMs(nowMs);
  shared.budgetExhausted = session.budgetExhausted();
  shared.reportIntervalMs = reportIntervalMs;
  shared.lastHttpCode = lastHttpCode;
  shared.buffered = buffer.size();
  shared.uploadsOk = uploadsOk;
  shared.uploadsFailed = uploadsFailed;
}

void task(void*) {
  for (;;) {
    const uint32_t now = millis();

    handleRequests(now);
    wifiSetup.update(WiFi.status() == WL_CONNECTED, now);
    reconcileHotspot(now);
    setup_portal::loop();
    if (!setup_portal::scanning() && wifiSetup.takeJoinAttempt(now)) joinWifi();
    session.tick(now);

    // API requests only when online with the hotspot closed. Card taps are always answered,
    // so the LCD never waits for nothing.
    const bool api = wifiSetup.apiAllowed();
    char uid[ecopantry::kUidTextSize];
    if (xQueueReceive(scanRequests, uid, 0) == pdTRUE) {
      handleScan(uid, now);
    } else if (api && session.wantsBootSession() && due(now, nextBootAttemptMs)) {
      askForBootSession(now);
    } else if (api && session.mayUpload() && due(now, nextUploadMs)) {
      upload(now);
    }

    publishStatus(millis());
    // The setup page needs a quick answer; otherwise 20 checks a second is plenty.
    vTaskDelay(pdMS_TO_TICKS(setup_portal::isOpen() ? 5 : 50));
  }
}

}  // namespace

uint64_t uptimeMs() { return static_cast<uint64_t>(esp_timer_get_time() / 1000); }

void start() {
  mutex = xSemaphoreCreateMutex();
  scanRequests = xQueueCreate(1, ecopantry::kUidTextSize);
  scanResults = xQueueCreate(1, sizeof(ScanResult));

  loadSettings(&settings);
  const bool complete = ecopantry::settingsComplete(settings, config::kAllowHttpApi);
  useHttps = strncmp(settings.apiUrl, "https://", 8) == 0;
  if (complete) {
    Serial.printf("[setup] saved network \"%s\", API %s\n", settings.ssid, settings.apiUrl);
    if (!useHttps) Serial.println("[setup] WARNING: plain http API. LAN testing only.");
  } else if (settings.apiUrl[0] &&
             ecopantry::checkApiUrl(settings.apiUrl, config::kAllowHttpApi) != ecopantry::SettingsError::None) {
    Serial.printf("[setup] the saved API address can't be used by this build: %s\n",
                  ecopantry::settingsErrorText(ecopantry::checkApiUrl(settings.apiUrl, config::kAllowHttpApi)));
  } else {
    Serial.println("[setup] not set up yet: opening the setup hotspot.");
  }

  secureClient.setCACert(ROOT_CA_BUNDLE);
  secureClient.setHandshakeTimeout(config::kHttpTimeoutMs / 1000);

  // The details live in our own NVS namespace only: don't let the WiFi driver keep a copy,
  // and let the state machine decide when to (re)join.
  WiFi.persistent(false);
  WiFi.setAutoReconnect(false);
  WiFi.mode(WIFI_STA);
  uint8_t mac[6];
  WiFi.macAddress(mac);
  ecopantry::makeHotspotName(mac, hotspotName);

  wifiSetup.begin(complete, millis());
  publishSettingsInfo();
  publishStatus(millis());
  xTaskCreatePinnedToCore(task, "uplink", kTaskStackBytes, nullptr, 1, nullptr, 0);
}

Status status() {
  Lock lock;
  return shared;
}

void addReading(const Reading& reading) {
  Lock lock;
  if (shared.state != SessionState::Live) return;
  buffer.push(reading);
}

bool requestScan(const char* uid) {
  char copy[ecopantry::kUidTextSize];
  strlcpy(copy, uid, sizeof copy);
  xQueueReset(scanResults);  // forget an answer that came after the LCD gave up on it
  return xQueueSend(scanRequests, copy, 0) == pdTRUE;
}

bool takeScanResult(ScanResult* out) { return xQueueReceive(scanResults, out, 0) == pdTRUE; }

void restartSession() { restartRequested = true; }
void openSetup() { setupRequested = true; }
void forgetWifi() { forgetRequested = true; }
void factoryReset() { factoryResetRequested = true; }

void describeSettings(char* out, size_t outSize) {
  Lock lock;
  snprintf(out, outSize, "API %s, device token %s", sharedApiUrl[0] ? sharedApiUrl : "(not saved)",
           sharedTokenSaved ? "saved" : "NOT saved");
}

}  // namespace uplink
