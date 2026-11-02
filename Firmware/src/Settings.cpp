#include "Settings.h"
#include <cstring>

void Settings::begin() {
  // Firmware configuration is independent of the client's transport choice.
  // No wireless-mode selection is stored on the ESP32.
  wifiConfigured_ = std::strlen(wifiSsid()) != 0;
}

