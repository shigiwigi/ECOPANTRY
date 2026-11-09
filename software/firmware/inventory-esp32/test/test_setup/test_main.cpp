// Host unit tests for the setup hotspot logic in lib/ecopantry_core. Run: pio test -e native
#include <unity.h>

#include <cstring>
#include <string>

#include "hold_button.h"
#include "setup_form.h"
#include "wifi_setup.h"

using namespace ecopantry;

void setUp() {}
void tearDown() {}

const char kToken[] = "epd_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_xyzAB";  // 4 + 43
const char kOtherToken[] = "epd_ZZZZEfGhIjKlMnOpQrStUvWxYz0123456789-_xyzAB";

StationSettings savedSettings() {
  StationSettings s;
  strcpy(s.ssid, "Bakery WiFi");
  strcpy(s.wifiPassword, "flour-and-water");
  strcpy(s.apiUrl, "https://ecopantry-api.onrender.com/api/v1");
  strcpy(s.deviceToken, kToken);
  return s;
}

bool apply(const std::string& body, const StationSettings& saved, StationSettings* next, SetupErrors* errors,
           bool allowHttp = false) {
  return applySetupForm(body.c_str(), body.size(), saved, allowHttp, next, errors);
}

// --- form decoding -----------------------------------------------------------

void test_url_decode_handles_plus_and_percent_escapes() {
  char out[32];
  const char in[] = "Caf%C3%A9+Wi%2dFi%26co";
  TEST_ASSERT_EQUAL(14, urlDecode(in, strlen(in), out, sizeof out));
  TEST_ASSERT_EQUAL_STRING("Caf\xC3\xA9 Wi-Fi&co", out);
}

void test_url_decode_refuses_bad_escapes_control_bytes_and_overflow() {
  char out[8];
  bool tooLong = false;
  TEST_ASSERT_EQUAL(-1, urlDecode("ab%4", 4, out, sizeof out));    // cut-off escape
  TEST_ASSERT_EQUAL(-1, urlDecode("ab%zz", 5, out, sizeof out));   // not hex
  TEST_ASSERT_EQUAL(-1, urlDecode("a%00b", 5, out, sizeof out));   // NUL would truncate the value
  TEST_ASSERT_EQUAL(-1, urlDecode("a%0Ab", 5, out, sizeof out));   // newline
  TEST_ASSERT_EQUAL(-1, urlDecode("12345678", 8, out, sizeof out, &tooLong));
  TEST_ASSERT_TRUE(tooLong);
  TEST_ASSERT_EQUAL(7, urlDecode("1234567", 7, out, sizeof out, &tooLong));
  TEST_ASSERT_FALSE(tooLong);
}

void test_form_field_finds_exact_names_only() {
  const char body[] = "ssid_other=hidden&ssid=Shop&password=&token";
  char out[32];
  TEST_ASSERT_EQUAL(FieldStatus::Ok, formField(body, strlen(body), "ssid", out, sizeof out));
  TEST_ASSERT_EQUAL_STRING("Shop", out);
  TEST_ASSERT_EQUAL(FieldStatus::Ok, formField(body, strlen(body), "password", out, sizeof out));
  TEST_ASSERT_EQUAL_STRING("", out);
  TEST_ASSERT_EQUAL(FieldStatus::Ok, formField(body, strlen(body), "token", out, sizeof out));
  TEST_ASSERT_EQUAL_STRING("", out);
  TEST_ASSERT_EQUAL(FieldStatus::Missing, formField(body, strlen(body), "api_url", out, sizeof out));
  TEST_ASSERT_EQUAL(FieldStatus::Missing, formField(body, strlen(body), "ss", out, sizeof out));
}

// --- field checks ------------------------------------------------------------

void test_wifi_password_is_empty_or_8_to_63_printable_characters() {
  TEST_ASSERT_EQUAL(SettingsError::None, checkWifiPassword(""));
  TEST_ASSERT_EQUAL(SettingsError::PasswordLength, checkWifiPassword("1234567"));
  TEST_ASSERT_EQUAL(SettingsError::None, checkWifiPassword("12345678"));
  TEST_ASSERT_EQUAL(SettingsError::None, checkWifiPassword(std::string(63, 'x').c_str()));
  TEST_ASSERT_EQUAL(SettingsError::PasswordLength, checkWifiPassword(std::string(64, 'x').c_str()));
  TEST_ASSERT_EQUAL(SettingsError::PasswordCharacters, checkWifiPassword("caf\xC3\xA9-password"));
}

