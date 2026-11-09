# QR labels and scanning

Status 2026-11-09: label generation, printing, camera scanning, manual entry
and **batch lookup** work (inventory module, M6). Labels are made from batch
records (Labels page picker, or "Print label" in a batch's detail), and a scan
opens the batch in the Batches page. Scanning never creates or changes
inventory data; only the consume and adjust endpoints change stock.

## What a label carries

A label's QR code holds exactly:

```text
ECOPANTRY:BATCH:<code>
```

- `<code>` is 10 characters of Crockford base32: `0-9` and `A-Z` without
  `I`, `L`, `O`, `U`. Example: `K7M2Q9X4TR`, printed as `K7M2Q-9X4TR`.
- The code is an opaque, random reference to one batch. It isn't the database
  id and isn't sequential, so it reveals nothing about how many batches exist.
- No stock quantities, suppliers, employees, permissions, sessions, tokens or
  URLs. Everything else is fetched from the backend after scanning, behind the
  signed-in account's permissions.
- Every character is in the QR alphanumeric set, so the code fits a version 2
  symbol (25 × 25 modules) at error-correction level Q (about 25% damage
  tolerance).

Why not a URL: the production address isn't decided yet (roadmap D3/D4), and
a label printed with a URL breaks if the address changes. A phone's own
camera app therefore won't open the portal from a label; staff scan from the
portal's QR scanner page.

Shared rules: `website/backend/app/services/batch_labels.py` and
`website/frontend/src/features/qr/batch-label.ts`. Both are tested against
the same examples.

Reading rules:

- Scanned text must match the format exactly (case and surrounding whitespace
  ignored). Any other QR code is reported as "not an EcoPantry batch label",
  never guessed at.
- Typed codes are forgiving the way Crockford base32 intends: case, spaces
  and hyphens are ignored, and `O`, `I`, `L` are read as `0`, `1`, `1`. The
  whole label text can be pasted too.

## Printed label

- 63.5 × 38.1 mm, the size of common 21-per-sheet A4 label paper (3 × 7).
  Printed in a three-column grid with 7 mm page margins, which fits A4 and US
  Letter. Optional dashed cut guides for plain paper.
- QR 30 mm including the four-module quiet zone, about 0.9 mm per module.
- Pure black on white in both themes (`--label-ink`, `--label-paper`).
- Text: "EcoPantry batch", ingredient name, batch code, and the use-by date
  when one is given ("20 Nov 2026", so day and month can't be confused).
- Printing uses the browser's own print dialog. While labels exist on the
  page, the print stylesheet hides everything else (`.print-sheet` in
  `globals.css`), so navigation, header and page never print.

Check that a printed label scans before printing many: printer scaling ("fit
to page") changes the size.

## Who can do what

| | Administrator | Storekeeper | Inspector |
|---|---|---|---|
| QR scanner page, batch lookup (`batches.view`) | yes | yes | yes |
| QR labels page (`qr_labels.manage`) | yes | yes | no |

The backend enforces `batches.view` on the lookup endpoint. Label generation
is done in the browser from what the user types; it reads no server data, so
until batches exist there is nothing on the server for it to protect. The
portal hides the labels page from inspectors (UX only). When labels are
generated from batch records (below), that endpoint must require
`qr_labels.manage`.

Camera permission is a browser permission for the camera only. It grants no
EcoPantry access: lookups still need a session and the right permission.

## Endpoint

`GET /api/v1/batches/by-label/{code}`, session required, `batches.view`.

| Answer | When |
|---|---|
| `401 not_authenticated` / `session_*` | No session, expired, or ended |
| `403 forbidden` | Role lacks `batches.view` |
| `422 validation_error` | `code` isn't in the format above |
| `404 batch_not_found` | Valid code, but no batch has it |
| `200` | The batch (shape below) |

GET only, so no CSRF token. The code is never echoed back in errors.

## Lookup response (implemented in M6)

1. `batches.label_code`: `CHAR(10)`, unique, not null, assigned by the
   backend when a batch is created (random from the alphabet above, retried
   on collision). Never reused, never changed.
2. `GET /batches/by-label/{code}` keeps its path, permission and error
   answers, and returns `404 not_found` for an unknown code and otherwise:

   ```json
   {
     "code": "K7M2Q9X4TR",
     "ingredient_name": "Strong white flour",
     "received_on": "2026-10-01",
     "expires_on": "2026-11-20",
     "status": "in_stock",
     "remaining_quantity": "12.500",
     "unit": "kg",
     "storage_location": "Dry store"
   }
   ```

   `status` is `in_stock`, `used_up` or `discarded`. Dates are ISO calendar
   dates; nullable fields may be null. The portal already renders this shape
   (`src/features/qr/batches.ts`, `BatchLookup.tsx`, unit-tested). Lookups
   are reads: no stock change, no audit event.
3. `GET /batches/labels?ids=…` (or a POST with ids), `qr_labels.manage`:
   returns `{code, ingredient_name, expires_on}` per batch so the labels page
   can print from the batch list instead of typed values. Then remove the
   "Test code" button and the "not linked" notice.
4. Optional: record label printing in the audit log
   (`batch.labels_printed`).

## Camera and browsers

- Standard APIs only: `navigator.mediaDevices.getUserMedia` and
  `enumerateDevices`, `navigator.permissions.query` where it exists. Decoding
  is jsQR on canvas frames, the same in every browser (the native
  `BarcodeDetector` is missing from Firefox and most desktop browsers).
- The camera starts only when the user presses Start. It prefers the rear
  camera (`facingMode: ideal environment`) and falls back to any camera, so
  laptops work. Camera names and the camera picker appear only after
  permission is granted, because browsers hide labels (and sometimes devices)
  before that.
- Every track is stopped when the user stops, when a label is read, when the
  page is left or unmounted, when the tab is hidden, and when the camera is
  unplugged. A read stops the camera, so one label is processed once.
- **HTTPS is required.** Browsers allow the camera only on HTTPS or on
  `localhost`. On plain HTTP (for example a phone opening
  `http://192.168.x.x:5173`) the camera API doesn't exist; the page says so
  and offers manual entry. For phone testing during development, set
  `DEV_HTTPS=true` (see `website/frontend/README.md`). Production must be
  served over HTTPS.
- Errors are explained: blocked in site settings, permission prompt dismissed,
  no camera, camera busy (another app), camera disconnected, insecure page,
  unsupported browser. Manual entry is always available.

### Tested (2026-11-02, automated, Linux)

| Browser | How | Result |
|---|---|---|
| Chromium (Playwright, desktop and 375px) | Fake camera playing a video of a label made by our own encoder | Scans, stops the camera, rescans; ignores a non-EcoPantry QR; camera off after Stop and after navigating away; refused permission reported as blocked |
| Firefox (Playwright build) | Firefox's own fake camera stream | Start, stop, restart, camera off after navigating away; all error messages; manual entry; print layout; full smoke, layout and zoom suite |
| Chromium emulating a Pixel 7 | Device emulation (screen, touch, UA) | Full QR, smoke, layout and zoom suites |
| WebKitGTK 2.52 (Epiphany 50, the Safari engine family) | WebDriver, no camera started | Page renders, camera APIs present, `:has()` supported (print CSS), no overflow, manual entry, label preview and print sheet |
| Chromium and Firefox over plain HTTP on a LAN address | | Camera API absent; page shows the HTTPS message |
| Chromium over `DEV_HTTPS` on a LAN address | Certificate accepted | Secure context, camera opens |

### Not tested

No physical device or real camera has been tested. Not tested at all: Google
Chrome and Microsoft Edge on Windows, Safari on macOS, Chrome on a real
Android phone, Safari on a real iPhone or iPad. Playwright's own WebKit build
doesn't start on this Fedora host (missing Ubuntu libraries).

Manual checklist for each of those:

1. Open the portal over HTTPS, sign in, press Scan in the top bar.
2. Start camera: the permission prompt appears; allow. On a phone the rear
   camera opens.
3. Scan a printed label: the camera turns off and the code is shown.
4. Scan any other QR code: "isn't an EcoPantry batch label", camera stays on.
5. Pick another camera (if there are several).
6. Stop camera: the browser's camera indicator goes off. Start again, then
   switch to another tab: the indicator goes off.
7. Block the camera in site settings, press Start: "blocked" message.
8. Print a sheet of labels (100%, default margins) and scan one from 10–30 cm.
