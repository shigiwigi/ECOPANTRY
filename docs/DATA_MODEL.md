# Data model

The PostgreSQL schema after migration `0009`. Models are in `website/backend/app/models/`,
migrations in `website/backend/alembic/versions/`. Later tracks (batches, alerts, waste, pH,
enquiries endpoints) build on this document; change it together with the migration.

Scope: inventory is **in-shop only**. There are no suppliers and no `suppliers.*` or
`camera.view` permissions (removed by `0005`). The waste bin's fullness is the load-cell
weight (`sensor_readings.weight_g`), not an ultrasonic distance.

Conventions: UUID primary keys for business records, `BIGINT IDENTITY` for high-volume
append-only logs; `timestamptz` everywhere; quantities are `NUMERIC(12,3)` in the
ingredient's unit; enums are `VARCHAR` + `CHECK ... IN (...)` (easy to extend in a migration);
constraint names follow the metadata naming convention. Business records are never deleted:
they are deactivated, resolved or corrected by new rows. Foreign keys are `ON DELETE RESTRICT`.
Anything audited uses `app.services.audit.record_event` in the same transaction.

## Existing tables (0001-0004)

| Table | Migration | Purpose |
|---|---|---|
| `roles`, `permissions`, `role_permissions` | 0002 | Role-based access, seeded; mirrored in `app/auth/permissions.py` |
| `employees`, `auth_sessions` | 0002 | Staff accounts (never deleted) and hashed-token sessions |
| `audit_events` | 0002 | Append-only audit log (DB trigger) |
| `catalogue_categories`, `catalogue_products` | 0003 | Public finished-product catalogue, separate from inventory |
| `devices`, `device_live_usage` | 0004 | ESP32 stations, bearer tokens, live-session budget |
| `sensor_readings` | 0004 | `temperature_c`, `humidity_pct`, `weight_g`, `ph_value`, `ph_voltage` (all nullable), `recorded_at` |
| `rfid_cards`, `rfid_scans` | 0004 | Cards linked to employees; every tap |

## 0005: inventory reference

**`units`** (`id` smallint identity, `code` unique `^[a-z]{1,8}$`, `name`, `kind` in mass/volume/count).
Seeded: g, kg, ml, l, pcs. Read-only in the API.

**`ingredients`** (`id` uuid, `name` varchar(120), `unit_id` -> units, `reorder_level` numeric >= 0 or NULL,
`notes`, `is_active`, `deactivated_at`, `created_at`, `updated_at`). Unique index on `lower(name)`.
`is_active = (deactivated_at IS NULL)`. Audited as `ingredient`.

**`storage_areas`** (`id` uuid, `name` varchar(80), `kind` in fridge/freezer/shelf/other, `notes`,
`is_active`, `deactivated_at`, timestamps). Unique `lower(name)`. Audited as `storage_area`.

Writes: `app/services/inventory.py` (`create_/update_/set_*_active`) via `/ingredients` and
`/storage-areas`. Permissions `inventory.view` / `inventory.manage`.

## 0006: batches and stock

**`batches`** (`id` uuid, `ingredient_id`, `storage_area_id` nullable, `label_code` unique, 10 chars in the
format of `app/services/batch_labels.py` (`CODE_PATTERN`), `received_on`, `expiry_on` >= `received_on`,
`quantity` > 0, `remaining_quantity` in [0, quantity], `notes`, `created_by_id` -> employees, timestamps).
Indexes: `ix_batches_fefo` (ingredient_id, expiry_on, received_on) and `ix_batches_open_expiry_on`
(expiry_on), both partial `WHERE remaining_quantity > 0`. Status (available / near expiry / expired /
depleted) is derived, never stored. Audited as `batch`.

**`stock_movements`** (`id` bigint identity, `batch_id`, `kind` in/out/adjust, `quantity_delta` signed,
`remaining_after`, `reason`, `employee_id`, `rfid_scan_id` nullable, `created_at`).
Sign convention: `in` > 0, `out` < 0, `adjust` != 0 and requires a reason. Exactly one `in` line per batch
(partial unique index) written together with the batch. `sum(quantity_delta) = batch.remaining_quantity`.
Append-only by trigger: correct mistakes with an `adjust` line.

