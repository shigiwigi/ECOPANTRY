#include "uplink.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_timer.h>

#include "ca_certs.h"
#include "config.h"
#include "ring_buffer.h"
#include "secrets.h"

#ifndef ECOPANTRY_ALLOW_HTTP
#define ECOPANTRY_ALLOW_HTTP 0
#endif

using ecopantry::Backoff;
using ecopantry::LiveSession;
using ecopantry::Reading;
using ecopantry::RingBuffer;
using ecopantry::SessionState;

namespace uplink {
namespace {

constexpr uint32_t kTaskStackBytes = 16384;  // HTTPS (mbedTLS) needs a deep stack

SemaphoreHandle_t mutex = nullptr;
QueueHandle_t scanRequests = nullptr;
QueueHandle_t scanResults = nullptr;

// Guarded by `mutex`.
RingBuffer<Reading, config::kReadingBufferSize> buffer;
Status shared{};

// Network task only.
LiveSession session(config::kMaxSessionMs);
Backoff wifiBackoff(config::kWifiRetryMinMs, config::kWifiRetryMaxMs);
Backoff retryBackoff(config::kRetryMinMs, config::kRetryMaxMs);
WiFiClientSecure secureClient;
WiFiClient plainClient;
bool useHttps = true;
const char* problem = "";
uint32_t reportIntervalMs = config::kDefaultReportIntervalMs;
uint32_t nextWifiAttemptMs = 0;
uint32_t nextBootAttemptMs = 0;
uint32_t nextUploadMs = 0;
int lastHttpCode = 0;
uint32_t uploadsOk = 0;
uint32_t uploadsFailed = 0;
volatile bool restartRequested = false;

// Upload scratch space; static so it isn't on the task stack.
Reading batch[config::kMaxBatch];
char batchJson[config::kMaxBatch * ecopantry::kMaxReadingJsonSize + 64];

struct Lock {
  Lock() { xSemaphoreTake(mutex, portMAX_DELAY); }
  ~Lock() { xSemaphoreGive(mutex); }
};

bool due(uint32_t nowMs, uint32_t atMs) { return static_cast<int32_t>(nowMs - atMs) >= 0; }

// Copies of the secrets as arrays, so the checks below run on data rather than literals.
const char kApiBaseUrl[] = API_BASE_URL;
const char kDeviceToken[] = DEVICE_TOKEN;
const char kWifiSsid[] = WIFI_SSID;

bool isExample(const char* value) { return strstr(value, "replace-with") != nullptr; }

const char* checkConfig() {
  const bool https = strncmp(kApiBaseUrl, "https://", 8) == 0;
  const bool http = strncmp(kApiBaseUrl, "http://", 7) == 0;
  if (!https && !http) return "API_BASE_URL must start with https://";
  if (http && !ECOPANTRY_ALLOW_HTTP) return "http:// API needs the esp32dev-lan build";
  if (isExample(kApiBaseUrl)) return "API_BASE_URL is still the example";
  if (strncmp(kDeviceToken, "epd_", 4) != 0 || isExample(kDeviceToken)) return "DEVICE_TOKEN is missing";
  if (isExample(kWifiSsid)) return "WIFI_SSID is still the example";
  useHttps = https;
  return "";
}

struct Response {
  int code;
  String body;
};

Response post(const char* path, const char* body) {
  HTTPClient http;
  const String url = String(API_BASE_URL) + path;
  const bool begun = useHttps ? http.begin(secureClient, url) : http.begin(plainClient, url);
  if (!begun) return {-1, String()};
  http.setConnectTimeout(config::kHttpTimeoutMs);
  http.setTimeout(config::kHttpTimeoutMs);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " DEVICE_TOKEN);
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

void lockOut() {
  session.onUnauthorized();
  Serial.println("[api] 401: the device token was refused (revoked, rotated or device disabled).");
  Serial.println("[api] No more requests until reboot. Put a valid token in include/secrets.h.");
}

void maintainWifi(uint32_t nowMs) {
  if (WiFi.status() == WL_CONNECTED) {
    wifiBackoff.reset();
    return;
  }
  if (!due(nowMs, nextWifiAttemptMs)) return;
  Serial.println("[wifi] connecting...");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  nextWifiAttemptMs = nowMs + 10000 + wifiBackoff.next();
}

void handleScan(const char* uid, uint32_t nowMs) {
  ScanResult result{};
  if (session.state() == SessionState::Locked || problem[0] != '\0') {
    result.outcome = ScanOutcome::Locked;
  } else if (WiFi.status() != WL_CONNECTED) {
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

void publishStatus(uint32_t nowMs) {
  Lock lock;
  if (!session.mayUpload()) buffer.clear();  // nothing is sent outside a session
  shared.configOk = problem[0] == '\0';
  shared.wifiConnected = WiFi.status() == WL_CONNECTED;
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

    if (problem[0] == '\0') {
      maintainWifi(now);
      session.tick(now);

      if (restartRequested) {
        restartRequested = false;
        session.restart();
        nextBootAttemptMs = now;
      }

      const bool online = WiFi.status() == WL_CONNECTED;
      char uid[ecopantry::kUidTextSize];
      if (xQueueReceive(scanRequests, uid, 0) == pdTRUE) {
        handleScan(uid, now);
      } else if (online && session.wantsBootSession() && due(now, nextBootAttemptMs)) {
        askForBootSession(now);
      } else if (online && session.mayUpload() && due(now, nextUploadMs)) {
        upload(now);
      }
    } else {
      // Bad configuration: answer card taps so the LCD doesn't wait, but never call the API.
      char uid[ecopantry::kUidTextSize];
      if (xQueueReceive(scanRequests, uid, 0) == pdTRUE) handleScan(uid, now);
    }

    publishStatus(millis());
    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

}  // namespace

uint64_t uptimeMs() { return static_cast<uint64_t>(esp_timer_get_time() / 1000); }

void start() {
  mutex = xSemaphoreCreateMutex();
  scanRequests = xQueueCreate(1, ecopantry::kUidTextSize);
  scanResults = xQueueCreate(1, sizeof(ScanResult));

  problem = checkConfig();
  if (problem[0] != '\0') {
    Serial.printf("[config] %s. Fix include/secrets.h and reflash.\n", problem);
  } else {
    secureClient.setCACert(ROOT_CA_BUNDLE);
    secureClient.setHandshakeTimeout(config::kHttpTimeoutMs / 1000);
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    nextWifiAttemptMs = millis() + 15000;
    if (!useHttps) Serial.println("[config] WARNING: plain http API. LAN testing only.");
  }
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

const char* configProblem() { return problem; }

}  // namespace uplink