void test_api_url_must_be_https_and_end_in_api_v1() {
  TEST_ASSERT_EQUAL(SettingsError::None, checkApiUrl("https://ecopantry-api.onrender.com/api/v1", false));
  TEST_ASSERT_EQUAL(SettingsError::None, checkApiUrl("https://api.example.org:8443/api/v1", false));
  TEST_ASSERT_EQUAL(SettingsError::ApiUrlMissing, checkApiUrl("", false));
  TEST_ASSERT_EQUAL(SettingsError::ApiUrlScheme, checkApiUrl("ftp://host/api/v1", false));
  TEST_ASSERT_EQUAL(SettingsError::ApiUrlScheme, checkApiUrl("ecopantry-api.onrender.com/api/v1", false));
  TEST_ASSERT_EQUAL(SettingsError::ApiUrlFormat, checkApiUrl("https://host/api/v2", false));
  TEST_ASSERT_EQUAL(SettingsError::ApiUrlFormat, checkApiUrl("https://host/api/v1?x=1", false));
  TEST_ASSERT_EQUAL(SettingsError::ApiUrlFormat, checkApiUrl("https://user@host/api/v1", false));
  TEST_ASSERT_EQUAL(SettingsError::ApiUrlFormat, checkApiUrl("https:///api/v1", false));
  TEST_ASSERT_EQUAL(SettingsError::ApiUrlFormat, checkApiUrl("https://host:0/api/v1", false));
  TEST_ASSERT_EQUAL(SettingsError::ApiUrlFormat, checkApiUrl("https://host:123456/api/v1", false));
}

void test_plain_http_is_only_for_the_lan_build() {
  TEST_ASSERT_EQUAL(SettingsError::ApiUrlHttpNotAllowed, checkApiUrl("http://192.168.1.20:8000/api/v1", false));
  TEST_ASSERT_EQUAL(SettingsError::None, checkApiUrl("http://192.168.1.20:8000/api/v1", true));
}

void test_device_token_is_epd_and_43_url_safe_characters() {
  TEST_ASSERT_EQUAL(SettingsError::None, checkDeviceToken(kToken));
  TEST_ASSERT_EQUAL(SettingsError::TokenMissing, checkDeviceToken(""));
  TEST_ASSERT_EQUAL(SettingsError::TokenFormat, checkDeviceToken("epd_short"));
  std::string wrongPrefix(kToken);
  wrongPrefix[0] = 'x';
  TEST_ASSERT_EQUAL(SettingsError::TokenFormat, checkDeviceToken(wrongPrefix.c_str()));
  std::string badChar(kToken);
  badChar[10] = '+';
  TEST_ASSERT_EQUAL(SettingsError::TokenFormat, checkDeviceToken(badChar.c_str()));
}

// --- the setup form ----------------------------------------------------------

void test_first_setup_needs_every_field() {
  StationSettings next;
  SetupErrors errors;
  const std::string body = std::string("ssid=Bakery+WiFi&ssid_other=&password=flour-and-water") +
                           "&api_url=https%3A%2F%2Fecopantry-api.onrender.com%2Fapi%2Fv1%2F&token=" + kToken;
  TEST_ASSERT_TRUE(apply(body, StationSettings(), &next, &errors));
  TEST_ASSERT_EQUAL_STRING("Bakery WiFi", next.ssid);
  TEST_ASSERT_EQUAL_STRING("flour-and-water", next.wifiPassword);
  TEST_ASSERT_EQUAL_STRING("https://ecopantry-api.onrender.com/api/v1", next.apiUrl);  // trailing / dropped
  TEST_ASSERT_EQUAL_STRING(kToken, next.deviceToken);

  TEST_ASSERT_FALSE(apply("ssid=&password=short&api_url=&token=", StationSettings(), &next, &errors));
  TEST_ASSERT_EQUAL(SettingsError::SsidMissing, errors.ssid);
  TEST_ASSERT_EQUAL(SettingsError::PasswordLength, errors.wifiPassword);
  TEST_ASSERT_EQUAL(SettingsError::ApiUrlMissing, errors.apiUrl);
  TEST_ASSERT_EQUAL(SettingsError::TokenMissing, errors.deviceToken);
}

