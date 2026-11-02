#include <unity.h>
#include "ProtocolChecks.h"

void setUp() {}
void tearDown() {}

void test_supported_commands() {
  TEST_ASSERT_TRUE(isSupportedCommand("c"));
  TEST_ASSERT_TRUE(isSupportedCommand("i"));
  TEST_ASSERT_TRUE(isSupportedCommand("t"));
}

void test_mode_commands_not_supported_on_device() {
  TEST_ASSERT_FALSE(isSupportedCommand("m"));
  TEST_ASSERT_FALSE(isSupportedCommand("m tcp"));
  TEST_ASSERT_FALSE(isSupportedCommand("http"));
  TEST_ASSERT_FALSE(isSupportedCommand(""));
  TEST_ASSERT_FALSE(isSupportedCommand(nullptr));
}

void test_valid_jpeg_markers() {
  const std::uint8_t jpeg[] = {0xFF, 0xD8, 0x10, 0x20, 0xFF, 0xD9};
  TEST_ASSERT_TRUE(hasJpegMarkers(jpeg, sizeof(jpeg)));
}

void test_reject_invalid_jpeg_frames() {
  const std::uint8_t badHeader[] = {0x00, 0xD8, 0xFF, 0xD9};
  const std::uint8_t truncated[] = {0xFF, 0xD8, 0x01, 0x02};
  TEST_ASSERT_FALSE(hasJpegMarkers(badHeader, sizeof(badHeader)));
  TEST_ASSERT_FALSE(hasJpegMarkers(truncated, sizeof(truncated)));
  TEST_ASSERT_FALSE(hasJpegMarkers(truncated, 3));
  TEST_ASSERT_FALSE(hasJpegMarkers(nullptr, 0));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_supported_commands);
  RUN_TEST(test_mode_commands_not_supported_on_device);
  RUN_TEST(test_valid_jpeg_markers);
  RUN_TEST(test_reject_invalid_jpeg_frames);
  return UNITY_END();
}
