#include "FirmwareSelfTest.h"
#include <WiFi.h>
#include "ProtocolChecks.h"

namespace {
const char* jsonBool(bool value) { return value ? "true" : "false"; }
}

String FirmwareSelfTest::run() const {
  const bool cameraInitialized = camera_.ready();
  const bool sensorDetected = cameraInitialized && esp_camera_sensor_get() != nullptr;

  camera_fb_t* frame = camera_.capture();
  const bool captureOk = frame != nullptr && frame->len > 0;
  const size_t frameBytes = captureOk ? frame->len : 0;
  const bool jpegOk = captureOk && frame->format == PIXFORMAT_JPEG &&
                      hasJpegMarkers(frame->buf, frame->len);
  camera_.release(frame);

  const bool wifiOk = WiFi.status() == WL_CONNECTED;
  // Network reachability is diagnostic, not a prerequisite for camera health.
  const bool passed = cameraInitialized && sensorDetected && captureOk && jpegOk;

  String json;
  json.reserve(420);
  json += "{\"ok\":true,\"cmd\":\"t\",\"passed\":";
  json += jsonBool(passed);
  json += ",\"checks\":{\"cameraInitialized\":";
  json += jsonBool(cameraInitialized);
  json += ",\"sensorDetected\":";
  json += jsonBool(sensorDetected);
  json += ",\"frameCaptured\":";
  json += jsonBool(captureOk);
  json += ",\"jpegMarkersValid\":";
  json += jsonBool(jpegOk);
  json += "},\"details\":{\"wifiConfigured\":";
  json += jsonBool(settings_.wifiConfigured());
  json += ",\"wifiConnected\":";
  json += jsonBool(wifiOk);
  json += ",\"psramPresent\":";
  json += jsonBool(psramFound());
  json += ",\"freeHeapBytes\":";
  json += String(ESP.getFreeHeap());
  json += ",\"frameBytes\":";
  json += String(frameBytes);
  json += "}}";
  return json;
}