Intended service functions (not built yet): `receive_batch` (insert batch + `in` movement + label code,
retry on label collision), `consume(batch, qty, ...)` and `adjust(batch, delta, reason)` (lock the batch
`FOR UPDATE`, insert movement, update `remaining_quantity`, one transaction), `fefo_candidates(ingredient)`
(uses `ix_batches_fefo`), `lookup_by_label(code)` (fills the 501 `GET /batches/by-label/{code}`).
Writers: Admin and Storekeeper (`batches.manage`); RFID-attributed via `rfid_scan_id`.

## 0007: thresholds and alerts

**`thresholds`** (`id`, `label`, `metric` in temperature_c/humidity_pct/weight_g, `device_id` nullable =
all stations, `min_value` xor `max_value` (exactly one), `clear_value` hysteresis, `severity`
info/warning/critical, `enabled`, timestamps). `max_value`: alert at value >= max, clears when value <
`clear_value` (<= max). `min_value`: alert at value <= min, clears when value > `clear_value` (>= min).
NULL `clear_value` clears as soon as the value is back inside the limit. pH has no thresholds on purpose.
Seed: "Waste bin nearly full", `weight_g` max 2000 (2.0 kg), clear 1500 (1.5 kg), warning, all stations.
Writer: `thresholds.manage` (Admin).

**`alerts`** (`id`, `threshold_id`, `device_id`, `metric`/`severity`/`message` copied at open,
`status` open/acknowledged/resolved, `trigger_value`, `last_value`, `sensor_reading_id`, `opened_at`,
`acknowledged_at/by_id`, `resolved_at`, `resolved_by_id`). Consistency checks tie status to the timestamps.
Partial unique index `(threshold_id, device_id) WHERE status <> 'resolved'`: at most one unresolved alert.
Writer: the backend, when it ingests a reading (`evaluate_reading(reading)`: open on breach, update
`last_value`, auto-resolve with `resolved_by_id` NULL past `clear_value`); employees acknowledge
(`alerts.acknowledge`). Station-offline alerts are a later extension.

## 0008: waste and pH

**`waste_records`** (`id`, `category` expired/spoiled/damaged/production_offcut/other, `reason`
(required for `other`), `weight_kg` >= 0 or NULL, `batch_id` nullable, `stock_movement_id` nullable
unique (needs a batch), `employee_id`, `rfid_scan_id`, `recorded_at`, `created_at`). When waste comes from
a batch, one service call writes the `out` movement and the record together. Writers: `waste.record`.

**`ph_records`** (`id`, `sample_description`, `batch_id` nullable, `ph_value` numeric(4,2) in [0,14],
`reference_min/max` (both or neither, ordered), `operator_id`, `calibration_note`, `sensor_reading_id`
nullable, `recorded_at`). Experimental: no verdict column exists and none may be added; pH alone never
declares food safe or spoiled. Writers: `ph.record`.

## 0009: enquiries

**`enquiries`** (`id`, `name` <= 120, `email` <= 254, normalised lower-case and format-checked,
`message` 1-5000 chars, `created_at`, `read_at`, `handled_at`, `handled_by_id`). The only table the
public can write (future `POST /public/enquiries`, rate-limited, no IP or user agent stored).
Read by `enquiries.view` (Administrator only). **Retention: 12 months** from `created_at`, then deleted by a
scheduled job (to build) - the one exception to "never delete", because it is personal data.

## Permissions changed

- Removed (0005): `suppliers.view`, `suppliers.manage`, `camera.view`.
- Added (0009): `enquiries.view`, Administrator only.

## Conventions shared by list endpoints

`app/api/v1/pagination.py`: `limit` (1-200, default 50), `offset`, whitelisted `sort` (`-` prefix for
descending, stable tiebreaker), optional filters, `q` search; response `Page[T]` =
`{items, total, limit, offset}`.
