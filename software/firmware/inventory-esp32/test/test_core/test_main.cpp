// Host unit tests for lib/ecopantry_core. Run: pio test -e native
#include <unity.h>

#include <cmath>
#include <cstring>
#include <string>

#include "live_session.h"
#include "moving_average.h"
#include "ph.h"
#include "reading.h"
#include "ring_buffer.h"
#include "uid.h"

using namespace ecopantry;

void setUp() {}
void tearDown() {}

// --- pH ----------------------------------------------------------------------

void test_ph_matches_the_working_sketch() {
  // The sketch: espVoltage = adc/4095*3.3; sensorVoltage = espVoltage*3.2; pH = -10.95*V + 18.86
  const float volts = adcToProbeVoltage(2048.0f, 4095.0f, 3.3f, 3.2f);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 2048.0f / 4095.0f * 3.3f * 3.2f, volts);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, -10.95f * volts + 18.86f, voltageToPh(volts, kDefaultPhCalibration));
}

void test_two_point_calibration_fits_both_points() {
  PhCalibration cal{};
  TEST_ASSERT_TRUE(calibrateTwoPoint(1.20f, 7.00f, 1.48f, 4.01f, &cal));
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 7.00f, voltageToPh(1.20f, cal));
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 4.01f, voltageToPh(1.48f, cal));
}

void test_two_point_calibration_refuses_equal_voltages() {
  PhCalibration cal = kDefaultPhCalibration;
  TEST_ASSERT_FALSE(calibrateTwoPoint(1.200f, 7.0f, 1.205f, 4.0f, &cal));
  TEST_ASSERT_EQUAL_FLOAT(kDefaultPhCalibration.slope, cal.slope);
}

// --- card UIDs ---------------------------------------------------------------

void test_uid_is_upper_case_hex_with_colons() {
  const uint8_t bytes[] = {0xD5, 0x61, 0xE9, 0x07};
  char text[kUidTextSize];
  TEST_ASSERT_EQUAL(11, formatUid(bytes, sizeof bytes, text, sizeof text));
  TEST_ASSERT_EQUAL_STRING("D5:61:E9:07", text);
}

void test_uid_rejects_odd_lengths_and_small_buffers() {
  const uint8_t bytes[10] = {0};
  char text[kUidTextSize];
  TEST_ASSERT_EQUAL(0, formatUid(bytes, 5, text, sizeof text));
  TEST_ASSERT_EQUAL(29, formatUid(bytes, 10, text, sizeof text));
  TEST_ASSERT_EQUAL(0, formatUid(bytes, 4, text, 11));  // needs 12 with the terminator
}

// --- readings ----------------------------------------------------------------

Reading goodReading() {
  Reading r;
  r.uptimeMs = 12000;
  r.temperatureC = 24.46f; r.hasTemperature = true;
  r.humidityPct = 61.0f; r.hasHumidity = true;
  r.weightG = 412.34f; r.hasWeight = true;
  r.ph = 6.612f; r.hasPh = true;
  r.phVoltage = 1.1234f; r.hasPhVoltage = true;
  r.dhtOk = r.loadCellOk = true;
  return r;
}

void test_batch_json_matches_the_api() {
  const Reading readings[] = {goodReading()};
  char json[512];
  TEST_ASSERT_GREATER_THAN(0, writeBatchJson(readings, 1, 15000, json, sizeof json));
  TEST_ASSERT_EQUAL_STRING(
      "{\"sent_uptime_ms\":15000,\"readings\":[{\"uptime_ms\":12000,\"temperature_c\":24.5,\"humidity_pct\":61.0,"
      "\"weight_g\":412.3,\"ph_value\":6.61,\"ph_voltage\":1.123,\"dht_ok\":true,\"load_cell_ok\":true}]}",
      json);
}

void test_failed_and_out_of_range_values_become_null() {
  Reading r = goodReading();
  r.dhtOk = false;            // DHT failed: temperature and humidity must be null
  r.ph = 15.2f;               // impossible pH (probe unplugged): null, or the API refuses the batch
  r.weightG = NAN;            // NaN from a bad read
  char json[512];
  TEST_ASSERT_GREATER_THAN(0, writeBatchJson(&r, 1, 12000, json, sizeof json));
  const std::string text(json);
  TEST_ASSERT_TRUE(text.find("\"temperature_c\":null") != std::string::npos);
  TEST_ASSERT_TRUE(text.find("\"humidity_pct\":null") != std::string::npos);
  TEST_ASSERT_TRUE(text.find("\"ph_value\":null") != std::string::npos);
  TEST_ASSERT_TRUE(text.find("\"weight_g\":null") != std::string::npos);
  TEST_ASSERT_TRUE(text.find("\"dht_ok\":false") != std::string::npos);
}

void test_batch_json_reports_overflow() {
  const Reading readings[] = {goodReading(), goodReading()};
  char json[100];
  TEST_ASSERT_EQUAL(0, writeBatchJson(readings, 2, 15000, json, sizeof json));
}

void test_batch_json_fits_the_documented_worst_case() {
  Reading worst = goodReading();
  worst.uptimeMs = UINT64_MAX;
  worst.weightG = -4999.99f;
  char json[kMaxReadingJsonSize + 64];
  TEST_ASSERT_GREATER_THAN(0, writeBatchJson(&worst, 1, UINT64_MAX, json, sizeof json));
}

// --- buffers -----------------------------------------------------------------

