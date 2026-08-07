#!/usr/bin/env python3
"""Create a consistent, D1-compatible SQL snapshot of the local CRM database.

The output stays under .deploy/ (git-ignored). Active login sessions and browser
push subscriptions are intentionally excluded so copied credentials cannot be
reused against the production deployment.
"""

from __future__ import annotations

import argparse
import datetime as dt
import pathlib
import shutil
import sqlite3
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
STATE_DIR = ROOT / ".wrangler" / "state" / "v3" / "d1" / "miniflare-D1DatabaseObject"
OUTPUT_DIR = ROOT / ".deploy"
RESERVED_TABLES = {
    "_cf_KV",
    "_cf_METADATA",
    "sqlite_sequence",
}
SANITIZED_TABLES = {"employee_sessions", "push_subscriptions"}


def quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def sql_literal(value: object) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bytes):
        return "X'" + value.hex() + "'"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return repr(value)
    return "'" + str(value).replace("'", "''") + "'"


def local_database() -> pathlib.Path:
    candidates = [
        path
        for path in STATE_DIR.glob("*.sqlite")
        if path.name != "metadata.sqlite" and path.stat().st_size > 1024 * 1024
    ]
    if not candidates:
        raise FileNotFoundError(f"No local CRM D1 database found under {STATE_DIR}")
    return max(candidates, key=lambda path: path.stat().st_mtime)


def table_order(connection: sqlite3.Connection, tables: list[str]) -> list[str]:
    remaining = set(tables)
    ordered: list[str] = []
    while remaining:
        progressed = False
        for table in sorted(remaining):
            parents = {
                str(row[2])
                for row in connection.execute(
                    f"PRAGMA foreign_key_list({quote_identifier(table)})"
                )
                if str(row[2]) in remaining and str(row[2]) != table
            }
            if not parents:
                ordered.append(table)
                remaining.remove(table)
                progressed = True
                break
        if not progressed:
            ordered.extend(sorted(remaining))
            break
    return ordered


def compatible_create(sql: str) -> str:
    normalized = sql.strip().rstrip(";")
    normalized = normalized.replace("CREATE TABLE ", "CREATE TABLE IF NOT EXISTS ", 1)
    normalized = normalized.replace("CREATE INDEX ", "CREATE INDEX IF NOT EXISTS ", 1)
    normalized = normalized.replace(
        "CREATE UNIQUE INDEX ", "CREATE UNIQUE INDEX IF NOT EXISTS ", 1
    )
    return normalized + ";"


def self_reference_order(
    connection: sqlite3.Connection, table: str, columns: list[str], rows: list[tuple]
) -> tuple[list[tuple], list[str]]:
    self_links = [
        (columns.index(str(row[3])), columns.index(str(row[4])))
        for row in connection.execute(
            f"PRAGMA foreign_key_list({quote_identifier(table)})"
        )
        if str(row[2]) == table
        and str(row[3]) in columns
        and str(row[4]) in columns
    ]
    if not self_links:
        return rows, []

    pending = list(rows)
    ordered: list[tuple] = []
    seen = [set() for _ in self_links]
    while pending:
        progressed = False
        for row in list(pending):
            ready = all(
                row[from_index] is None
                or row[from_index] == row[to_index]
                or row[from_index] in seen[index]
                for index, (from_index, to_index) in enumerate(self_links)
            )
            if not ready:
                continue
            ordered.append(row)
            pending.remove(row)
            for index, (_, to_index) in enumerate(self_links):
                seen[index].add(row[to_index])
            progressed = True
        if not progressed:
            break

    if not pending:
        return ordered, []

    table_info = list(
        connection.execute(f"PRAGMA table_info({quote_identifier(table)})")
    )
    primary_key_columns = [
        str(row[1]) for row in sorted(table_info, key=lambda item: int(item[5])) if int(row[5])
    ]
    if not primary_key_columns:
        raise RuntimeError(f"Cannot safely export self-referencing table {table}")

    deferred_updates: list[str] = []
    for original in pending:
        mutable = list(original)
        assignments: list[str] = []
        for from_index, _ in self_links:
            if mutable[from_index] is not None:
                assignments.append(
                    f"{quote_identifier(columns[from_index])}={sql_literal(mutable[from_index])}"
                )
                mutable[from_index] = None
        predicates = [
            f"{quote_identifier(column)}={sql_literal(original[columns.index(column)])}"
            for column in primary_key_columns
        ]
        if assignments:
            deferred_updates.append(
                f"UPDATE {quote_identifier(table)} SET {', '.join(assignments)} "
                f"WHERE {' AND '.join(predicates)};"
            )
        ordered.append(tuple(mutable))
    return ordered, deferred_updates


