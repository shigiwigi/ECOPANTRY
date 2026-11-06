// MFRC522 card reader (3.3 V only). Reports each new tap once.
#pragma once

#include <Arduino.h>

#include "uid.h"

class RfidReader {
 public:
  void begin();
  // True when a card was tapped; `uid` gets e.g. "D5:61:E9:E7". The same card held on the
  // reader, or tapped again within a few seconds, is reported once.
  bool poll(uint32_t nowMs, char (&uid)[ecopantry::kUidTextSize]);

 private:
  char lastUid_[ecopantry::kUidTextSize] = "";
  uint32_t lastUidMs_ = 0;
};
