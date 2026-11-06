# Inventory station firmware (ESP32)

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
| The token is refused (401) | `DEVICE LOCKED`; no more requests until the station is rebooted |

The backend owns all of these lengths (`LIVE_SESSION_MINUTES`, `DEVICE_BOOT_SESSION_MINUTES`, `DEVICE_DAILY_LIVE_MINUTES`, `DEVICE_REPORT_INTERVAL_SECONDS` in `website/backend/.env`). The station also caps any one session at 60 minutes locally.

## Setup

You need [PlatformIO](https://platformio.org/) (the VS Code extension or the `pio` CLI).

1. **Register the station** to get its token. Either an administrator does it on the portal's **Devices** page, or from `website/backend/`:

   ```bash
   .venv/bin/python -m app.cli create-device --name "Inventory station 1"
   ```

   The token (`epd_...`) is shown **once**.

2. **Create the secrets file.** It is git-ignored; never commit it.

   ```bash
   cp include/secrets.example.h include/secrets.h
   ```

   Fill in the 2.4 GHz WiFi name and password, the device token, and `API_BASE_URL`:
   - production: `https://<your-render-service>.onrender.com/api/v1` (Render directly, not the Vercel site)
   - a laptop on the same WiFi: `http://<laptop-LAN-IP>:8000/api/v1`, built with the `esp32dev-lan` environment (see below)

   The build stops with a clear message if `include/secrets.h` is missing.

3. **Build, flash and watch:**

   ```bash
   pio run -e esp32dev -t upload
   pio device monitor -e esp32dev
   ```

   Keep the bin empty while the station starts: it tares the load cell at boot.

### Testing against a laptop instead of Render

Run the API on the laptop so the ESP32 can reach it over the LAN:

```bash
cd website/backend
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Then flash the `esp32dev-lan` environment. It is the only build that accepts a plain `http://` API URL:

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

The LCD rotates through four pages every 2.5 s:
- temperature and humidity
- waste-bin weight
- pH (experimental)
- live status

A card tap shows `CHECKING CARD` and then the result. The result can be `ACCESS GRANTED` with the holder's name, or `ACCESS DENIED` with a reason (`UNKNOWN CARD`, `CARD REVOKED`, `ACCOUNT INACTIVE`). When the server can't be reached it shows `OFFLINE` / `CARD NOT CHECKED`. Cards are checked by the server only; there is no local list of allowed cards.

| Lights | Meaning |
|---|---|
| Green blink every 3 s | Live, uploading |
| Both off | Paused |
| Red blink every 2 s | Locked (token refused) or configuration error |
| Green + one beep | Card granted |
| Red + two beeps | Card denied |
| Red, no beep | Offline or server error |

## Tests

The hardware-independent logic in `lib/ecopantry_core` runs on your computer with no board:
- pH maths and two-point calibration
- card UID formatting
- reading checks and the upload JSON
- the ring buffer and moving average
- the live-session state machine and backoff

```bash
pio test -e native
```

## Code layout

```
include/config.h              pins, timings, calibration defaults
include/secrets.example.h     copy to secrets.h (git-ignored)
include/ca_certs.h            root certificates for HTTPS (Google Trust Services, Let's Encrypt)
lib/ecopantry_core/           pure C++ logic, unit-tested natively
src/main.cpp                  sensors, LCD, card reader, serial console (core 1, never blocks on the network)
src/net/uplink.cpp            WiFi + API on a FreeRTOS task (core 0)
src/sensors/                  DHT11, HX711, pH probe
src/ui/                       LCD, LEDs and buzzer
src/storage/calibration.cpp   calibration in NVS
test/test_core/               Unity tests for lib/ecopantry_core
```

## Troubleshooting

| Symptom | Check |
|---|---|
| `CONFIG ERROR` on the LCD | `status` on the serial console says what is wrong in `secrets.h` |
| `WIFI OFFLINE` | 2.4 GHz network? SSID and password exact? |
| `[api] POST ... -> -1` | TLS or connection failure. Is the URL right, and does the host chain to a root in `ca_certs.h` (`openssl s_client -connect host:443 -showcerts`)? |
| The first request takes up to a minute | Render's free tier is waking up. The station waits up to 15 s per try and retries. |
| `DEVICE LOCKED` | The token was rotated or the device disabled. Put the current token in `secrets.h`, reflash or reboot. |
| Bin weight `SENSOR ERROR` | HX711 not detected at boot: check DT=32, SCK=33, power. |
| `DHT11 ERROR` | Data pin 15, pull-up, power. |