void test_empty_token_and_password_keep_the_saved_ones() {
  const StationSettings saved = savedSettings();
  StationSettings next;
  SetupErrors errors;
  TEST_ASSERT_TRUE(apply("ssid=Bakery+WiFi&password=&api_url=https%3A%2F%2Fecopantry-api.onrender.com%2Fapi%2Fv1"
                         "&token=",
                         saved, &next, &errors));
  TEST_ASSERT_EQUAL_STRING("flour-and-water", next.wifiPassword);
  TEST_ASSERT_EQUAL_STRING(kToken, next.deviceToken);
  TEST_ASSERT_TRUE(sameWifi(saved, next));

  const std::string newToken = std::string("ssid=Bakery+WiFi&password=&api_url=https%3A%2F%2Fh.example%2Fapi%2Fv1") +
                               "&token=+" + kOtherToken + "+";  // pasted with spaces
  TEST_ASSERT_TRUE(apply(newToken, saved, &next, &errors));
  TEST_ASSERT_EQUAL_STRING(kOtherToken, next.deviceToken);
}

void test_empty_password_on_a_new_network_means_open() {
  StationSettings next;
  SetupErrors errors;
  TEST_ASSERT_TRUE(apply("ssid=Bakery+WiFi&ssid_other=Guest+&password=&api_url=https%3A%2F%2Fh.example%2Fapi%2Fv1"
                         "&token=",
                         savedSettings(), &next, &errors));
  TEST_ASSERT_EQUAL_STRING("Guest", next.ssid);  // the typed name wins, trimmed
  TEST_ASSERT_EQUAL_STRING("", next.wifiPassword);
  TEST_ASSERT_FALSE(sameWifi(savedSettings(), next));
}

void test_form_errors_leave_the_settings_alone() {
  StationSettings next = savedSettings();
  SetupErrors errors;
  const std::string longSsid(40, 'n');
  TEST_ASSERT_FALSE(apply("ssid=" + longSsid + "&password=%ZZ&api_url=http%3A%2F%2F10.0.0.2%3A8000%2Fapi%2Fv1&token=x",
                          StationSettings(), &next, &errors));
  TEST_ASSERT_EQUAL(SettingsError::TooLong, errors.ssid);
  TEST_ASSERT_EQUAL(SettingsError::BadEncoding, errors.wifiPassword);
  TEST_ASSERT_EQUAL(SettingsError::ApiUrlHttpNotAllowed, errors.apiUrl);
  TEST_ASSERT_EQUAL(SettingsError::TokenFormat, errors.deviceToken);
  TEST_ASSERT_EQUAL_STRING("Bakery WiFi", next.ssid);
  TEST_ASSERT_EQUAL_STRING(kToken, next.deviceToken);
}

void test_settings_complete_only_when_every_field_is_valid() {
  StationSettings s = savedSettings();
  TEST_ASSERT_TRUE(settingsComplete(s, false));
  strcpy(s.apiUrl, "http://192.168.1.20:8000/api/v1");  // saved by a LAN build, then reflashed
  TEST_ASSERT_FALSE(settingsComplete(s, false));
  TEST_ASSERT_TRUE(settingsComplete(s, true));
  s.ssid[0] = '\0';
  TEST_ASSERT_FALSE(settingsComplete(s, true));
}

void test_html_escape_never_cuts_an_entity() {
  char out[64];
  TEST_ASSERT_EQUAL(40, htmlEscape("<b onclick='x'>\"&", out, sizeof out));
  TEST_ASSERT_EQUAL_STRING("&lt;b onclick=&#39;x&#39;&gt;&quot;&amp;", out);
  char small[8];
  htmlEscape("ab<cd", small, sizeof small);
  TEST_ASSERT_EQUAL_STRING("ab&lt;c", small);
  htmlEscape("abcd&e", small, sizeof small);
  TEST_ASSERT_EQUAL_STRING("abcd", small);  // "&amp;" doesn't fit, so it stops before it
}

// --- the hotspot -------------------------------------------------------------

uint32_t sequence[16];
size_t sequenceIndex = 0;
uint32_t nextFromSequence() { return sequence[sequenceIndex++]; }

void test_hotspot_name_comes_from_the_mac() {
  const uint8_t mac[6] = {0x24, 0x6F, 0x28, 0x0A, 0xA1, 0xB2};
  char name[kHotspotNameSize];
  makeHotspotName(mac, name);
  TEST_ASSERT_EQUAL_STRING("EcoPantry-A1B2", name);
}

void test_hotspot_password_uses_the_random_source_without_bias() {
  for (size_t i = 0; i < 16; ++i) sequence[i] = static_cast<uint32_t>(i);
  sequence[0] = UINT32_MAX;  // above the last full multiple of the alphabet: drawn again
  sequenceIndex = 0;
  char password[kHotspotPasswordLength + 1];
  makeHotspotPassword(nextFromSequence, password);
  TEST_ASSERT_EQUAL(9, sequenceIndex);
  TEST_ASSERT_EQUAL_STRING("bcdefghj", password);  // values 1..8; no 'i' in the alphabet
  for (size_t i = 0; i < kHotspotPasswordLength; ++i) {
    TEST_ASSERT_NULL(strchr("0o1li", password[i]));
  }
}

