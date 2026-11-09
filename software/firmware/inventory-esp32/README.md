# Inventory station firmware (ESP32)

Version 0.2.0. No WiFi password, API address or token is compiled in: they are entered on the station's own setup hotspot and saved in flash.

Firmware for the prototype station, a single ESP32 DevKit carrying every sensor:

| Part | What it does here |
|---|---|
| DHT11 | Storage temperature and humidity |
| HX711 + load cell | Weight of the **waste bin** |
| Analog pH board | Milk pH, **experimental** |
| MFRC522 | Staff card taps |
| 16x2 I2C LCD, green/red LED, buzzer | Local display and feedback |

Wiring, pins and safety notes: [hardware/inventory-station/README.md](../../../hardware/inventory-station/README.md).
How the station, API and portal fit together: [docs/HARDWARE_INTEGRATION.md](../../../docs/HARDWARE_INTEGRATION.md).

The station talks only to the EcoPantry API over HTTPS, with its own device token. It never connects to the database.

## Live sessions: when the station uploads

The station uploads readings only during a **live session**. Outside a session it keeps measuring and showing values on the LCD, but sends nothing at all. That lets the free-tier API (Render) and database (Neon) go to sleep.

| What happens | Result |
|---|---|
| Power-on | The station asks for a short session (5 min by default) |
| An authorised card is tapped | The session opens, or is extended to 15 min from now |
| Session time runs out | Uploads stop; the LCD shows `UPLOAD PAUSED` / `TAP CARD:GO LIVE` |
| The server refuses an upload (409) | The station pauses at once, even if its own timer disagrees |
| The daily limit is used (240 min by default) | Taps are still checked, but the session isn't extended (`DAILY LIMIT HIT`) |
| The token is refused (401) | `TOKEN REFUSED`; no more requests, and the setup hotspot opens so a new token can be entered (or reboot) |
| The setup hotspot is open | Nothing is uploaded until it closes (the station is online again) |

The backend owns all of these lengths (`LIVE_SESSION_MINUTES`, `DEVICE_BOOT_SESSION_MINUTES`, `DEVICE_DAILY_LIVE_MINUTES`, `DEVICE_REPORT_INTERVAL_SECONDS` in `website/backend/.env`). The station also caps any one session at 60 minutes locally.

## Setup

