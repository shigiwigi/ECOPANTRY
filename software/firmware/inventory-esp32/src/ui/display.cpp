#include "display.h"

#include <LiquidCrystal_I2C.h>
#include <Wire.h>

#include "config.h"

namespace {
LiquidCrystal_I2C lcd(config::kLcdAddress, config::kLcdColumns, config::kLcdRows);
char shown[2][config::kLcdColumns + 1] = {"", ""};

void writeLine(uint8_t row, const char* text) {
  char padded[config::kLcdColumns + 1];
  snprintf(padded, sizeof padded, "%-16.16s", text ? text : "");
  if (strcmp(padded, shown[row]) == 0) return;  // I2C is slow; skip unchanged lines
  lcd.setCursor(0, row);
  lcd.print(padded);
  memcpy(shown[row], padded, sizeof padded);
}
}  // namespace

void Display::begin() {
  Wire.begin(config::kI2cSdaPin, config::kI2cSclPin);
  lcd.init();
  lcd.backlight();
  lcd.clear();
}

void Display::show(const char* line1, const char* line2) {
  writeLine(0, line1);
  writeLine(1, line2);
}
