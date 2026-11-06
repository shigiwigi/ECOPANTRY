#include "indicators.h"

#include "config.h"

void Indicators::begin() {
  pinMode(config::kGreenLedPin, OUTPUT);
  pinMode(config::kRedLedPin, OUTPUT);
  pinMode(config::kBuzzerPin, OUTPUT);
  digitalWrite(config::kGreenLedPin, LOW);
  digitalWrite(config::kRedLedPin, LOW);
  buzzer(false);
}

void Indicators::buzzer(bool on) {
  const bool level = config::kBuzzerActiveLow ? !on : on;
  digitalWrite(config::kBuzzerPin, level ? HIGH : LOW);
}

void Indicators::signal(Signal signal, uint32_t nowMs, uint32_t durationMs) {
  signal_ = signal;
  signalling_ = true;
  signalStartMs_ = nowMs;
  signalDurationMs_ = durationMs;
}

void Indicators::update(uint32_t nowMs) {
  bool green = false, red = false, beep = false;

  if (signalling_ && nowMs - signalStartMs_ >= signalDurationMs_) signalling_ = false;

  if (signalling_) {
    const uint32_t t = nowMs - signalStartMs_;
    switch (signal_) {
      case Signal::Granted:
        green = true;
        beep = t < 80;
        break;
      case Signal::Denied:
        red = true;
        beep = t < 200 || (t >= 350 && t < 550);
        break;
      case Signal::Problem:
        red = true;
        break;
    }
  } else if (ambient_ == Ambient::Live) {
    green = nowMs % 3000 < 100;
  } else if (ambient_ == Ambient::Locked) {
    red = nowMs % 2000 < 150;
  }

  digitalWrite(config::kGreenLedPin, green ? HIGH : LOW);
  digitalWrite(config::kRedLedPin, red ? HIGH : LOW);
  buzzer(beep);
}