You need [PlatformIO](https://platformio.org/) (the VS Code extension or the `pio` CLI).

1. **Register the station** to get its token. Either an administrator does it on the portal's **Devices** page, or from `website/backend/`:

   ```bash
   .venv/bin/python -m app.cli create-device --name "Inventory station 1"
   ```

   The token (`epd_...`) is shown **once**.

2. **Build and flash.** Nothing secret is needed to build.

   ```bash
   pio run -e esp32dev -t upload
   pio device monitor -e esp32dev
   ```

   Keep the bin empty while the station starts: it tares the load cell at boot.

3. **Enter the WiFi and API details on the hotspot.** A new station has nothing saved, so it opens its setup hotspot:
   - The LCD rotates through the hotspot name (`EcoPantry-A1B2`, from the board's MAC), its **password** (random, new every time it opens, shown only on the LCD and serial monitor), and `192.168.4.1`.
   - On a phone, join that WiFi with the password, then open **http://192.168.4.1** (most phones offer "sign in to network" and open it for you).
   - Pick the 2.4 GHz network from the list (or type a hidden one), enter its password (8-63 characters, or empty for an open network), the API address, and the device token from step 1. Leave the token empty to keep the saved one.
   - Press **Save and connect**. The LCD shows `CONNECTING TO:` and then `ONLINE`, and the hotspot closes. If the details are wrong, the hotspot stays open, the details stay saved and the station retries every 30 s, so you can correct them from the same page.

   The API address is the Render service ending in `/api/v1` (`https://<your-render-service>.onrender.com/api/v1`, Render directly, not the website). Plain `http://` is accepted only by the `esp32dev-lan` build. The page is served only to phones on the hotspot, allows at most 2 clients, and never shows the saved WiFi password or token. Not supported: 5 GHz networks, and networks that need a login page.

   The details are stored in flash (NVS) **unencrypted**: anyone with the board and a USB cable can read them back. They are never printed to the serial monitor or sent to the page.

### Changing networks, token or API address

- WiFi: hold the **BOOT** button for 5 s (the LCD shows `KEEP HOLDING...` and then `WIFI FORGOTTEN`), or type `wifi reset`. The WiFi name and password are forgotten (the API address and token stay) and the hotspot opens.
- Anything else: type `setup` on the serial console. The hotspot opens and nothing is forgotten; it closes by itself after 10 minutes if nothing is saved and the station is online.
- The hotspot also opens by itself after 2 minutes of failing to join the saved WiFi (the station keeps retrying meanwhile), and when the server refuses the token (`TOKEN REFUSED`), so a new token can be entered without a cable.
- `factory reset` erases **everything** saved: the WiFi, API address and token **and the load-cell and pH calibration** (the whole NVS partition), then restarts into setup. Use `wifi reset` if you only want the network changed.

BOOT is also the button that puts the ESP32 into flashing mode when held while powering on or pressing EN; the 5 s hold only counts while the firmware is running.

### Testing against a laptop instead of Render

Run the API on the laptop so the ESP32 can reach it over the LAN:

```bash
cd website/backend
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Then flash the `esp32dev-lan` environment and enter `http://<laptop-LAN-IP>:8000/api/v1` on the setup page. It is the only build that accepts a plain `http://` API address:

```bash
pio run -e esp32dev-lan -t upload
```

To try the session timeout quickly, set `LIVE_SESSION_MINUTES=2` and `DEVICE_BOOT_SESSION_MINUTES=1` in `website/backend/.env`.

## Serial console

Open the monitor at 115200 baud and type `help`.

| Command | Does |
|---|---|
| `status` | Sensors, WiFi, session, upload counts, calibration |
| `tare` | Zero the load cell (bin empty) |
| `cal <grams>` | Calibrate the load cell with a known weight on it, e.g. `cal 500` |
| `ph cal <pH>` | Record a pH buffer point. Do it twice, e.g. `ph cal 7.00`, then `ph cal 4.01` |
| `ph reset` | Back to the default pH calibration |
| `cal reset` | Forget all saved calibration |
| `session` | Ask the API for a short live session; counts against the daily limit |
| `setup` | Open the setup hotspot (nothing is forgotten) |
| `wifi reset` | Forget the WiFi name and password and open the hotspot |
| `factory reset` | Erase all saved settings **and calibration**, then restart |

Calibration is saved in flash (NVS), so it survives reboots and reflashing. The values in `include/config.h` are only the defaults.

### Load-cell calibration

1. Empty the bin and run `tare`.
2. Put a known weight in the bin (for example a 500 g pack) and run `cal 500`.
3. Remove it: the LCD should read about 0 g. Put it back: about 500 g.
4. Repeat with the real bin, its liner and a heavier weight if readings drift. A small negative value after tare is shown as 0.

### pH calibration (experimental)

1. Put the probe in pH 7.00 buffer, wait for the reading to settle, then run `ph cal 7.00`.
2. Rinse it, put it in pH 4.01 buffer, wait, then run `ph cal 4.01`.

The pH value is labelled experimental on the LCD, in the API and in the portal. **Never use it alone to decide whether food is safe or spoiled.**

## LCD and lights

The LCD shows one home screen all the time:
- line 1: temperature and humidity (`T:30.5C  H:58%`)
- line 2: the connection (`ONLINE`, `ONLINE - LIVE`, `CONNECTING...`, `WIFI OFFLINE`, `SERVER OFFLINE`, `TOKEN REFUSED`, `NOT SET UP`, `CAN'T JOIN WIFI`)

The screen rotates every 3 s, so nothing critical is hidden: the home screen is always one of the pages, and these are added while they apply:
- setup hotspot open: the hotspot name, its password, and `OPEN IN BROWSER: 192.168.4.1`
- joining the WiFi: `CONNECTING TO:` and the network name
- bin nearly full: `BIN NEARLY FULL` and the weight

When a card is tapped, the screen shows the card's ID and then the holder's name for about 3.5 s (or `UNKNOWN CARD`, `CARD REVOKED`, `ACCOUNT INACTIVE`, `NOT CHECKED:OFFL`), then returns to the home screen. Cards are checked by the server only; there is no local list of allowed cards.

The bin weight (except the warning above) and pH aren't on the LCD. They're in the serial `status` output and on the portal's Waste and pH pages.

| Lights | Meaning |
|---|---|
| Green blink every 3 s | Live, uploading |
| Both off | Paused |
| Red blink every 2 s | Token refused |
| Green and red take turns about once a second | Setup hotspot open |
| Red blinks twice a second, with one short beep when it starts | Bin nearly full |
| Green + one beep | Card granted |
| Red + two beeps | Card denied |
| Red, no beep | Offline or server error |

## Bin nearly full

The station warns locally when the waste bin is nearly full, with no network and no live session needed:
- the filtered weight stays at or above **2.0 kg** for 5 s: `BIN NEARLY FULL` joins the LCD pages, the red LED blinks, and the buzzer sounds once (at most once per 10 minutes);
- it clears when the weight stays below **1.5 kg** for 5 s (so it doesn't flicker around the threshold);
- readings are ignored while the load cell isn't answering (no recent HX711 sample), so a fault neither raises nor clears the warning.

The thresholds are in `include/config.h` (`kBinFullGrams`, `kBinClearGrams`). The weight needs calibrating against the real bin first (below); until then the warning is only as good as the calibration. This is a local reminder, not a safety system.

## Tests

The hardware-independent logic in `lib/ecopantry_core` runs on your computer with no board:
- pH maths and two-point calibration
- card UID formatting
- reading checks and the upload JSON
- the ring buffer and moving average
- the live-session state machine and backoff
- the setup form (decoding, validation, merging with saved settings), the hotspot name and password, the WiFi/hotspot state machine and the BOOT-hold detector
- the bin-nearly-full alert (rising edge, hysteresis, sensor fault)

```bash
pio test -e native
```

## Code layout

```
include/config.h              pins, timings, calibration defaults
include/ca_certs.h            root certificates for HTTPS (Google Trust Services, Let's Encrypt)
lib/ecopantry_core/           pure C++ logic, unit-tested natively
src/main.cpp                  sensors, LCD, card reader, serial console (core 1, never blocks on the network)
src/net/uplink.cpp            WiFi, API and the setup hotspot on a FreeRTOS task (core 0)
src/net/setup_portal.cpp      hotspot access point, captive DNS and the setup page
src/sensors/                  DHT11, HX711, pH probe
src/ui/                       LCD, LEDs and buzzer
src/storage/calibration.cpp   calibration in NVS
src/storage/settings.cpp      WiFi, API address and token in NVS (own namespace)
test/test_core/               Unity tests: sensors maths, readings, live session
test/test_setup/              Unity tests: setup form, hotspot, WiFi state machine
test/test_bin_alert/          Unity tests: bin-nearly-full alert
```

## Troubleshooting

| Symptom | Check |
|---|---|
| `NOT SET UP` / the hotspot name on the LCD | Nothing is saved yet: follow step 3 above |
| Can't see the `EcoPantry-XXXX` WiFi | Wait a few seconds; use the password from the LCD (letters are lowercase, no `0/o/1/l/i`) |
| `CAN'T JOIN WIFI` or `WIFI OFFLINE` | 2.4 GHz network? Password exact? Correct it on the hotspot page; the station retries every 30 s |
| `[api] POST ... -> -1` | TLS or connection failure. Is the URL right, and does the host chain to a root in `ca_certs.h` (`openssl s_client -connect host:443 -showcerts`)? |
| The first request takes up to a minute | Render's free tier is waking up. The station waits up to 15 s per try and retries. |
| `TOKEN REFUSED` | The token was rotated or the device disabled. Join the hotspot that opened and paste the current token (or `setup` over serial) |
| Bin weight `SENSOR ERROR` | HX711 not detected at boot: check DT=32, SCK=33, power. |
| `DHT11 ERROR` | Data pin 15, pull-up, power. |
