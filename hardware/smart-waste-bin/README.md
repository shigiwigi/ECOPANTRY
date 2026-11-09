# Smart waste bin

The waste bin has **no controller of its own**. Its load cell and HX711 are wired to the inventory station's ESP32 (DT on GPIO 32, SCK on GPIO 33). The station uploads the bin weight with its other readings, and the portal's Waste page shows it. Wiring and calibration: [../inventory-station/README.md](../inventory-station/README.md).

Fullness comes from weight alone. At about **2 kg** the bin counts as nearly full.

Not built yet:
- **The "nearly full" alert**: a portal alert at 2 kg (clears below 1.5 kg) and a local LCD and LED/buzzer warning on the station (roadmap M9/M11).
- **Waste records** (category, reason, employee) in the portal (roadmap M11).

Dropped (2026-11-09): the HC-SR04 ultrasonic fill-level sensor and a separate waste-bin ESP32.
