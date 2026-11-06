// RFID card UIDs in the format the backend stores: upper-case hex bytes joined by colons.
#pragma once

#include <cstddef>
#include <cstdint>

namespace ecopantry {

// 10 bytes -> "AA:BB:...:JJ" is 29 characters plus the terminator.
constexpr size_t kUidTextSize = 30;

// Writes e.g. "D5:61:E9:E7" into `out`. Returns the text length, or 0 if `length` isn't
// a MIFARE UID size (4, 7 or 10 bytes) or `out` is too small.
size_t formatUid(const uint8_t* bytes, size_t length, char* out, size_t outSize);

}  // namespace ecopantry