def export_sql(connection: sqlite3.Connection, output: pathlib.Path) -> dict[str, int]:
    table_rows = connection.execute(
        """
        SELECT name, sql
        FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
        ORDER BY name
        """
    ).fetchall()
    tables = [str(row[0]) for row in table_rows if str(row[0]) not in RESERVED_TABLES]
    creates = {str(row[0]): str(row[1]) for row in table_rows if str(row[0]) in tables}
    counts: dict[str, int] = {}
    deferred_updates: list[str] = []

    with output.open("w", encoding="utf-8", newline="\n") as stream:
        stream.write("-- Masar CRM production data snapshot\n")
        stream.write("-- Generated locally; contains confidential customer data.\n")
        stream.write("PRAGMA defer_foreign_keys = TRUE;\n")
        for table in tables:
            stream.write(compatible_create(creates[table]) + "\n")

        for table in table_order(connection, tables):
            columns = [
                str(row[1])
                for row in connection.execute(
                    f"PRAGMA table_info({quote_identifier(table)})"
                )
            ]
            column_sql = ", ".join(quote_identifier(column) for column in columns)
            rows = list(connection.execute(f"SELECT * FROM {quote_identifier(table)}"))
            rows, table_updates = self_reference_order(connection, table, columns, rows)
            deferred_updates.extend(table_updates)
            count = 0
            for row in rows:
                values = ", ".join(sql_literal(value) for value in row)
                stream.write(
                    f"INSERT OR REPLACE INTO {quote_identifier(table)} "
                    f"({column_sql}) VALUES ({values});\n"
                )
                count += 1
            counts[table] = count

        for statement in deferred_updates:
            stream.write(statement + "\n")

        indexes = connection.execute(
            """
            SELECT sql
            FROM sqlite_master
            WHERE type = 'index' AND sql IS NOT NULL
            ORDER BY name
            """
        ).fetchall()
        for (sql,) in indexes:
            stream.write(compatible_create(str(sql)) + "\n")

    return counts


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=pathlib.Path)
    args = parser.parse_args()

    source = local_database()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    snapshot = OUTPUT_DIR / f"masar-crm-{timestamp}.sqlite"
    output = args.output or OUTPUT_DIR / "masar-crm-production.sql"
    if not output.is_absolute():
        output = ROOT / output
    output.parent.mkdir(parents=True, exist_ok=True)

    source_connection = sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True)
    snapshot_connection = sqlite3.connect(snapshot)
    try:
        source_connection.backup(snapshot_connection)
    finally:
        snapshot_connection.close()
        source_connection.close()

    connection = sqlite3.connect(snapshot)
    try:
        for table in SANITIZED_TABLES:
            exists = connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
            ).fetchone()
            if exists:
                connection.execute(f"DELETE FROM {quote_identifier(table)}")
        connection.commit()
        counts = export_sql(connection, output)
    finally:
        connection.close()

    shutil.copy2(output, OUTPUT_DIR / "latest-production.sql")
    total = sum(counts.values())
    print(f"Source: {source}")
    print(f"Consistent backup: {snapshot}")
    print(f"D1 SQL: {output}")
    print(f"Exported rows: {total:,}")
    print(f"SQL size: {output.stat().st_size / 1024 / 1024:.1f} MiB")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"Export failed: {error}", file=sys.stderr)
        raise
