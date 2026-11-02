"""All version-1 routes. Feature modules add their router here.

Protected routes depend on `app.auth.dependencies`; see
`tests/test_route_protection.py` for the list of deliberately public routes.
"""

from fastapi import APIRouter

from app.api.v1.routes import auth, batches, catalogue, employees, health, public

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(employees.router)
api_router.include_router(catalogue.router)
api_router.include_router(batches.router)
api_router.include_router(public.router)
