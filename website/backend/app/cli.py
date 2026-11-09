"""Staff account tools for the server operator. Run from website/backend/:

    .venv/bin/python -m app.cli create-admin --email owner@example.com --name "Owner Name"
    .venv/bin/python -m app.cli set-password --email someone@example.com
    .venv/bin/python -m app.cli deactivate --email someone@example.com
    .venv/bin/python -m app.cli reactivate --email someone@example.com
    .venv/bin/python -m app.cli purge-sessions --days 30
    .venv/bin/python -m app.cli purge-enquiries --months 12
    .venv/bin/python -m app.cli purge-readings --days 90
    .venv/bin/python -m app.cli create-device --name "Inventory station 1"
    .venv/bin/python -m app.cli rotate-device-token --name "Inventory station 1"
    .venv/bin/python -m app.cli list-devices

Device tokens are printed once, when a device is created or its token is
rotated; only their SHA-256 is stored. Copy the token into the station's
include/secrets.h (git-ignored).

Passwords are prompted for (typed twice, not echoed), or read from standard
input with --password-stdin. They are never accepted as arguments, because
arguments end up in shell history and process listings. There is no default
account: the first administrator only exists once someone runs create-admin.
"""

import argparse
import getpass
import sys
from collections.abc import Sequence
from datetime import timedelta
from typing import TextIO

from sqlalchemy import delete, exists, or_, select
from sqlalchemy.orm import Session

from app.auth.permissions import RoleCode
from app.auth.service import utcnow
from app.core.config import Settings, get_settings
from app.core.errors import AppError
from app.db.session import Database
from app.models.auth import AuthSession, Employee, Role
from app.models.alerts import Alert
from app.models.devices import Device, SensorReading
from app.models.ph import PhRecord
from app.services import devices as device_service
from app.services import employees as service
from app.services import enquiries as enquiry_service


class CliError(Exception):
    pass


def _read_password(args: argparse.Namespace, stdin: TextIO) -> str:
    if args.password_stdin:
        line = stdin.readline()
        password = line[:-1] if line.endswith("\n") else line
        if not password:
            raise CliError("No password on standard input.")
        return password
    if not stdin.isatty():
        raise CliError("Standard input isn't a terminal. Use --password-stdin to pipe the password in.")
    first = getpass.getpass("New password: ")
    second = getpass.getpass("Repeat the password: ")
    if first != second:
        raise CliError("The passwords don't match.")
    return first


def _employee(db: Session, email: str) -> Employee:
    employee = service.find_by_email(db, email)
    if employee is None:
        raise CliError("No staff account has that email.")
    return employee


def _create_admin(db: Session, args: argparse.Namespace, stdin: TextIO, out: TextIO) -> None:
    admin_exists = db.scalar(select(exists().where(Employee.role_id == Role.id, Role.code == RoleCode.ADMIN.value)))
    if admin_exists:
        raise CliError(
            "An administrator account already exists. Add staff from the portal, or use "
            "set-password / reactivate to recover an existing administrator."
        )
    password = _read_password(args, stdin)
    employee = service.create_employee(
        db, email=args.email, full_name=args.name, role=RoleCode.ADMIN, password=password,
        created_by=None, actor_type="cli",
    )  # fmt: skip
    db.commit()
    out.write(f"Created administrator {employee.email}.\n")


def _set_password(db: Session, args: argparse.Namespace, stdin: TextIO, out: TextIO) -> None:
    employee = _employee(db, args.email)
    password = _read_password(args, stdin)
    service.reset_password(db, employee, password, by=None, actor_type="cli")
    db.commit()
    out.write(f"Password changed for {employee.email}. Their sessions were signed out.\n")


def _deactivate(db: Session, args: argparse.Namespace, _: TextIO, out: TextIO) -> None:
    employee = _employee(db, args.email)
    service.deactivate_employee(db, employee, by=None, actor_type="cli")
    db.commit()
    out.write(f"Deactivated {employee.email} and signed out their sessions.\n")


def _reactivate(db: Session, args: argparse.Namespace, _: TextIO, out: TextIO) -> None:
    employee = _employee(db, args.email)
    service.reactivate_employee(db, employee, by=None, actor_type="cli")
    db.commit()
    out.write(f"Reactivated {employee.email}.\n")


def _purge_sessions(db: Session, args: argparse.Namespace, _: TextIO, out: TextIO) -> None:
    cutoff = utcnow() - timedelta(days=args.days)
    result = db.execute(
        delete(AuthSession).where(
            or_(AuthSession.expires_at < cutoff, AuthSession.revoked_at < cutoff, AuthSession.last_seen_at < cutoff)
        )
    )
    db.commit()
    out.write(f"Deleted {getattr(result, 'rowcount', 0)} sessions that ended more than {args.days} days ago.\n")


def _purge_enquiries(db: Session, args: argparse.Namespace, _: TextIO, out: TextIO) -> None:
    if args.months < 1:
        raise CliError("--months must be at least 1.")
    deleted = enquiry_service.purge_older_than(db, months=args.months)
    db.commit()
    out.write(f"Deleted {deleted} contact-form messages older than {args.months} months.\n")


READINGS_CHUNK = 5000


