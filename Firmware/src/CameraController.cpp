#include "CameraController.h"
#include "img_converters.h"
#include "esp_heap_caps.h"

namespace {

constexpr uint8_t kFlashPin = 4;  // AI Thinker ESP32-CAM white flash LED; HIGH = on.
constexpr uint8_t kFlashThreshold = 70;  // Mean brightness, 0 (black) to 255 (white).
constexpr uint32_t kFlashSettleMs = 200;
constexpr size_t kPixelSampleStep = 8;

// Return false when brightness cannot be measured; keep the original JPEG then.
bool needsFlash(const camera_fb_t* frame, bool& dark) {
  dark = false;
  if (!frame || frame->format != PIXFORMAT_JPEG || !frame->width || !frame->height) {
    return false;
  }

  const size_t width = frame->width;
  const size_t height = frame->height;
  const size_t bytes = width * height * 3;
  uint8_t* rgb = static_cast<uint8_t*>(
      heap_caps_malloc(bytes, psramFound() ? (MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT)
                                       : MALLOC_CAP_8BIT));
  if (!rgb) return false;

  const bool decoded = fmt2rgb888(frame->buf, frame->len, frame->format, rgb);
  if (!decoded) {
    heap_caps_free(rgb);
    return false;
  }

  uint64_t totalBrightness = 0;
  uint32_t samples = 0;
  for (size_t y = 0; y < height; y += kPixelSampleStep) {
    for (size_t x = 0; x < width; x += kPixelSampleStep) {
      const size_t offset = (y * width + x) * 3;
      // Approximate perceived brightness from an RGB pixel.
      const uint32_t brightness =
          (77U * rgb[offset] + 150U * rgb[offset + 1] + 29U * rgb[offset + 2]) >> 8;
      totalBrightness += brightness;
      ++samples;
    }
  }

  heap_caps_free(rgb);
  dark = samples && (totalBrightness / samples < kFlashThreshold);
  return true;
}

}  // namespace

bool CameraController::begin() {
  pinMode(kFlashPin, OUTPUT);
  digitalWrite(kFlashPin, LOW);  // Never leave the white flash on at startup.

  camera_config_t config = {};
  // AI Thinker ESP32-CAM / OV2640 pinout (no SD-card support in this app).
  config.pin_pwdn = 32;
  config.pin_reset = -1;
  config.pin_xclk = 0;
  config.pin_sccb_sda = 26;
  config.pin_sccb_scl = 27;
  config.pin_d7 = 35;
  config.pin_d6 = 34;
  config.pin_d5 = 39;
  config.pin_d4 = 36;
  config.pin_d3 = 21;
  config.pin_d2 = 19;
  config.pin_d1 = 18;
  config.pin_d0 = 5;
  config.pin_vsync = 25;
  config.pin_href = 23;
  config.pin_pclk = 22;
  config.xclk_freq_hz = 20000000;
  config.ledc_timer = LEDC_TIMER_0;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = psramFound() ? FRAMESIZE_VGA : FRAMESIZE_QVGA;
  config.jpeg_quality = 12;
  config.fb_count = 1;
  config.fb_location = psramFound() ? CAMERA_FB_IN_PSRAM : CAMERA_FB_IN_DRAM;
  config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;

  ready_ = esp_camera_init(&config) == ESP_OK;
  return ready_;
}

String CameraController::infoJson() const {
  String out = "{\"ok\":true,\"cmd\":\"i\",\"cameraReady\":";
  out += ready_ ? "true" : "false";
  out += ",\"board\":\"AI Thinker ESP32-CAM\",\"format\":\"jpeg\",\"psram\":";
  out += psramFound() ? "true" : "false";
  if (ready_) {
    sensor_t* sensor = esp_camera_sensor_get();
    if (sensor) {
      out += ",\"sensorPid\":";
      out += String(sensor->id.PID);
      out += ",\"frameSizeCode\":";
      out += String(static_cast<int>(sensor->status.framesize));
      out += ",\"jpegQuality\":";
      out += String(sensor->status.quality);
    }
  }
  out += "}";
  return out;
}

camera_fb_t* CameraController::capture() const {
  if (!ready_) return nullptr;

  camera_fb_t* preview = esp_camera_fb_get();
  if (!preview) return nullptr;

  bool dark = false;
  if (!needsFlash(preview, dark) || !dark) return preview;

  // One frame buffer is configured: release the preview before capturing again.
  esp_camera_fb_return(preview);
  digitalWrite(kFlashPin, HIGH);
  delay(kFlashSettleMs);

  // Let auto-exposure adjust to the flash; discard the first lit frame.
  camera_fb_t* settlingFrame = esp_camera_fb_get();
  if (settlingFrame) esp_camera_fb_return(settlingFrame);

  camera_fb_t* result = esp_camera_fb_get();
  digitalWrite(kFlashPin, LOW);  // Also turn off the flash if capture failed.
  return result;
}

void CameraController::release(camera_fb_t* frame) const {
  if (frame) esp_camera_fb_return(frame);
}

