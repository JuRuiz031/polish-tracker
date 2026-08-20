#!/usr/bin/env python3
"""
Nightly backup.

This is the insurance behind the project's first requirement: her data must never
silently disappear. It runs in GitHub Actions and pulls every row out of Supabase into
plain JSON and CSV, so a total loss of the Supabase project costs at most one day.

It writes the SAME canonical JSON shape that the app's own export produces
(src/data/transfer/exportData.ts), which means a backup file can be fed straight back
through the app's importer. Keys are sorted so consecutive backups diff cleanly and a
single changed row shows up as a single changed line.

Environment:
    SUPABASE_URL               https://<project>.supabase.co
    SUPABASE_SERVICE_ROLE_KEY  service_role key — bypasses RLS by design, since the
                               backup must see every row. NEVER ship this to a client.
    BACKUP_DIR                 output directory (default: ./backups)

Uses only the standard library so the workflow needs no pip install step.
"""

from __future__ import annotations

import csv
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

EXPORT_VERSION = 1
TABLES = ("polish", "wear", "wishlist")

# Column order mirrors CSV_COLUMNS in src/data/transfer/exportData.ts. Keep in step.
CSV_COLUMNS = {
    "polish": [
        "id", "brand", "name", "color", "finish", "swatch_hex", "photo_path",
        "notes", "archived", "created_at", "updated_at", "deleted_at",
    ],
    "wear": [
        "id", "polish_id", "worn_on", "rating", "days_lasted", "notes",
        "created_at", "updated_at", "deleted_at",
    ],
    "wishlist": [
        "id", "brand", "name", "color", "finish", "where_sold", "typical_price",
        "sale_window", "priority", "status", "link", "notes",
        "created_at", "updated_at", "deleted_at",
    ],
}

PAGE_SIZE = 1000


class BackupError(RuntimeError):
    pass


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise BackupError(f"Missing required environment variable: {name}")
    return value


def fetch_table(base_url: str, key: str, table: str) -> list[dict]:
    """Fetch every row, paging through PostgREST's range headers.

    Paged rather than fetched in one shot because PostgREST caps a response at
    max-rows; without paging a large collection would be silently truncated, which is
    the worst possible failure mode for a backup.
    """
    rows: list[dict] = []
    offset = 0

    while True:
        url = f"{base_url}/rest/v1/{table}?select=*&order=id.asc"
        request = urllib.request.Request(url)
        request.add_header("apikey", key)
        request.add_header("Authorization", f"Bearer {key}")
        request.add_header("Range-Unit", "items")
        request.add_header("Range", f"{offset}-{offset + PAGE_SIZE - 1}")

        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                page = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise BackupError(f"{table}: HTTP {error.code} — {detail}") from error
        except urllib.error.URLError as error:
            raise BackupError(f"{table}: could not reach Supabase — {error.reason}") from error

        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows
        offset += PAGE_SIZE


def canonicalise(value):
    """Sort keys recursively, matching the app's canonical JSON export."""
    if isinstance(value, list):
        return [canonicalise(item) for item in value]
    if isinstance(value, dict):
        return {key: canonicalise(value[key]) for key in sorted(value)}
    return value


def serialise_cell(value) -> str:
    """Match the TypeScript exporter: null becomes an empty cell, not "null"."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def write_csv(path: Path, rows: list[dict], table: str) -> None:
    columns = CSV_COLUMNS[table]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\r\n")
        writer.writerow(columns)
        for row in rows:
            writer.writerow([serialise_cell(row.get(column)) for column in columns])


def main() -> int:
    try:
        base_url = require_env("SUPABASE_URL").rstrip("/")
        key = require_env("SUPABASE_SERVICE_ROLE_KEY")
    except BackupError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2

    out_dir = Path(os.environ.get("BACKUP_DIR", "backups"))
    out_dir.mkdir(parents=True, exist_ok=True)

    now = datetime.now(timezone.utc)
    stamp = now.strftime("%Y-%m-%d")

    try:
        data = {table: fetch_table(base_url, key, table) for table in TABLES}
    except BackupError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    # A backup that silently captures nothing is worse than a failed one, because it
    # overwrites yesterday's good copy with an empty file and nobody notices.
    if not data["polish"]:
        print(
            "error: the polish table came back empty — refusing to overwrite a good "
            "backup with nothing. Check the service key and RLS settings.",
            file=sys.stderr,
        )
        return 1

    bundle = canonicalise({
        "version": EXPORT_VERSION,
        "exported_at": now.isoformat().replace("+00:00", "Z"),
        "polish": data["polish"],
        "wear": data["wear"],
        "wishlist": data["wishlist"],
    })

    json_path = out_dir / f"polish-backup-{stamp}.json"
    json_path.write_text(json.dumps(bundle, indent=2, sort_keys=True), encoding="utf-8")

    # "latest" is a stable filename so a restore never has to hunt for the newest file.
    (out_dir / "polish-backup-latest.json").write_text(
        json.dumps(bundle, indent=2, sort_keys=True), encoding="utf-8"
    )

    for table in TABLES:
        write_csv(out_dir / f"polish-{table}-{stamp}.csv", data[table], table)
        write_csv(out_dir / f"polish-{table}-latest.csv", data[table], table)

    print(
        f"backed up {len(data['polish'])} polishes, {len(data['wear'])} wears, "
        f"{len(data['wishlist'])} wishlist items to {out_dir}/"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
