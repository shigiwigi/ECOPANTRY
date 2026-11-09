"""All version-1 routes. Feature modules add their router here.

Protected routes depend on `app.auth.dependencies` (staff sessions) or
`app.auth.device` (sensor stations); see `tests/test_route_protection.py`
for the list of deliberately public routes.
"""

from fastapi import APIRouter

from app.api.v1.routes import auth, batches, catalogue, device, devices, employees, health, public, rfid, sensors
from app.api.v1.routes import alerts, audit, dashboard, enquiries, expiry, inventory, records, reports

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(employees.router)
api_router.include_router(catalogue.router)
api_router.include_router(batches.router)
api_router.include_router(devices.router)
api_router.include_router(sensors.router)
api_router.include_router(rfid.router)
api_router.include_router(device.router)
api_router.include_router(public.router)
api_router.include_router(inventory.router)
api_router.include_router(expiry.router)
api_router.include_router(alerts.router)
api_router.include_router(records.router)
api_router.include_router(enquiries.router)
api_router.include_router(audit.router)
api_router.include_router(dashboard.router)
api_router.include_router(reports.router)