void test_ring_buffer_drops_the_oldest_when_full() {
  RingBuffer<int, 3> buffer;
  TEST_ASSERT_FALSE(buffer.push(1));
  buffer.push(2);
  buffer.push(3);
  TEST_ASSERT_TRUE(buffer.push(4));
  int out[3];
  TEST_ASSERT_EQUAL(3, buffer.peekOldest(out, 3));
  TEST_ASSERT_EQUAL(2, out[0]);
  TEST_ASSERT_EQUAL(4, out[2]);
  buffer.dropOldest(2);
  TEST_ASSERT_EQUAL(1, buffer.size());
  buffer.peekOldest(out, 3);
  TEST_ASSERT_EQUAL(4, out[0]);
}

void test_moving_average_uses_the_last_n_samples() {
  MovingAverage<3> average;
  average.add(1);
  average.add(2);
  average.add(3);
  average.add(10);
  TEST_ASSERT_FLOAT_WITHIN(0.0001f, 5.0f, average.value());
}

// --- live session ------------------------------------------------------------

void test_session_starts_by_asking_for_a_boot_session() {
  LiveSession session(60 * 60 * 1000);
  TEST_ASSERT_TRUE(session.wantsBootSession());
  TEST_ASSERT_FALSE(session.mayUpload());
}

void test_session_pauses_itself_when_time_runs_out() {
  LiveSession session(60 * 60 * 1000);
  session.onStatus(true, 300, false, 1000);
  TEST_ASSERT_TRUE(session.mayUpload());
  TEST_ASSERT_EQUAL_UINT32(300000, session.remainingMs(1000));
  session.tick(300999);
  TEST_ASSERT_TRUE(session.mayUpload());
  session.tick(301000);
  TEST_ASSERT_EQUAL(SessionState::Paused, session.state());
  TEST_ASSERT_FALSE(session.mayUpload());
}

void test_session_survives_millis_wrapping() {
  LiveSession session(60 * 60 * 1000);
  const uint32_t start = UINT32_MAX - 1000;
  session.onStatus(true, 10, false, start);
  TEST_ASSERT_EQUAL_UINT32(10000 - 2000, session.remainingMs(start + 2000));  // wrapped past zero
}

void test_session_is_capped_locally() {
  LiveSession session(60 * 1000);
  session.onStatus(true, 24 * 3600, false, 0);
  TEST_ASSERT_EQUAL_UINT32(60 * 1000, session.remainingMs(0));
}

void test_server_refusal_pauses_and_401_locks_for_good() {
  LiveSession session(60 * 60 * 1000);
  session.onStatus(true, 900, false, 0);
  session.onNotLive();
  TEST_ASSERT_EQUAL(SessionState::Paused, session.state());

  session.onUnauthorized();
  session.onStatus(true, 900, false, 0);  // nothing can revive it before a reboot
  session.restart();
  TEST_ASSERT_EQUAL(SessionState::Locked, session.state());
}

void test_boot_session_gives_up_after_repeated_failures() {
  LiveSession session(60 * 60 * 1000, 3);
  session.onBootAttemptFailed();
  session.onBootAttemptFailed();
  TEST_ASSERT_TRUE(session.wantsBootSession());
  session.onBootAttemptFailed();
  TEST_ASSERT_EQUAL(SessionState::Paused, session.state());
}

void test_not_live_answer_pauses_and_keeps_budget_flag() {
  LiveSession session(60 * 60 * 1000);
  session.onStatus(false, 0, true, 0);
  TEST_ASSERT_EQUAL(SessionState::Paused, session.state());
  TEST_ASSERT_TRUE(session.budgetExhausted());
}

void test_backoff_doubles_up_to_the_cap() {
  Backoff backoff(2000, 10000);
  TEST_ASSERT_EQUAL_UINT32(2000, backoff.next());
  TEST_ASSERT_EQUAL_UINT32(4000, backoff.next());
  TEST_ASSERT_EQUAL_UINT32(8000, backoff.next());
  TEST_ASSERT_EQUAL_UINT32(10000, backoff.next());
  TEST_ASSERT_EQUAL_UINT32(10000, backoff.next());
  backoff.reset();
  TEST_ASSERT_EQUAL_UINT32(2000, backoff.next());
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_ph_matches_the_working_sketch);
  RUN_TEST(test_two_point_calibration_fits_both_points);
  RUN_TEST(test_two_point_calibration_refuses_equal_voltages);
  RUN_TEST(test_uid_is_upper_case_hex_with_colons);
  RUN_TEST(test_uid_rejects_odd_lengths_and_small_buffers);
  RUN_TEST(test_batch_json_matches_the_api);
  RUN_TEST(test_failed_and_out_of_range_values_become_null);
  RUN_TEST(test_batch_json_reports_overflow);
  RUN_TEST(test_batch_json_fits_the_documented_worst_case);
  RUN_TEST(test_ring_buffer_drops_the_oldest_when_full);
  RUN_TEST(test_moving_average_uses_the_last_n_samples);
  RUN_TEST(test_session_starts_by_asking_for_a_boot_session);
  RUN_TEST(test_session_pauses_itself_when_time_runs_out);
  RUN_TEST(test_session_survives_millis_wrapping);
  RUN_TEST(test_session_is_capped_locally);
  RUN_TEST(test_server_refusal_pauses_and_401_locks_for_good);
  RUN_TEST(test_boot_session_gives_up_after_repeated_failures);
  RUN_TEST(test_not_live_answer_pauses_and_keeps_budget_flag);
  RUN_TEST(test_backoff_doubles_up_to_the_cap);
  return UNITY_END();
}