def _purge_readings(db: Session, args: argparse.Namespace, _: TextIO, out: TextIO) -> None:
    """Delete old sensor readings in chunks (one short transaction each, so the free database isn't locked).

    Readings that an alert or a pH record points at are kept, because those records need their source.
    """
    if args.days < 1:
        raise CliError("--days must be at least 1.")
    cutoff = utcnow() - timedelta(days=args.days)
    total = 0
    while True:
        ids = db.scalars(
            select(SensorReading.id)
            .where(
                SensorReading.recorded_at < cutoff,
                ~exists().where(Alert.sensor_reading_id == SensorReading.id),
                ~exists().where(PhRecord.sensor_reading_id == SensorReading.id),
            )
            .order_by(SensorReading.id)
            .limit(READINGS_CHUNK)
        ).all()
        if not ids:
            break
        db.execute(delete(SensorReading).where(SensorReading.id.in_(ids)))
        db.commit()
        total += len(ids)
    out.write(f"Deleted {total} sensor readings older than {args.days} days.\n")


def _device(db: Session, name: str) -> Device:
    device = device_service.find_by_name(db, name)
    if device is None:
        raise CliError("No device has that name.")
    return device


def _create_device(db: Session, args: argparse.Namespace, _: TextIO, out: TextIO) -> None:
    device, token = device_service.create_device(db, args.name, by=None, actor_type="cli")
    db.commit()
    out.write(f"Registered {device.name}.\nDevice token (shown once, put it in include/secrets.h):\n{token}\n")


def _rotate_device_token(db: Session, args: argparse.Namespace, _: TextIO, out: TextIO) -> None:
    device = _device(db, args.name)
    token = device_service.rotate_token(db, device, by=None, actor_type="cli")
    db.commit()
    out.write(f"New token for {device.name}; the old one no longer works.\n{token}\n")


def _list_devices(db: Session, _: argparse.Namespace, __: TextIO, out: TextIO) -> None:
    devices = device_service.list_devices(db)
    if not devices:
        out.write("No devices registered.\n")
    for device in devices:
        seen = device.last_seen_at.isoformat(timespec="seconds") if device.last_seen_at else "never"
        out.write(f"{device.name}\t{device.status}\t{device.token_prefix}…\tlast seen {seen}\n")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description="EcoPantry staff account tools.")
    commands = parser.add_subparsers(dest="command", required=True)

    create = commands.add_parser("create-admin", help="Create the first administrator (only when none exists).")
    create.add_argument("--email", required=True)
    create.add_argument("--name", required=True, help="Full name shown in the portal.")
    create.add_argument("--password-stdin", action="store_true", help="Read the password from standard input.")
    create.set_defaults(handler=_create_admin)

    set_password = commands.add_parser("set-password", help="Set a new password and sign the account out everywhere.")
    set_password.add_argument("--email", required=True)
    set_password.add_argument("--password-stdin", action="store_true", help="Read the password from standard input.")
    set_password.set_defaults(handler=_set_password)

    for name, handler, text in (
        ("deactivate", _deactivate, "Deactivate an account and sign it out everywhere."),
        ("reactivate", _reactivate, "Reactivate a deactivated account and clear any lockout."),
    ):
        command = commands.add_parser(name, help=text)
        command.add_argument("--email", required=True)
        command.set_defaults(handler=handler)

    purge = commands.add_parser("purge-sessions", help="Delete sessions that ended long ago.")
    purge.add_argument("--days", type=int, default=30, help="Keep sessions that ended within this many days.")
    purge.set_defaults(handler=_purge_sessions)

    purge_enquiries = commands.add_parser(
        "purge-enquiries", help="Delete contact-form messages older than the retention period (personal data)."
    )
    purge_enquiries.add_argument("--months", type=int, default=12, help="Keep messages from the last N months.")
    purge_enquiries.set_defaults(handler=_purge_enquiries)

    purge_readings = commands.add_parser("purge-readings", help="Delete old sensor readings.")
    purge_readings.add_argument("--days", type=int, default=90, help="Keep readings from the last N days.")
    purge_readings.set_defaults(handler=_purge_readings)

    create_device = commands.add_parser("create-device", help="Register a sensor station and print its token once.")
    create_device.add_argument("--name", required=True, help="Unique name shown in the portal.")
    create_device.set_defaults(handler=_create_device)

    rotate = commands.add_parser("rotate-device-token", help="Give a station a new token; the old one stops working.")
    rotate.add_argument("--name", required=True)
    rotate.set_defaults(handler=_rotate_device_token)

    list_devices = commands.add_parser("list-devices", help="List registered stations.")
    list_devices.set_defaults(handler=_list_devices)
    return parser


def main(
    argv: Sequence[str] | None = None,
    *,
    settings: Settings | None = None,
    stdin: TextIO = sys.stdin,
    stdout: TextIO = sys.stdout,
    stderr: TextIO = sys.stderr,
) -> int:
    args = _parser().parse_args(argv)
    database = Database(settings or get_settings())
    try:
        with database.session_factory() as db:
            args.handler(db, args, stdin, stdout)
    except (CliError, AppError) as error:
        stderr.write(f"Error: {error}\n")
        return 1
    finally:
        database.dispose()
    return 0


if __name__ == "__main__":
    sys.exit(main())
