# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

The repository is only a scaffold: every source directory contains a `.gitkeep` and nothing else. There is no build, lint, or test tooling yet, so no commands exist to document. `docs/PROJECT_STATUS.md` is the checklist of what is implemented; update it as work lands. Do not describe planned features as working until they are implemented and tested (the README is explicit about this).

When adding a component, give it its own dependency file and setup instructions (README expects this), plus a `.env.example` with placeholders only.

## Planned architecture

EcoPantry is a bakery inventory / food-quality / waste-management prototype with three kinds of clients around one backend:

- **Backend** (`website/backend/`): Python, FastAPI, Pydantic, SQLAlchemy + Alembic, PostgreSQL. It is the only thing that touches the database and it enforces role-based access (Administrator, Storekeeper, Inspector).
- **Frontend** (`website/frontend/`): React + TypeScript + Vite, Tailwind/shadcn/ui, React Router, TanStack Query, React Hook Form + Zod, Recharts. It contains two apps: a public customer site (no login) and the internal management portal.
- **Firmware** (`software/firmware/{inventory-esp32,waste-bin-esp32,esp32-cam}/`): PlatformIO, Arduino framework, C++. Hardware docs go in `hardware/`; code shared across components in `software/shared/`; tests in `tests/`.

Constraints that cut across several of these directories:

- ESP32s talk to the backend over HTTP + JSON with authenticated device endpoints. They must never connect to the database directly.
- The ESP32-CAM MJPEG stream is independent of the sensor API (separate route/network); the portal just embeds it for authorized users.
- The public finished-product catalogue is separate from internal raw-ingredient inventory. Public endpoints must expose only explicitly public catalogue/bakery data, never stock quantities, batches, suppliers, employees, sensor readings, waste or compliance records.
- Core domain concepts: batch-level inventory with QR labels, expiry tracking with FEFO recommendations, threshold-based alerts evaluated by the backend on incoming sensor readings, RFID-linked employee operations, audit logs.

## Hardware cautions to preserve in code and docs

- MFRC522 runs at 3.3 V.
- HC-SR04 ECHO is 5 V; level-shift or divide before an ESP32 GPIO.
- pH board analog output must not exceed the ESP32 ADC limit.
- DHT sensor model is still unconfirmed; don't pick a library or state accuracy until it is.
- Load cell and ultrasonic fill-level need calibration against the actual bin.
- pH is experimental and must never be used alone to declare food safe or spoiled; the project is not a certified food-safety system.

## Workflow

Per CONTRIBUTING.md: one module or phase per branch (`feature/...`, `fix/...`, `docs/...`), never commit `.env` files or credentials, and update docs when APIs, wiring, or setup change. Technology choices change only through documented project decisions. Work is organized in phases 0-13 (see README); a phase is complete only after testing.

Development happens on the `development` branch; `main` is the main branch.
