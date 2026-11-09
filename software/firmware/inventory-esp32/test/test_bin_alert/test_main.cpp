// Host unit tests for the local "bin nearly full" warning. Run: pio test -e native
#include <unity.h>

#include <cmath>

#include "bin_alert.h"

using namespace ecopantry;

void setUp() {}
void tearDown() {}

// The defaults in include/config.h: full at 2.0 kg, clear below 1.5 kg, 5 s to confirm,
// at most one beep per 10 minutes.
BinAlert makeAlert() { return BinAlert(2000.0f, 1500.0f, 5000, 600000); }

void test_becomes_full_once_the_weight_stays_at_2_kg() {
  BinAlert alert = makeAlert();
  TEST_ASSERT_EQUAL(BinAlert::Change::None, alert.update(true, 1999.0f, 0));
  TEST_ASSERT_EQUAL(BinAlert::Change::None, alert.update(true, 2000.0f, 1000));
  TEST_ASSERT_EQUAL(BinAlert::Change::None, alert.update(true, 2100.0f, 5999));
  TEST_ASSERT_FALSE(alert.full());
  TEST_ASSERT_EQUAL(BinAlert::Change::BecameFull, alert.update(true, 2100.0f, 6000));  // rising edge
  TEST_ASSERT_TRUE(alert.full());
  TEST_ASSERT_EQUAL(BinAlert::Change::None, alert.update(true, 2100.0f, 7000));      // only once
}

void test_a_brief_push_on_the_bin_does_not_trigger_it() {
  BinAlert alert = makeAlert();
  alert.update(true, 2500.0f, 0);
  alert.update(true, 2500.0f, 4000);
  alert.update(true, 800.0f, 4500);  // hand off the lid
  TEST_ASSERT_EQUAL(BinAlert::Change::None, alert.update(true, 2500.0f, 6000));
  TEST_ASSERT_FALSE(alert.full());
}

void test_clears_only_below_1_5_kg() {
  BinAlert alert = makeAlert();
  alert.update(true, 2000.0f, 0);
  alert.update(true, 2000.0f, 5000);
  TEST_ASSERT_TRUE(alert.full());
  alert.update(true, 1600.0f, 6000);  // between the thresholds: stays full
  TEST_ASSERT_EQUAL(BinAlert::Change::None, alert.update(true, 1500.0f, 20000));
  TEST_ASSERT_TRUE(alert.full());
  alert.update(true, 1499.0f, 21000);
  TEST_ASSERT_EQUAL(BinAlert::Change::Cleared, alert.update(true, 200.0f, 26000));
  TEST_ASSERT_FALSE(alert.full());
}

void test_a_failed_load_cell_neither_raises_nor_clears_it() {
  BinAlert alert = makeAlert();
  alert.update(false, 9000.0f, 0);
  TEST_ASSERT_EQUAL(BinAlert::Change::None, alert.update(false, 9000.0f, 60000));
  TEST_ASSERT_FALSE(alert.full());

  alert.update(true, 2200.0f, 70000);
  alert.update(true, 2200.0f, 75000);
  TEST_ASSERT_TRUE(alert.full());
  TEST_ASSERT_EQUAL(BinAlert::Change::None, alert.update(false, 0.0f, 80000));
  TEST_ASSERT_EQUAL(BinAlert::Change::None, alert.update(true, NAN, 90000));
  TEST_ASSERT_TRUE(alert.full());
}

void test_a_fault_restarts_the_confirmation() {
  BinAlert alert = makeAlert();
  alert.update(true, 2500.0f, 0);
  alert.update(false, 2500.0f, 3000);
  alert.update(true, 2500.0f, 4000);
  TEST_ASSERT_EQUAL(BinAlert::Change::None, alert.update(true, 2500.0f, 8999));
  TEST_ASSERT_EQUAL(BinAlert::Change::BecameFull, alert.update(true, 2500.0f, 9000));
}

void test_beeps_once_per_fill_and_at_most_every_10_minutes() {
  BinAlert alert = makeAlert();
  TEST_ASSERT_FALSE(alert.takeBeep(0));
  alert.update(true, 2500.0f, 0);
  alert.update(true, 2500.0f, 5000);
  TEST_ASSERT_TRUE(alert.takeBeep(5000));
  TEST_ASSERT_FALSE(alert.takeBeep(5100));  // not continuous

  // Emptied and refilled within 10 minutes: the LED and LCD say so, the buzzer stays quiet.
  alert.update(true, 0.0f, 10000);
  alert.update(true, 0.0f, 15000);
  alert.update(true, 2500.0f, 20000);
  alert.update(true, 2500.0f, 25000);
  TEST_ASSERT_TRUE(alert.full());
  TEST_ASSERT_FALSE(alert.takeBeep(25000));

  alert.update(true, 0.0f, 700000);
  alert.update(true, 0.0f, 705000);
  alert.update(true, 2500.0f, 710000);
  alert.update(true, 2500.0f, 715000);
  TEST_ASSERT_TRUE(alert.takeBeep(715000));
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_becomes_full_once_the_weight_stays_at_2_kg);
  RUN_TEST(test_a_brief_push_on_the_bin_does_not_trigger_it);
  RUN_TEST(test_clears_only_below_1_5_kg);
  RUN_TEST(test_a_failed_load_cell_neither_raises_nor_clears_it);
  RUN_TEST(test_a_fault_restarts_the_confirmation);
  RUN_TEST(test_beeps_once_per_fill_and_at_most_every_10_minutes);
  return UNITY_END();
}
