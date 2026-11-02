#pragma once

// Pure C++ helpers shared by ESP32 firmware and desktop unit tests.
// Do not add Arduino dependencies here.
#include <cstddef>
#include <cstdint>
#include <cstring>

inline bool isSupportedCommand(const char* value) {
  return value && (std::strcmp(value, "i") == 0 ||
                   std::strcmp(value, "c") == 0 ||
                   std::strcmp(value, "t") == 0);
}

inline bool hasJpegMarkers(const std::uint8_t* bytes, std::size_t length) {
  // Basic JPEG signature check; not a complete JPEG decoder.
  return bytes && length >= 4 && bytes[0] == 0xFF && bytes[1] == 0xD8 &&
         bytes[length - 2] == 0xFF && bytes[length - 1] == 0xD9;
}

