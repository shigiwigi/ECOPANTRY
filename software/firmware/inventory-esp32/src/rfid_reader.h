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

  // The MFRC522's version register: 0x91/0x92 are real chips (and clones report others);
  // 0x00 or 0xFF means the board isn't answering on SPI (wiring, 3.3 V, SS/RST pins).
  uint8_t version() const { return version_; }
  bool healthy() const { return version_ != 0x00 && version_ != 0xFF; }

 private:
  char lastUid_[ecopantry::kUidTextSize] = "";
  uint32_t lastUidMs_ = 0;
  uint32_t lastCheckMs_ = 0;
  uint8_t version_ = 0;
};
