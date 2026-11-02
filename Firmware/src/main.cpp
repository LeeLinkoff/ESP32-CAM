#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include "CameraController.h"
#include "Settings.h"
#include "TransportManager.h"

CameraController camera;
Settings settings;
TransportManager transports(camera, settings);

namespace {
// The AI Thinker ESP32-CAM has a RED, active-low status LED on GPIO33.
constexpr uint8_t kStatusLedPin = 33;
constexpr uint32_t kFastBlinkMs = 100;
constexpr uint32_t kNormalBlinkMs = 1000;
constexpr uint32_t kExtraFastBlinkMs = 5000;
TaskHandle_t statusLedTaskHandle = nullptr;

void statusLedTask(void*) {
  bool initialized = false;
  TickType_t initializedAt = 0;
  while (true) {
    if (!initialized && ulTaskNotifyTake(pdTRUE, 0) > 0) {
      initialized = true;
      initializedAt = xTaskGetTickCount();
    }
    // Keep blinking rapidly for 5 more seconds after initialization succeeds.
    const bool fastBlink = !initialized ||
        (xTaskGetTickCount() - initializedAt < pdMS_TO_TICKS(kExtraFastBlinkMs));
    const TickType_t interval = pdMS_TO_TICKS(fastBlink ? kFastBlinkMs : kNormalBlinkMs);
    digitalWrite(kStatusLedPin, LOW);   // LED ON (active low)
    vTaskDelay(interval);
    digitalWrite(kStatusLedPin, HIGH);  // LED OFF
    vTaskDelay(interval);
  }
}
}

void setup() {
  pinMode(kStatusLedPin, OUTPUT);
  digitalWrite(kStatusLedPin, HIGH);
  // Independent task keeps blinking while camera/Wi-Fi initialization blocks.
  BaseType_t ledStarted = xTaskCreate(statusLedTask, "status-led", 2048, nullptr,
                                      1, &statusLedTaskHandle);
  Serial.begin(115200);
  delay(250);
  settings.begin();
  const bool cameraReady = camera.begin();
  if (!cameraReady) Serial.println("Camera initialization failed; i reports state");
  transports.begin();
  if (ledStarted == pdPASS && cameraReady) {
    xTaskNotifyGive(statusLedTaskHandle); // 5s extra fast, then 1s ON / 1s OFF.
  }
  // Failed camera: rapid blinking remains. Failed task creation: LED stays OFF.
}

void loop() {
  transports.poll();
  delay(1);
}
