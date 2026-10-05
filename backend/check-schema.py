#!/usr/bin/env python3
import glob
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SCHEMA = ROOT / "schema.sql"
MIGRATIONS = sorted((ROOT / "migrations").glob("*.sql"))
TABLES = [
    "editions",
    "reservations",
    "identity_claims",
    "referrals",
    "standby",
    "objects",
    "webhook_events",
]

def apply_sql(conn, path):
    conn.executescript(path.read_text(encoding="utf-8"))

def table_signature(conn, table):
    columns = conn.execute(f"PRAGMA table_info({table})").fetchall()
    indexes = conn.execute(f"PRAGMA index_list({table})").fetchall()

    column_sig = [
        {
            "name": row[1],
            "type": (row[2] or "").upper(),
            "notnull": bool(row[3]),
            "default": row[4],
            "pk": bool(row[5]),
        }
        for row in columns
    ]

    unique_indexes = []
    for idx in indexes:
        # PRAGMA index_list: seq, name, unique, origin, partial
        if not idx[2]:
            continue
        name = idx[1]
        cols = [row[2] for row in conn.execute(f"PRAGMA index_info('{name}')").fetchall()]
        unique_indexes.append(tuple(cols))

    return column_sig, sorted(unique_indexes)

schema_conn = sqlite3.connect(":memory:")
migration_conn = sqlite3.connect(":memory:")

try:
    apply_sql(schema_conn, SCHEMA)
    for migration in MIGRATIONS:
        apply_sql(migration_conn, migration)
except Exception as exc:
    print(f"Schema application failed: {exc}", file=sys.stderr)
    sys.exit(1)

failures = []
for table in TABLES:
    expected = table_signature(schema_conn, table)
    actual = table_signature(migration_conn, table)
    if expected != actual:
        failures.append((table, expected, actual))

if failures:
    print("PHAM D1 schema drift detected.", file=sys.stderr)
    for table, expected, actual in failures:
        print(f"\nTABLE: {table}", file=sys.stderr)
        print(f"Expected: {expected}", file=sys.stderr)
        print(f"Actual:   {actual}", file=sys.stderr)
    sys.exit(1)

print(f"PHAM D1 schema check passed across {len(MIGRATIONS)} migration(s).")
