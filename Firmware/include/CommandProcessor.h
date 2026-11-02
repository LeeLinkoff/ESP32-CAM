#pragma once

#include <Arduino.h>
#include "CameraController.h"
#include "FirmwareSelfTest.h"
#include "Settings.h"

class CommandProcessor {
 public:
  CommandProcessor(CameraController& camera, Settings& settings)
      : camera_(camera), tests_(camera, settings) {}
  void execute(String line, Stream& output);

 private:
  CameraController& camera_;
  FirmwareSelfTest tests_;
};

