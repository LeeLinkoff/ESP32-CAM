#include "CommandProcessor.h"

void CommandProcessor::execute(String line, Stream& output) {
  line.trim();
  if (line == "i") {
    output.println(camera_.infoJson());
    return;
  }
  if (line == "t") {
    output.println(tests_.run());
    return;
  }
  if (line == "c") {
    camera_fb_t* frame = camera_.capture();
    if (!frame) {
      output.println("{\"ok\":false,\"error\":\"capture_failed\"}");
      return;
    }
    // Framing: JSON header + LF, then exactly `size` raw JPEG bytes.
    output.print("{\"ok\":true,\"cmd\":\"c\",\"mime\":\"image/jpeg\",\"size\":");
    output.print(frame->len);
    output.println("}");
    size_t sent = 0;
    while (sent < frame->len) {
      const size_t chunk = min(static_cast<size_t>(2048), frame->len - sent);
      const size_t count = output.write(frame->buf + sent, chunk);
      if (!count) break; // Disconnected transport; parser will reject a short frame.
      sent += count;
    }
    camera_.release(frame);
    return;
  }
  output.println("{\"ok\":false,\"error\":\"unknown_command\"}");
}

