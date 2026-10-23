#!/bin/sh
# Logical backup of NEXORA's data (public schema) from Supabase PostgreSQL, in addition to
# Supabase's own daily backups / point-in-time recovery.
# SUPABASE_DB_URL: Supabase → Project Settings → Database → Connection string (session pooler or direct).
#   SUPABASE_DB_URL=postgres://... scripts/backup.sh ./backups
set -eu
: "${SUPABASE_DB_URL:?set SUPABASE_DB_URL}"
dir="${1:-./backups}"
keep="${BACKUP_KEEP:-14}"
mkdir -p "$dir"
file="$dir/nexora-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --no-owner --no-privileges --schema=public --file="$file" "$SUPABASE_DB_URL"
echo "backup written: $file ($(wc -c < "$file") bytes)"
ls -1t "$dir"/nexora-*.dump 2>/dev/null | tail -n +"$((keep + 1))" | xargs -r rm -f
