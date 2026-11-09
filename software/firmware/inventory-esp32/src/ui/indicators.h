// Green/red LEDs and the buzzer, driven without delay().
//
//   live              green blinks briefly every 3 s
//   paused            both off
//   locked            red blinks every 2 s
//   card granted      green on + one short beep
//   card denied       red on + two beeps
//   offline / error   red on, no beep
//   setup hotspot     green and red take turns (about once a second)
//   bin nearly full   red blinks twice a second (until the weight drops), one short beep
//                     when it fills, at most once per 10 minutes (decided by BinAlert)
#pragma once

#include <Arduino.h>

enum class Signal : uint8_t { Granted, Denied, Problem };
enum class Ambient : uint8_t { Off, Live, Locked, Setup };

class Indicators {
 public:
  void begin();
  // Shows `signal` for `durationMs`, then returns to the ambient pattern.
  void signal(Signal signal, uint32_t nowMs, uint32_t durationMs);
  void setAmbient(Ambient ambient) { ambient_ = ambient; }
  void setBinFull(bool full) { binFull_ = full; }
  // One short beep (the bin just filled).
  void beepOnce(uint32_t nowMs) { beepStartMs_ = nowMs; beeping_ = true; }
  void update(uint32_t nowMs);

 private:
  void buzzer(bool on);

  Ambient ambient_ = Ambient::Off;
  bool binFull_ = false;
  bool beeping_ = false;
  uint32_t beepStartMs_ = 0;
  bool signalling_ = false;
  Signal signal_ = Signal::Problem;
  uint32_t signalStartMs_ = 0;
  uint32_t signalDurationMs_ = 0;
};
