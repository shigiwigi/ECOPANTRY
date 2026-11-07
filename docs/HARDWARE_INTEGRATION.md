# Hardware integration: sensor station, API and portal

How the single-ESP32 inventory station reaches the portal, and how it avoids keeping the free-tier hosting awake.

- Wiring: [hardware/inventory-station/README.md](../hardware/inventory-station/README.md)
- Firmware: [software/firmware/inventory-esp32/README.md](../software/firmware/inventory-esp32/README.md)

## Data path

```
ESP32 station ──HTTPS + Bearer device token──▶ FastAPI (Render) ──▶ PostgreSQL (Neon)
                                                     ▲
Portal (Vercel) ──same-origin /api/v1, staff session─┘   polls every 2 s while a page is open
```

- **The station never connects to the database.** The Neon URL is a backend secret only (`DATABASE_URL` on Render). It must never appear in firmware, `secrets.h` or committed files.
- **The station calls Render directly** (`https://<service>.onrender.com/api/v1`), not through Vercel. It is not a browser, so it needs no CORS and no cookies.
- **Real time in the portal is polling**, not websockets or server-sent events. TanStack Query refetches every 2 s and stops while the tab is hidden. Vercel rewrites and Render's free tier don't hold long-lived streams reliably, and readings only arrive every 3 s anyway.

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

## Not built yet

- **Thresholds and alerts on readings** (roadmap M9 criterion 2, M12).
- **HC-SR04 fill level** and waste records (M11).
- **ESP32-CAM** (M12).
