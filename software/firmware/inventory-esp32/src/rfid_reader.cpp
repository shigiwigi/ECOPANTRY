#include "rfid_reader.h"

#include <MFRC522.h>
#include <SPI.h>

#include "config.h"

namespace {
MFRC522 rfid(config::kRfidSsPin, config::kRfidRstPin);
}

void RfidReader::begin() {
  SPI.begin(config::kSpiSckPin, config::kSpiMisoPin, config::kSpiMosiPin, config::kRfidSsPin);
  rfid.PCD_Init();
}

bool RfidReader::poll(uint32_t nowMs, char (&uid)[ecopantry::kUidTextSize]) {
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return false;

  const size_t length = ecopantry::formatUid(rfid.uid.uidByte, rfid.uid.size, uid, sizeof uid);
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
  if (length == 0) return false;

  if (strcmp(uid, lastUid_) == 0 && nowMs - lastUidMs_ < config::kSameCardIgnoreMs) {
    lastUidMs_ = nowMs;
    return false;
  }
  strncpy(lastUid_, uid, sizeof lastUid_);
  lastUidMs_ = nowMs;
  return true;
}
