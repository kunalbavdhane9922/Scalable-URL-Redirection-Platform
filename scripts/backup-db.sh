#!/usr/bin/env bash
# Dump PostgreSQL to backups/ and prune old dumps.
#
#   ./scripts/backup-db.sh
#   RETENTION_DAYS=14 ./scripts/backup-db.sh
#
# Restore:
#   gunzip -c backups/urlshortener-<timestamp>.sql.gz | \
#     docker compose exec -T postgres psql -U "$PGUSER" -d "$PGDATABASE"

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PGUSER_VALUE="${PGUSER:-urlshortener}"
PGDATABASE_VALUE="${PGDATABASE:-urlshortener}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
BACKUP_DIR="$ROOT_DIR/backups"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/urlshortener-$STAMP.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "→ Dumping $PGDATABASE_VALUE"
docker compose exec -T postgres \
  pg_dump --clean --if-exists --no-owner --no-privileges \
  -U "$PGUSER_VALUE" -d "$PGDATABASE_VALUE" | gzip -9 > "$FILE"

echo "  saved $(du -h "$FILE" | cut -f1) to $FILE"

echo "→ Pruning dumps older than ${RETENTION_DAYS} days"
find "$BACKUP_DIR" -name 'urlshortener-*.sql.gz' -type f -mtime "+$RETENTION_DAYS" -delete

echo "Done."