void test_setup_page_is_only_for_hotspot_clients() {
  const uint32_t hotspot = 0x0104A8C0;  // 192.168.4.1 as IPAddress stores it
  const uint32_t mask = 0x00FFFFFF;     // 255.255.255.0
  const uint32_t phone = 0x0204A8C0;    // 192.168.4.2
  const uint32_t lanStation = 0x1401A8C0;
  const uint32_t lanLaptop = 0x1501A8C0;
  TEST_ASSERT_TRUE(isSetupClient(hotspot, phone, hotspot, mask));
  TEST_ASSERT_FALSE(isSetupClient(lanStation, lanLaptop, hotspot, mask));  // came in on the router's network
  TEST_ASSERT_FALSE(isSetupClient(hotspot, lanLaptop, hotspot, mask));
}

// --- WiFi / hotspot state machine ---------------------------------------------

WifiSetupTiming timing() { return WifiSetupTiming(); }

void test_no_settings_opens_the_hotspot_and_never_joins() {
  WifiSetup wifi(timing());
  wifi.begin(false, 0);
  wifi.update(false, 10);
  TEST_ASSERT_TRUE(wifi.hotspotOpen());
  TEST_ASSERT_EQUAL(HotspotReason::NotSetUp, wifi.reason());
  TEST_ASSERT_FALSE(wifi.takeJoinAttempt(10));
  TEST_ASSERT_FALSE(wifi.apiAllowed());
}

void test_saving_joins_and_closes_the_hotspot_once_online() {
  WifiSetup wifi(timing());
  wifi.begin(false, 0);
  wifi.onSaved(true, 1000);
  TEST_ASSERT_FALSE(wifi.takeJoinAttempt(2000));  // the "saved" page goes out first
  TEST_ASSERT_TRUE(wifi.takeJoinAttempt(4000));
  TEST_ASSERT_TRUE(wifi.joining(5000));
  wifi.update(true, 6000);
  TEST_ASSERT_FALSE(wifi.hotspotOpen());
  TEST_ASSERT_TRUE(wifi.apiAllowed());
}

void test_failed_save_keeps_the_hotspot_and_retries_every_30_s() {
  WifiSetup wifi(timing());
  wifi.begin(false, 0);
  wifi.onSaved(true, 0);
  TEST_ASSERT_TRUE(wifi.takeJoinAttempt(3000));
  wifi.update(false, 20000);
  TEST_ASSERT_TRUE(wifi.hotspotOpen());
  TEST_ASSERT_FALSE(wifi.takeJoinAttempt(32999));
  TEST_ASSERT_TRUE(wifi.takeJoinAttempt(33000));
  TEST_ASSERT_TRUE(wifi.takeJoinAttempt(63000));
}

void test_saved_wifi_failing_for_2_minutes_opens_the_hotspot() {
  WifiSetup wifi(timing());
  wifi.begin(true, 0);
  TEST_ASSERT_FALSE(wifi.hotspotOpen());
  TEST_ASSERT_TRUE(wifi.takeJoinAttempt(0));
  TEST_ASSERT_FALSE(wifi.takeJoinAttempt(14999));
  TEST_ASSERT_TRUE(wifi.takeJoinAttempt(15000));  // every 15 s while the hotspot is closed
  wifi.update(false, 119999);
  TEST_ASSERT_FALSE(wifi.hotspotOpen());
  wifi.update(false, 120000);
  TEST_ASSERT_EQUAL(HotspotReason::CannotJoin, wifi.reason());
  // The network comes back: the hotspot closes without anything being saved.
  wifi.update(true, 150000);
  TEST_ASSERT_FALSE(wifi.hotspotOpen());
}

void test_a_dropped_connection_restarts_the_2_minute_clock() {
  WifiSetup wifi(timing());
  wifi.begin(true, 0);
  wifi.update(true, 1000);
  wifi.update(true, 500000);
  wifi.update(false, 600000);
  wifi.update(false, 719999);
  TEST_ASSERT_FALSE(wifi.hotspotOpen());
  wifi.update(false, 720000);
  TEST_ASSERT_TRUE(wifi.hotspotOpen());
}

