# Hardware integration: sensor station, API and portal

How the single-ESP32 inventory station reaches the portal, and how it avoids keeping the free-tier hosting awake.

- Wiring: [hardware/inventory-station/README.md](../hardware/inventory-station/README.md)
- Firmware: [software/firmware/inventory-esp32/README.md](../software/firmware/inventory-esp32/README.md)

## Data path

```
ESP32 station ──HTTPS + Bearer device token──▶ FastAPI (Render) ──▶ PostgreSQL (Neon)
                                                     ▲
Portal (Firebase Hosting) ──HTTPS + CORS, staff session─┘   polls every 2 s while a page is open
```

- **The station never connects to the database.** The Neon URL is a backend secret only (`DATABASE_URL` on Render). It must never appear in firmware, `secrets.h` or committed files.
- **The station calls Render directly** (`https://ecopantry-api.onrender.com/api/v1`), not through the website. It is not a browser, so it needs no CORS and no cookies.
- **Real time in the portal is polling**, not websockets or server-sent events. TanStack Query refetches every 2 s and stops while the tab is hidden. Render's free tier doesn't hold long-lived streams reliably, and readings only arrive every 3 s anyway.

## Entering the WiFi and API details (setup hotspot): planned, not built

Today the WiFi details, API address and device token are compiled in from the git-ignored `include/secrets.h` (see the firmware README). The setup hotspot below is the agreed design that will replace it. **None of it is in the firmware yet.**

The WiFi name and password, the API address and the device token are **not compiled into the firmware**. They are entered on a setup page that the station serves from its own hotspot, and saved in the board's flash (NVS). Nothing secret is kept in a file or in Git, one firmware build works for any network, and moving between a laptop and Render needs no reflash.

```
Power on ─► details saved? ──no──► SETUP: hotspot "EcoPantry-A1B2" + page at 192.168.4.1
                │ yes                       ▲  password shown on the LCD and serial monitor
                ▼                           │
          join the saved WiFi ─ fails 2 min ┘ (opens the hotspot too, keeps retrying)
                │ ok
                ▼
          ONLINE ─► hotspot off ─► boot session ─► uploads (live sessions, below)
```

- **The hotspot** is WPA2 with a random 8-character password per setup, shown only on the LCD and the serial monitor, so only someone at the station can join. It allows at most 2 clients.
- **The page** is served only to clients on the hotspot's own subnet, so someone on the normal WiFi can't reach it while it is open. It lists nearby 2.4 GHz networks, accepts a typed name for hidden ones, and checks every field (WiFi password 8–63 characters or empty, API address `https://…/api/v1`, token `epd_…`). `http://` is accepted only by the `esp32dev-lan` build. Leaving the token empty keeps the saved one.
- **Saving** writes the details to flash and tries them straight away. If they fail (wrong password, network off) the hotspot stays open, the details stay saved, and the station retries every 30 s, so a network that appears later is joined automatically. The phone may lose the hotspot when the station moves to the router's radio channel; the LCD shows `CONNECTING TO:` and then `ONLINE`.
- **Uploads pause** while the hotspot is open and resume once the station is online and the hotspot has closed. The live-session rules below are unchanged.
- **Opening setup again:** hold the BOOT button for 5 s (clears the WiFi), or `setup` / `wifi reset` / `factory reset` over serial. It also opens by itself after 2 minutes of failing to join the saved network, and when the server refuses the device token (`TOKEN REFUSED`), so a new token can be entered without a cable.
- **Stored in plain NVS.** The WiFi password and token are not encrypted in flash: anyone with the board and a USB cable can read them, as they could when they were compiled in. Neither is ever printed to the serial monitor or sent back to the page.
- **Not supported:** 5 GHz networks, and networks that need a login page (school, hotel, some office WiFi).

## Device authentication

- Each station has its own token, `epd_` followed by 43 random characters.
- Only the token's SHA-256 is stored (`devices.token_hash`), so a copy of the database can't be used to post readings.
- The token is shown once: on the portal's admin **Devices** page, or by `python -m app.cli create-device`.
- **Rotating the token** (portal or `rotate-device-token`) invalidates the old one at once and ends any live session.
- **Disabling the device** refuses everything from it.
- Device routes (`/api/v1/device/*`) accept only `Authorization: Bearer epd_...`. They ignore staff cookies and need no CSRF token. Staff routes ignore device tokens. `tests/test_devices.py` checks both directions.
- The station reports its firmware version in `X-Device-Firmware`. Every request updates `last_seen_at`.

## Live sessions (the upload cut-off)

**Why:**
- Render's free web service sleeps after 15 idle minutes.
- Neon's free plan includes 100 compute-hours a month and suspends after 5 idle minutes.
- A station posting every 10 s, all day, would keep both awake permanently: about 180 compute-hours a month at Neon's smallest size.

**How:** the station may upload only during a live session, `devices.live_until` in the future. Outside a session it sends nothing at all, so both services can sleep.

| Event | Endpoint | Effect |
|---|---|---|
| Station powers on | `POST /device/session` | Opens a session of `DEVICE_BOOT_SESSION_MINUTES` (5), unless already live for longer. A reboot never extends a session. |
| Authorised card tapped | `POST /device/rfid-scans` | Opens the session, or extends it to `now + LIVE_SESSION_MINUTES` (15). Taps don't stack. |
| While live | `POST /device/readings` every `DEVICE_REPORT_INTERVAL_SECONDS` (3) | Stored, answered 201 with the time left |
| Outside a session | `POST /device/readings` | **409 `session_not_live`**, nothing stored; the station pauses |
| Too fast | `POST /device/readings` within `DEVICE_MIN_REPORT_INTERVAL_SECONDS` (2) | **429 `upload_too_soon`** with `Retry-After` |
| Administrator clicks Stop | `POST /devices/{id}/stop-live` | Session ends now; the station pauses on its next upload |

