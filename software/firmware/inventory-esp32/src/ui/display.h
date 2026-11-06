// 16x2 I2C LCD. Lines are padded to the full width instead of clearing the screen,
// so pages change without flicker.
#pragma once

#include <Arduino.h>

class Display {
 public:
  void begin();
  void show(const char* line1, const char* line2);
};
