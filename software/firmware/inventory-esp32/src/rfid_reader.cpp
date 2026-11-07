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
  version_ = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  Serial.printf("[rfid] reader version 0x%02X %s\n", version_,
                healthy() ? "(ok)" : "(NOT ANSWERING: check wiring, 3.3 V, SS=5 RST=4 SCK=18 MISO=19 MOSI=23)");
}

bool RfidReader::poll(uint32_t nowMs, char (&uid)[ecopantry::kUidTextSize]) {
  // Every few seconds make sure the reader still answers; if it stopped, reset it.
  if (nowMs - lastCheckMs_ >= 5000) {
    lastCheckMs_ = nowMs;
    const uint8_t before = version_;
    version_ = rfid.PCD_ReadRegister(MFRC522::VersionReg);
    if (!healthy()) {
      rfid.PCD_Init();
      version_ = rfid.PCD_ReadRegister(MFRC522::VersionReg);
    }
    if (healthy() != (before != 0x00 && before != 0xFF)) {
      Serial.printf("[rfid] reader is now %s\n", healthy() ? "answering" : "NOT answering");
    }
  }

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