**Three layers, each enough on its own:**
1. **The firmware's own timer.** It also has a 60-minute cap.
2. **The backend refusing uploads.** Firmware that ignores its timer still can't write.
3. **A per-device daily budget**, `DEVICE_DAILY_LIVE_MINUTES` (240), kept in `device_live_usage`.
   - Every second of session time granted counts against it.
   - Once it's used up, card taps are still checked and recorded, but the session isn't extended. The response says `budget_exhausted: true`, and the LCD shows `DAILY LIMIT HIT`.

**Cost:** a 15-minute session plus Neon's 5-minute idle tail is about 20 minutes of compute. The 240-minute daily cap keeps even a heavily used station inside the free tier.

A 401 puts the station in `LOCKED`, and it makes no further requests until it is rebooted. A 5xx or timeout is retried with exponential backoff (5 s doubling to 60 s), and the backoff time counts toward the session.

## What is stored

| Table | Contents |
|---|---|
| `devices` | Name, status, token hash and prefix, firmware version, last seen, live session (`live_until`, who started it) |
| `device_live_usage` | Live seconds granted per device per UTC day |
| `sensor_readings` | `recorded_at` (server clock, derived from the station's uptime offsets so a backlog keeps its timing), temperature, humidity, bin weight, pH and probe voltage, and `dht_ok` / `load_cell_ok` |
| `rfid_cards` | Card UID (`AA:BB:CC:DD`), employee, assigned/revoked. One holder at a time; revoked cards keep their row. |
| `rfid_scans` | Every tap: device, UID, matched card and employee, result (`granted`, `unknown_card`, `card_revoked`, `employee_inactive`) |

Details of `sensor_readings`:
- A failed sensor is stored as NULL, never as a repeated old value.
- Values outside the sensors' physical range are rejected by CHECK constraints and API validation. The firmware sends them as null so one bad value doesn't sink a batch.
- A station buffers up to about 10 minutes of readings when the network drops, and uploads them as one batch of up to 50. Samples more than an hour old are dropped.

Readings and scans are not written to the audit log (too many). These are audited:
- device registration, token rotation, disable/enable and stop-live
- card assignment and revocation
- each live session start (`device.live_session_started`, actor type `device`)

## Portal API (staff session)

| Endpoint | Permission |
|---|---|
| `GET /sensors/stations`: every station, live state, staleness, latest reading | Each metric needs its own permission and is null without it: temperature/humidity `environment.view`, bin weight `waste.view`, pH `ph.view` |
| `GET /sensors/stations/{id}/history?metric=&range=1h\|6h\|24h\|7d` | Same per-metric permission. Bucketed avg/min/max (10 s, 1 min, 5 min, 30 min buckets). |
| `GET/POST /devices`, `POST /devices/{id}/rotate-token\|disable\|enable\|stop-live` | `devices.view` / `devices.manage` (administrators) |
| `GET/POST /rfid/cards`, `POST /rfid/cards/{id}/revoke`, `GET /rfid/scans` | `employees.view` / `employees.manage` |

A station is **stale** when its latest reading is older than three report intervals (30 s). The portal shows a paused station as "paused", not as an error.

## pH

Experimental everywhere: on the LCD, in the API (`ph_value` field description) and in the portal. It is never used alone to decide whether food is safe or spoiled. EcoPantry is a prototype, not a certified food-safety system.

## Thresholds and alerts

The backend evaluates thresholds on readings (`app/services/alerts.py`), inside the same transaction as `POST /device/readings`, so only during a live session. Only the newest reading of an upload is evaluated. A threshold watches one metric (`temperature_c`, `humidity_pct`, `weight_g`) with exactly one limit (max or min), an optional `clear_value` (hysteresis), a severity, and one station or all.

- A value at or beyond the limit opens one alert per (threshold, station); further readings update its `last_value`.
- A missing value (failed sensor, stored as NULL) never opens or resolves anything.
- The alert resolves when the value passes `clear_value` (strictly). Between the limit and `clear_value` it stays.
- Acknowledging (storekeeper, administrator) records who and when; the alert stays unresolved until the reading recovers.
- Opening and resolving are audited with actor type `device` (`alert.opened`, `alert.resolved`); acknowledging and threshold changes are audited with the employee.

The seeded threshold is "Waste bin nearly full": `weight_g` at or above 2000 g, clears below 1500 g, all stations (values are in grams; the portal shows kg). Alerts are portal-only: no email or SMS.

| Endpoint | Permission |
|---|---|
| `GET /alerts?status=open\|acknowledged\|resolved\|active&device_id=&metric=` (paginated, newest first), `GET /alerts/summary` | `alerts.view` (every role) |
| `POST /alerts/{id}/acknowledge` | `alerts.acknowledge` (administrator, storekeeper) |
| `GET /thresholds` | `alerts.view` |
| `POST /thresholds`, `PATCH /thresholds/{id}`, `POST /thresholds/{id}/enable\|disable` | `thresholds.manage` (administrator) |

## Not built yet

- **The setup hotspot** described above.
- **A local warning on the station** for the bin alert (LCD and LED/buzzer, even when not live). The backend side is built: see "Thresholds and alerts" below.
- **Waste records and pH records** (M10, M11).

Dropped from the project (2026-11-09): the HC-SR04 ultrasonic fill-level sensor and the ESP32-CAM. The bin's fullness comes from its weight alone.
