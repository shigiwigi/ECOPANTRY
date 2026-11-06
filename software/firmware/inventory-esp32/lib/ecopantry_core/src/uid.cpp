#include "uid.h"

namespace ecopantry {

size_t formatUid(const uint8_t* bytes, size_t length, char* out, size_t outSize) {
  if (bytes == nullptr || out == nullptr) return 0;
  if (length != 4 && length != 7 && length != 10) return 0;
  const size_t needed = length * 3;  // "XX:" per byte, the last ':' becomes the terminator
  if (outSize < needed) return 0;

  static const char kHex[] = "0123456789ABCDEF";
  size_t pos = 0;
  for (size_t i = 0; i < length; ++i) {
    if (i > 0) out[pos++] = ':';
    out[pos++] = kHex[bytes[i] >> 4];
    out[pos++] = kHex[bytes[i] & 0x0F];
  }
  out[pos] = '\0';
  return pos;
}

}  // namespace ecopantry
