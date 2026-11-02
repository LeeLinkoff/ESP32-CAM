#pragma once

#include <Arduino.h>
#include "AppConfig.h"

class Settings {
 public:
  void begin();
  bool wifiConfigured() const { return wifiConfigured_; }
  const char* wifiSsid() const { return CAMERA_WIFI_SSID; }
  const char* wifiPassword() const { return CAMERA_WIFI_PASSWORD; }
  const char* bluetoothName() const { return CAMERA_BT_NAME; }

 private:
  bool wifiConfigured_ = false;
};

