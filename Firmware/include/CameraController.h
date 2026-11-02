#pragma once

#include <Arduino.h>
#include <esp_camera.h>

class CameraController {
 public:
  bool begin();
  String infoJson() const;
  camera_fb_t* capture() const;
  void release(camera_fb_t* frame) const;
  bool ready() const { return ready_; }

 private:
  bool ready_ = false;
};

