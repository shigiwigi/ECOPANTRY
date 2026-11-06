#include "reading.h"

#include <cinttypes>
#include <cmath>
#include <cstdarg>
#include <cstdio>

namespace ecopantry {

namespace {

bool inRange(float value, float low, float high) {
  return std::isfinite(value) && value >= low && value <= high;
}

void keepIfValid(bool& has, float value, float low, float high) {
  if (has && !inRange(value, low, high)) has = false;
}

// Appends with vsnprintf; on overflow marks itself failed and ignores further writes.
class Writer {
 public:
  Writer(char* out, size_t size) : out_(out), size_(size) {}

  __attribute__((format(printf, 2, 3))) void append(const char* format, ...) {
    if (failed_) return;
    va_list args;
    va_start(args, format);
    const int written = std::vsnprintf(out_ + pos_, size_ - pos_, format, args);
    va_end(args);
    if (written < 0 || static_cast<size_t>(written) >= size_ - pos_) {
      failed_ = true;
      return;
    }
    pos_ += static_cast<size_t>(written);
  }

  void number(const char* key, bool has, float value, int decimals) {
    if (has) {
      append("\"%s\":%.*f,", key, decimals, static_cast<double>(value));
    } else {
      append("\"%s\":null,", key);
    }
  }

  size_t length() const { return failed_ ? 0 : pos_; }

 private:
  char* out_;
  size_t size_;
  size_t pos_ = 0;
  bool failed_ = false;
};

}  // namespace

void sanitize(Reading& r) {
  if (!r.dhtOk) r.hasTemperature = r.hasHumidity = false;
  if (!r.loadCellOk) r.hasWeight = false;
  keepIfValid(r.hasTemperature, r.temperatureC, kTemperatureMin, kTemperatureMax);
  keepIfValid(r.hasHumidity, r.humidityPct, kHumidityMin, kHumidityMax);
  keepIfValid(r.hasWeight, r.weightG, kWeightMin, kWeightMax);
  keepIfValid(r.hasPh, r.ph, kPhMin, kPhMax);
  keepIfValid(r.hasPhVoltage, r.phVoltage, kPhVoltageMin, kPhVoltageMax);
}

size_t writeBatchJson(const Reading* readings, size_t count, uint64_t sentUptimeMs, char* out, size_t outSize) {
  if (readings == nullptr || count == 0 || out == nullptr || outSize == 0) return 0;
  Writer w(out, outSize);
  w.append("{\"sent_uptime_ms\":%" PRIu64 ",\"readings\":[", sentUptimeMs);
  for (size_t i = 0; i < count; ++i) {
    Reading r = readings[i];
    sanitize(r);
    w.append("{\"uptime_ms\":%" PRIu64 ",", r.uptimeMs);
    w.number("temperature_c", r.hasTemperature, r.temperatureC, 1);
    w.number("humidity_pct", r.hasHumidity, r.humidityPct, 1);
    w.number("weight_g", r.hasWeight, r.weightG, 1);
    w.number("ph_value", r.hasPh, r.ph, 2);
    w.number("ph_voltage", r.hasPhVoltage, r.phVoltage, 3);
    w.append("\"dht_ok\":%s,\"load_cell_ok\":%s}%s", r.dhtOk ? "true" : "false", r.loadCellOk ? "true" : "false",
             i + 1 < count ? "," : "");
  }
  w.append("]}");
  return w.length();
}

}  // namespace ecopantry
