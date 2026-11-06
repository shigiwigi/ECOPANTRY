"""PlatformIO pre-build check: stop with a clear message if include/secrets.h is missing.

secrets.h holds the WiFi password and the device token, so it is git-ignored.
Create it from include/secrets.example.h.
"""

from pathlib import Path

Import("env")  # type: ignore[name-defined]  # noqa: F821 - provided by PlatformIO's SCons

project = Path(env.subst("$PROJECT_DIR"))  # type: ignore[name-defined]  # noqa: F821
secrets = project / "include" / "secrets.h"

if not secrets.exists():
    message = (
        "\n\ninclude/secrets.h is missing.\n"
        "  cp include/secrets.example.h include/secrets.h\n"
        "then fill in the WiFi details, API_BASE_URL and the device token\n"
        "(from the portal's Devices page or `python -m app.cli create-device`).\n"
    )
    raise SystemExit(message)
