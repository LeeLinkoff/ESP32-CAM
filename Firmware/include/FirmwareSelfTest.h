#pragma once

#include <Arduino.h>
#include "CameraController.h"
#include "Settings.h"

class FirmwareSelfTest {
 public:
  FirmwareSelfTest(CameraController& camera, Settings& settings)
      : camera_(camera), settings_(settings) {}

  // Safe on a running device. Does not alter any active transport.
  String run() const;

 private:
  CameraController& camera_;
  Settings& settings_;
};