void test_refused_token_opens_the_hotspot_until_a_save() {
  WifiSetup wifi(timing());
  wifi.begin(true, 0);
  wifi.update(true, 1000);
  wifi.onTokenRefused(2000);
  wifi.update(true, 3000);
  TEST_ASSERT_EQUAL(HotspotReason::TokenRefused, wifi.reason());
  TEST_ASSERT_FALSE(wifi.apiAllowed());
  wifi.update(true, 10 * 60 * 1000);  // still open: nothing saved
  TEST_ASSERT_TRUE(wifi.hotspotOpen());
  wifi.onSaved(false, 700000);
  wifi.update(true, 702999);
  TEST_ASSERT_TRUE(wifi.hotspotOpen());
  wifi.update(true, 703000);
  TEST_ASSERT_FALSE(wifi.hotspotOpen());
}

void test_requested_setup_closes_after_10_idle_minutes_when_online() {
  WifiSetup wifi(timing());
  wifi.begin(true, 0);
  wifi.update(true, 0);
  wifi.onSetupRequested(1000);
  wifi.update(true, 2000);
  TEST_ASSERT_EQUAL(HotspotReason::Requested, wifi.reason());
  wifi.update(true, 600999);
  TEST_ASSERT_TRUE(wifi.hotspotOpen());
  wifi.update(true, 601000);
  TEST_ASSERT_FALSE(wifi.hotspotOpen());
}

void test_forgetting_wifi_opens_setup_and_stops_joining() {
  WifiSetup wifi(timing());
  wifi.begin(true, 0);
  wifi.update(true, 0);
  wifi.onWifiForgotten(5000);
  wifi.update(false, 5050);
  TEST_ASSERT_EQUAL(HotspotReason::NotSetUp, wifi.reason());
  TEST_ASSERT_FALSE(wifi.takeJoinAttempt(100000));
}

// --- BOOT button ---------------------------------------------------------------

void test_boot_must_be_held_5_s_without_release() {
  HoldButton boot(5000);
  TEST_ASSERT_FALSE(boot.update(true, 0));
  TEST_ASSERT_FALSE(boot.update(true, 4000));
  TEST_ASSERT_EQUAL_UINT32(4000, boot.heldMs(4000));
  TEST_ASSERT_FALSE(boot.update(false, 4100));  // let go: start again
  TEST_ASSERT_FALSE(boot.update(true, 4200));
  TEST_ASSERT_FALSE(boot.update(true, 9199));
  TEST_ASSERT_TRUE(boot.update(true, 9200));
  TEST_ASSERT_FALSE(boot.update(true, 20000));  // once per press
  TEST_ASSERT_EQUAL_UINT32(0, boot.heldMs(20000));
  boot.update(false, 20100);
  boot.update(true, 20200);
  TEST_ASSERT_TRUE(boot.update(true, 25200));
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_url_decode_handles_plus_and_percent_escapes);
  RUN_TEST(test_url_decode_refuses_bad_escapes_control_bytes_and_overflow);
  RUN_TEST(test_form_field_finds_exact_names_only);
  RUN_TEST(test_wifi_password_is_empty_or_8_to_63_printable_characters);
  RUN_TEST(test_api_url_must_be_https_and_end_in_api_v1);
  RUN_TEST(test_plain_http_is_only_for_the_lan_build);
  RUN_TEST(test_device_token_is_epd_and_43_url_safe_characters);
  RUN_TEST(test_first_setup_needs_every_field);
  RUN_TEST(test_empty_token_and_password_keep_the_saved_ones);
  RUN_TEST(test_empty_password_on_a_new_network_means_open);
  RUN_TEST(test_form_errors_leave_the_settings_alone);
  RUN_TEST(test_settings_complete_only_when_every_field_is_valid);
  RUN_TEST(test_html_escape_never_cuts_an_entity);
  RUN_TEST(test_hotspot_name_comes_from_the_mac);
  RUN_TEST(test_hotspot_password_uses_the_random_source_without_bias);
  RUN_TEST(test_setup_page_is_only_for_hotspot_clients);
  RUN_TEST(test_no_settings_opens_the_hotspot_and_never_joins);
  RUN_TEST(test_saving_joins_and_closes_the_hotspot_once_online);
  RUN_TEST(test_failed_save_keeps_the_hotspot_and_retries_every_30_s);
  RUN_TEST(test_saved_wifi_failing_for_2_minutes_opens_the_hotspot);
  RUN_TEST(test_a_dropped_connection_restarts_the_2_minute_clock);
  RUN_TEST(test_refused_token_opens_the_hotspot_until_a_save);
  RUN_TEST(test_requested_setup_closes_after_10_idle_minutes_when_online);
  RUN_TEST(test_forgetting_wifi_opens_setup_and_stops_joining);
  RUN_TEST(test_boot_must_be_held_5_s_without_release);
  return UNITY_END();
}
