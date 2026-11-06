// One station sample, and the JSON body for POST /api/v1/device/readings.
//
// The backend rejects a whole batch (422) if any value is outside the physical range of
// its sensor, so `sanitize` turns such values into "missing" (JSON null) before upload.
// A sensor that failed to read is sent as null with its *_ok flag false; a stale value
// is never repeated as if it were fresh.
#pragma once

#include <cstddef>
#include <cstdint>

namespace ecopantry {

// Must match website/backend/app/models/devices.py.
constexpr float kTemperatureMin = -40.0f, kTemperatureMax = 80.0f;
constexpr float kHumidityMin = 0.0f, kHumidityMax = 100.0f;
constexpr float kWeightMin = -5000.0f, kWeightMax = 500000.0f;
constexpr float kPhMin = 0.0f, kPhMax = 14.0f;
constexpr float kPhVoltageMin = 0.0f, kPhVoltageMax = 10.0f;

struct Reading {
  uint64_t uptimeMs = 0;  // 64-bit, so it never wraps like millis() does after 49 days
  float temperatureC = 0, humidityPct = 0, weightG = 0, ph = 0, phVoltage = 0;
  bool hasTemperature = false, hasHumidity = false, hasWeight = false, hasPh = false, hasPhVoltage = false;
  bool dhtOk = false, loadCellOk = false;
};

// Drops NaN and out-of-range values, and values from sensors flagged as failed.
void sanitize(Reading& reading);

// {"sent_uptime_ms":N,"readings":[{...},...]}. Returns the length written, or 0 if `out`
// is too small or `count` is 0. Readings are sanitised copies; the inputs aren't changed.
size_t writeBatchJson(const Reading* readings, size_t count, uint64_t sentUptimeMs, char* out, size_t outSize);

// Worst case per reading, for sizing the output buffer.
constexpr size_t kMaxReadingJsonSize = 240;

}  // namespace ecopantry
