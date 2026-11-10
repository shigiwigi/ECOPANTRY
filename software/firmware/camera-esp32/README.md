# EcoPantry camera (AI Thinker ESP32-CAM)

Live view for the portal's **Camera** page. It also serves a local MJPEG stream at `http://<camera-ip>:81/stream`.

## How it reaches the hosted site

The camera is on the shop's WiFi, so the hosted API can't reach it. The camera calls the API instead:

1. Every 10 s it asks `GET /api/v1/device/camera/want` whether anyone is watching.
2. While a signed-in staff member has the Camera page open, it pushes a JPEG (about 3 per second) to `POST /api/v1/device/camera/frame`.
3. The API keeps only the latest frame in memory. Nothing is recorded and no database is used.

Auth is one shared secret (`CAMERA_SECRET` here, `CAMERA_DEVICE_SECRET` on the backend), separate from staff sessions and sensor-station tokens. TLS uses `include/ca_certs.h` (copied from the inventory firmware).

Because it checks in every 10 s, the free Render API never sleeps while the camera is on. The database stays asleep.

## Setup

1. `cp include/secrets.h.example include/secrets.h` (git-ignored) and set:
   - `WIFI_SSID`, `WIFI_PASSWORD` (2.4 GHz only)
   - `API_HOST`, the Render host without `https://`
   - `CAMERA_SECRET`, a long random string, for example `python3 -c "import secrets;print(secrets.token_urlsafe(32))"`
2. In the Render dashboard, add `CAMERA_DEVICE_SECRET` with the same value.
3. Flash: ground GPIO0, `pio run -t upload`, remove the jumper, press RESET.
4. Watch the serial monitor: `pio device monitor -b 115200`. It prints `STREAM URL: http://<ip>:81/stream` once on WiFi, and `Relay HTTP <code>` only on errors (401 means the secrets differ).

Changing WiFi: edit `secrets.h` and flash again.

## Hardware notes

- Needs a 5 V supply of at least 2 A. A weak USB-serial adapter gives no output or boot loops.
- The local stream on port 81 has no login: keep the camera on a trusted network. A browser on the HTTPS site may block that `http://` stream (mixed content); the Camera page's hosted view doesn't use it.
- Not a security camera: nothing is stored, and the image is only sent while the page is open.
