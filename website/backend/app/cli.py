"""Staff account tools for the server operator. Run from website/backend/:

    .venv/bin/python -m app.cli create-admin --email owner@example.com --name "Owner Name"
    .venv/bin/python -m app.cli set-password --email someone@example.com
    .venv/bin/python -m app.cli deactivate --email someone@example.com
    .venv/bin/python -m app.cli reactivate --email someone@example.com
    .venv/bin/python -m app.cli purge-sessions --days 30

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
from app.services import employees as service


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
