#pragma once

#include <Arduino.h>
#include <BluetoothSerial.h>
#include <WebServer.h>
#include <WiFi.h>
#include "CameraController.h"
#include "CommandProcessor.h"
#include "FirmwareSelfTest.h"
#include "Settings.h"

class TransportManager {
 public:
  TransportManager(CameraController& camera, Settings& settings);
  void begin();
  void poll();

 private:
  void startWifi();
  void stopWifiServers();
  void pollWifi();
  void pollLines(Stream& input, String& buffer);
  void installHttpHandlers();
  void sendHttpInfo();
  void sendHttpTest();
  void sendHttpCapture();

  CameraController& camera_;
  Settings& settings_;
  CommandProcessor commands_;
  FirmwareSelfTest tests_;
  WiFiServer tcpServer_{3333};
  WiFiClient tcpClient_;
  WebServer http_{80};
  BluetoothSerial bluetooth_;
  String usbLine_;
  String tcpLine_;
  String bluetoothLine_;
  bool tcpListening_ = false;
  bool httpListening_ = false;
  bool bluetoothListening_ = false;
  uint32_t wifiAttemptAt_ = 0;
};

