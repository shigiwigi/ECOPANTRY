# Smart waste bin

In the current prototype the waste bin has **no controller of its own**. Its load cell and HX711 are wired to the inventory station's ESP32 (DT on GPIO 32, SCK on GPIO 33). The station uploads the bin weight with its other readings, and the portal's Waste page shows it. Wiring and calibration: [../inventory-station/README.md](../inventory-station/README.md).

Not built yet:
- **HC-SR04 fill-level sensor.**
  - Its ECHO pin is 5 V. Use a divider or level shifter before any ESP32 GPIO.
  - The fill percentage needs calibrating against the actual bin, empty and full.
- **Waste records** (category, reason, employee) in the portal (roadmap M11).
- **A separate waste-bin ESP32** (`software/firmware/waste-bin-esp32/`), if the bin moves away from the station.
