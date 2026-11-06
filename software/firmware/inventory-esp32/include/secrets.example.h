// Copy to include/secrets.h (git-ignored) and fill in. Never commit real values.
#pragma once

// 2.4 GHz WiFi (the ESP32 has no 5 GHz radio).
#define WIFI_SSID "replace-with-wifi-name"
#define WIFI_PASSWORD "replace-with-wifi-password"

// The API the station talks to, ending in /api/v1, no trailing slash.
//   Production: https://<your-render-service>.onrender.com/api/v1  (Render directly, not Vercel)
//   Laptop on the LAN: http://192.168.x.y:8000/api/v1  (build with `pio run -e esp32dev-lan`)
// Never put a database URL here: the station only ever talks to the API.
#define API_BASE_URL "https://replace-with-your-service.onrender.com/api/v1"

// Shown once when the device is registered (portal Devices page, or
// `python -m app.cli create-device --name "..."`). Starts with epd_.
#define DEVICE_TOKEN "epd_replace-with-the-device-token"
