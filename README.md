# EcoPantry
### Smart Bakery Inventory, Food Quality Monitoring & Waste Management System

EcoPantry is an IoT-enabled bakery management prototype designed to help manage raw ingredient inventory, monitor storage conditions, track expiry dates, record food waste, and maintain digital operational records.

The project combines a web application, backend API, database, and ESP32-based hardware units.

> **Project status:** In development. Features should only be described as operational after they have been implemented and tested with the actual hardware.

## Contents

- [Project objectives](#project-objectives)
- [System architecture](#system-architecture)
- [Main features](#main-features)
- [Hardware](#hardware)
- [Software stack](#software-stack)
- [Repository structure](#repository-structure)
- [Data flow](#data-flow)
- [Development phases](#development-phases)
- [Getting started](#getting-started)
- [Hardware and safety notes](#hardware-and-safety-notes)
- [Contributing](#contributing)
- [Project limitations](#project-limitations)

## Project objectives

1. Maintain ingredient and batch-level inventory records.
2. Generate QR labels to identify ingredient batches.
3. Track expiry dates and support First Expired, First Out (FEFO) recommendations.
4. Monitor temperature and humidity using an ESP32.
5. associate employee operations with RFID card records.
6. Record experimental pH measurements for selected food samples.
7. Measure smart-bin waste weight and fill level.
8. Provide an authorized live view from an ESP32-CAM.
9. Generate alerts, reports, and audit records.
10. Provide a public customer-facing website that can be browsed without signing in.

## System architecture

```text
                    PUBLIC CUSTOMERS
                           |
                           v
                  React Customer Website
                           |
                           v
+------------------+   +--------------------+   +------------------+
| Inventory ESP32  |-->|                    |<--| Waste-bin ESP32  |
| RFID / DHT / pH  |   | FastAPI REST API   |   | Load cell /      |
+------------------+   |                    |   | HX711 / HC-SR04  |
                       +---------+----------+   +------------------+
                                 |
                                 v
                         PostgreSQL Database
                                 |
                                 v
                       React Management Portal

+------------------+
| ESP32-CAM        |---- Independent MJPEG stream
| OV2640           |     (camera route/network)
+------------------+
```

The ESP32 devices communicate with the backend over HTTP using JSON. Microcontrollers must not connect directly to the database.

The ESP32-CAM video stream is independent of the sensor-reading API.

## Main features

### Public customer website
- Browse bakery information and public finished-product catalogue.
- View product descriptions, images, and public prices where configured.
- Search and filter public products.
- Contact/enquiry form.
- No account or login required for public browsing.

### Internal management portal
- Administrator, Storekeeper, and Inspector roles.
- Role-based access enforced by the backend.
- Ingredient and batch management.
- Stock-in, stock-out, and adjustment history.
- QR code generation, printing, and browser-based scanning.
- Expiry monitoring and FEFO recommendations.
- Temperature and humidity monitoring.
- RFID employee identification and activity records.
- Experimental pH measurement records.
- Smart waste-bin weight and fill-level monitoring.
- ESP32-CAM live stream.
- Alerts, compliance-oriented reports, CSV/PDF exports, and audit logs.

### Important separation
The public finished-product catalogue is separate from internal raw ingredient inventory. Customers must not be able to access internal stock quantities, batch details, supplier records, employee information, sensor readings, waste records, or compliance records.

## Hardware

The planned prototype consists of three independent units.

### 1. Inventory monitoring station
- ESP32 DevKit V1
- MFRC522 RFID reader
- DHT temperature/humidity sensor (confirm exact model)
- Analog pH sensor kit
- I2C LCD
- Buzzer and indicator LEDs

### 2. Smart waste bin
- ESP32 controller
- Load cell
- HX711 load-cell amplifier
- HC-SR04 ultrasonic distance sensor

The load cell measures weight. The ultrasonic sensor measures distance to the waste surface and is used to estimate fill percentage after calibration.

### 3. Camera monitoring
- ESP32-CAM AI Thinker
- OV2640 camera
- Independent Wi-Fi connection
- MJPEG stream

See `hardware/` and `software/firmware/` for the intended locations of wiring diagrams, enclosure files, and firmware.

## Software stack

| Layer | Planned technology |
|---|---|
| Frontend | React, TypeScript, Vite |
| Styling | Tailwind CSS, shadcn/ui |
| Icons | Lucide React |
| Charts | Recharts |
| Routing | React Router |
| Data fetching | TanStack Query |
| Forms | React Hook Form, Zod |
| Backend | Python, FastAPI, Pydantic |
| ORM / migrations | SQLAlchemy, Alembic |
| Database | PostgreSQL |
| Firmware | PlatformIO, Arduino framework, C++ |
| Hosting (planned) | Cloudflare Pages, Render, Supabase |

Technology choices may be updated through documented project decisions rather than changed ad hoc.

## Repository structure

```text
ECOPANTRY/
├── README.md
├── .gitignore
├── LICENSE
├── CONTRIBUTING.md
├── website/
│   ├── frontend/
│   └── backend/
├── hardware/
│   ├── inventory-station/
│   ├── smart-waste-bin/
│   ├── esp32-cam/
│   ├── schematics/
│   └── enclosure/
├── software/
│   ├── firmware/
│   │   ├── inventory-esp32/
│   │   ├── waste-bin-esp32/
│   │   └── esp32-cam/
│   └── shared/
├── docs/
│   ├── diagrams/
│   ├── images/
│   └── EcoPantry_Project_Overview.pptx
└── tests/
```

## Data flow

1. An employee identifies themselves using an assigned RFID card where required.
2. A storekeeper scans a batch QR code and selects an operation.
3. The website sends the operation to the backend.
4. The backend validates permissions and updates the database.
5. ESP32 devices send sensor readings to authenticated API endpoints.
6. The backend validates and stores readings and evaluates configured thresholds.
7. The management portal displays stored information and generated alerts.
8. The public customer website only receives explicitly public catalogue and bakery information.

## Development phases

| Phase | Scope |
|---|---|
| 0 | Repository and existing-project audit |
| 1 | Application foundation and shared design system |
| 2 | Authentication and role management |
| 3 | Public customer website |
| 4 | Database and backend APIs |
| 5 | Ingredient inventory and batch management |
| 6 | QR code and expiry management |
| 7 | Dashboard and analytics |
| 8 | ESP32 environmental monitoring |
| 9 | RFID, employees, and pH records |
| 10 | Smart waste-bin integration |
| 11 | Camera, alerts, and notifications |
| 12 | Compliance, reports, and audit logs |
| 13 | Integration, testing, and deployment |

A phase is complete only after its functionality has been tested. Do not present planned features as completed.

## Getting started

See [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) for what is implemented and tested.

### Clone the repository

```bash
git clone https://github.com/<YOUR-GITHUB-USERNAME>/ECOPANTRY.git
cd ECOPANTRY
```

### Local development environment

Implemented so far: the frontend (`website/frontend/`), the backend foundation
and staff authentication (`website/backend/`, design in
[docs/AUTH_DESIGN.md](docs/AUTH_DESIGN.md)) and a local PostgreSQL container
(`compose.yaml`). The
development setup uses Podman and podman-compose (Fedora); Docker Engine is not
required. Full setup steps are in [website/backend/README.md](website/backend/README.md)
and [website/frontend/README.md](website/frontend/README.md).

Once set up, run each in its own terminal:

```bash
# 1. PostgreSQL (repository root)
podman-compose up -d
podman-compose ps                       # wait for "healthy"

# 2. FastAPI on http://127.0.0.1:8000 (website/backend)
.venv/bin/alembic upgrade head
.venv/bin/python -m app.cli create-admin --email you@example.com --name "Your Name"   # once; prompts for a password
.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# 3. Website and portal on http://localhost:5173 (website/frontend)
npm run dev                             # proxies /api/v1 to FastAPI
```

Stop PostgreSQL with `podman-compose stop`. The data stays in the
`ecopantry_pgdata` volume; `podman-compose down -v` would delete it.

Firmware: open the relevant firmware directory in PlatformIO (not started yet).

Each application component includes its own setup instructions and dependency files.

### Environment variables

Create local `.env` files for secrets and local configuration. Do not commit real credentials.

Examples of configuration categories:
- Database connection string.
- Backend API base URL.
- Session or token signing secret.
- Device API credentials.
- Public frontend URL.

Use `.env.example` files containing placeholder values only. Current ones:
`.env.example` (PostgreSQL container), `website/backend/.env.example` and
`website/frontend/.env.example`.

## Hardware and safety notes

- Verify the exact DHT sensor model before selecting firmware libraries and accuracy claims.
- Power the MFRC522 from 3.3 V.
- Ensure the pH interface board's analog output cannot exceed the ESP32 ADC input limit.
- The HC-SR04 ECHO output is typically 5 V; use a suitable voltage divider or level shifter before an ESP32 GPIO.
- Calibrate the load cell and ultrasonic fill-level measurement using the actual bin.
- Use a stable, appropriately rated supply for servos or other high-current loads; keep power and signal grounds correctly designed.
- Keep liquid samples away from exposed electronics.
- Do not use pH alone to declare food safe or spoiled.
- Keep mains-voltage wiring out of the low-voltage prototype enclosure unless properly designed and supervised.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

Before submitting changes:
1. Keep modules separated.
2. Follow the existing design system.
3. Do not commit secrets, credentials, or private customer data.
4. Test affected functionality.
5. Update documentation when APIs, wiring, or setup steps change.

## Project limitations

EcoPantry is a prototype and record-management system. It is not an officially certified food-safety system and does not establish food safety solely from pH, temperature, or expiry information. Sensor readings and alerts depend on correct hardware installation, calibration, and operating procedures.

## License

See [LICENSE](LICENSE). Confirm the intended license with the project owners before public release.
