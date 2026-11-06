#include "climate.h"

#include <DHT.h>

#include "config.h"

namespace {
DHT dht(config::kDhtPin, DHT11);
}

void Climate::begin() { dht.begin(); }

void Climate::update(uint32_t nowMs) {
  if (lastReadMs_ != 0 && nowMs - lastReadMs_ < config::kDhtIntervalMs) return;
  lastReadMs_ = nowMs == 0 ? 1 : nowMs;

  const float t = dht.readTemperature();
  const float h = dht.readHumidity();
  if (!isnan(t) && !isnan(h)) {
    temperatureC_ = t;
    humidityPct_ = h;
    lastGoodMs_ = nowMs;
    everGood_ = true;
  }
}

bool Climate::ok(uint32_t nowMs) const {
  return everGood_ && nowMs - lastGoodMs_ <= config::kDhtStaleMs;
}
