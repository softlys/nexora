#!/bin/sh
# Restores a dump made by scripts/backup.sh into a Supabase project whose migrations are applied
# (supabase db push). Data only: the schema, RLS policies and functions come from the migrations.
# Users (auth.users) are not part of the dump: restore into the same project, or re-invite members.
#   SUPABASE_DB_URL=postgres://... scripts/restore.sh ./backups/nexora-20261023T020000Z.dump
set -eu
: "${SUPABASE_DB_URL:?set SUPABASE_DB_URL}"
file="${1:?usage: restore.sh <dump file>}"
[ -f "$file" ] || { echo "no such file: $file" >&2; exit 1; }
# Foreign keys are checked by triggers; replica mode skips them during the load (the rows came from
# a consistent dump), which also handles the lead <-> deal reference cycle.
PGOPTIONS="-c session_replication_role=replica" pg_restore --data-only --no-owner --no-privileges --exit-on-error --dbname="$SUPABASE_DB_URL" "$file"
echo "restored data from $file"
