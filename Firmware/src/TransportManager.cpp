#include "TransportManager.h"
#include "AppConfig.h"

TransportManager::TransportManager(CameraController& camera, Settings& settings)
    : camera_(camera), settings_(settings), commands_(camera, settings), tests_(camera, settings) {}

void TransportManager::begin() {
  installHttpHandlers();
  // USB serial is already running. Bluetooth and Wi-Fi start independently.
  bluetoothListening_ = bluetooth_.begin(settings_.bluetoothName());
  Serial.println(bluetoothListening_ ? "Bluetooth SPP listening" : "Bluetooth SPP failed to start");
  if (settings_.wifiConfigured()) {
    startWifi();
  } else {
    Serial.println("Wi-Fi disabled: set CAMERA_WIFI_SSID in include/AppConfig.h");
  }
  Serial.println("ESP32-CAM commands: i (info), c (JPEG), t (self-test)");
}

void TransportManager::poll() {
  // All enabled transports are serviced on every iteration of the main loop.
  pollLines(Serial, usbLine_);
  if (bluetoothListening_) pollLines(bluetooth_, bluetoothLine_);
  pollWifi();
}

void TransportManager::pollLines(Stream& input, String& buffer) {
  // Bound the command length; JPEG payloads are outbound only.
  for (int consumed = 0; input.available() && consumed < 256; ++consumed) {
    const char character = static_cast<char>(input.read());
    if (character == '\n' || character == '\r') {
      if (!buffer.isEmpty()) {
        commands_.execute(buffer, input);
        buffer = "";
      }
    } else if (buffer.length() < 80) {
      buffer += character;
    } else {
      buffer = "";
      input.println("{\"ok\":false,\"error\":\"command_too_long\"}");
    }
  }
}

void TransportManager::stopWifiServers() {
  if (tcpClient_) tcpClient_.stop();
  if (tcpListening_) tcpServer_.end();
  if (httpListening_) http_.stop();
  tcpListening_ = false;
  httpListening_ = false;
  tcpLine_ = "";
}

void TransportManager::startWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(settings_.wifiSsid(), settings_.wifiPassword());
  wifiAttemptAt_ = millis();
  Serial.println("Wi-Fi connecting (TCP + HTTP will start when connected)");
}

void TransportManager::pollWifi() {
  if (!settings_.wifiConfigured()) return;
  if (WiFi.status() != WL_CONNECTED) {
    if (tcpListening_ || httpListening_) {
      stopWifiServers();
      Serial.println("Wi-Fi lost; TCP/HTTP stopped; USB/Bluetooth still active");
    }
    if (millis() - wifiAttemptAt_ >= 15000) {
      WiFi.reconnect();
      wifiAttemptAt_ = millis();
    }
    return;
  }
  if (!httpListening_) {
    http_.begin();
    httpListening_ = true;
    Serial.print("HTTP listening: http://");
    Serial.println(WiFi.localIP());
  }
  if (!tcpListening_) {
    tcpServer_.begin();
    tcpListening_ = true;
    Serial.print("TCP: ");
    Serial.print(WiFi.localIP());
    Serial.println(":3333");
  }
  // HTTP, raw TCP, Bluetooth and USB all stay enabled concurrently.
  http_.handleClient();
  if (!tcpClient_ || !tcpClient_.connected()) {
    if (tcpClient_) tcpClient_.stop();
    tcpClient_ = tcpServer_.available();
    tcpLine_ = "";
  }
  if (tcpClient_ && tcpClient_.connected()) pollLines(tcpClient_, tcpLine_);
}

void TransportManager::installHttpHandlers() {
  http_.on("/info", HTTP_GET, [this]() { sendHttpInfo(); });
  http_.on("/test", HTTP_GET, [this]() { sendHttpTest(); });
  http_.on("/capture", HTTP_GET, [this]() { sendHttpCapture(); });
  http_.onNotFound([this]() {
    http_.send(404, "application/json", "{\"ok\":false,\"error\":\"not_found\"}");
  });
}

void TransportManager::sendHttpInfo() {
  http_.send(200, "application/json", camera_.infoJson());
}

void TransportManager::sendHttpTest() {
  http_.send(200, "application/json", tests_.run());
}

void TransportManager::sendHttpCapture() {
  camera_fb_t* frame = camera_.capture();
  if (!frame) {
    http_.send(503, "application/json", "{\"ok\":false,\"error\":\"capture_failed\"}");
    return;
  }
  http_.setContentLength(frame->len);
  http_.send(200, "image/jpeg", "");
  size_t sent = 0;
  while (sent < frame->len) {
    const size_t chunk = min(static_cast<size_t>(2048), frame->len - sent);
    const size_t count = http_.client().write(frame->buf + sent, chunk);
    if (!count) break;
    sent += count;
  }
  camera_.release(frame);
}


