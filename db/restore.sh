#!/usr/bin/env bash
# =============================================================================
# restore.sh — put a backup back
# =============================================================================
#   ./db/restore.sh db/backups/fidato-20260829-143000.dump
#   ./db/restore.sh --latest
#   ./db/restore.sh --latest --into fidato_staging
#
# This is the script somebody runs at 03:00 on the worst day of the year, and
# it is written for that person rather than for the person writing it. It says
# what it is about to destroy, waits for them to type the database name, and
# refuses every shortcut that would let a tired person skip the sentence they
# most need to read.
#
# IT OVERWRITES A DATABASE. There is no undo. That is the entire risk here, so
# it is stated once at the top and again on screen before anything happens.
#
# It also takes a SAFETY BACKUP of what it is about to replace, unless the
# target does not exist. Restoring the wrong file is a normal mistake, and
# without that copy it is an unrecoverable one.
# =============================================================================
set -uo pipefail

PGBIN="${PGBIN:-C:/Users/rozar/AppData/Local/Temp/claude/D--PMS-FIDATO/6f5bb0bf-ad16-442f-bd1d-566b371924fa/scratchpad/pg/pgsql/bin}"
PGPORT="${PGPORT:-55432}"
PGHOST="${PGHOST:-127.0.0.1}"
SUPER="${SUPER:-postgres}"
SUPERPASS="${SUPERPASS:-pw}"
DB="${DB:-fidato}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ⚠ THIS HARDCODED `psql.exe` AND `pg_restore.exe`, so it could only ever run
# on Windows -- and the machine it exists FOR is a Linux server. The one time
# it was needed, moving a real property onto a real box, it could not run.
#
# Same fault migrate.sh had, found the same way: by trying to use it.
pick() {
  if   [ -x "$PGBIN/$1.exe" ]; then echo "$PGBIN/$1.exe"
  elif [ -x "$PGBIN/$1" ];     then echo "$PGBIN/$1"
  elif command -v "$1" >/dev/null 2>&1; then command -v "$1"
  else echo ""
  fi
}

PSQL="$(pick psql)"
PGDUMP="$(pick pg_dump)"
PGRESTORE="$(pick pg_restore)"

for prog in "$PSQL" "$PGDUMP" "$PGRESTORE"; do
  if [ -z "$prog" ]; then
    printf "[31m  x psql, pg_dump and pg_restore must all be available.
"
    printf "    Set PGBIN to the directory holding them, or install the
"
    printf "    postgresql client package.[0m
"
    exit 1
  fi
done
S="-h $PGHOST -p $PGPORT -U $SUPER"

red()   { printf "\033[31m%s\033[0m\n" "$1"; }
green() { printf "\033[32m%s\033[0m\n" "$1"; }
warn()  { printf "\033[33m%s\033[0m\n" "$1"; }

FILE=""
TARGET="$DB"
ASSUME_YES=0

while [ $# -gt 0 ]; do
  case "$1" in
    --latest)
      FILE=$(ls -1t "$ROOT"/db/backups/${DB}-*.dump 2>/dev/null | head -1)
      shift ;;
    --into)  TARGET="$2"; shift 2 ;;
    # Only for a scratch target. Refused below for anything else, because an
    # unattended restore over a live database is not a thing this script does.
    --yes)   ASSUME_YES=1; shift ;;
    *)       FILE="$1"; shift ;;
  esac
done

if [ -z "$FILE" ] || [ ! -s "$FILE" ]; then
  red "  x no backup file. Pass a path, or --latest."
  echo
  echo "  available:"
  ls -1t "$ROOT"/db/backups/*.dump 2>/dev/null | head -5 | sed 's/^/    /' \
    || echo "    none in db/backups/"
  exit 1
fi

EXISTS=$(PGPASSWORD=$SUPERPASS "$PSQL" $S -d postgres -tAc \
  "select 1 from pg_database where datname='$TARGET'" 2>/dev/null | tr -d ' \r')

echo
warn "  ────────────────────────────────────────────────────────────"
warn "   ABOUT TO REPLACE THE DATABASE  $TARGET"
warn "  ────────────────────────────────────────────────────────────"
echo
echo "   from      $(basename "$FILE")"
echo "   taken     $(date -r "$FILE" '+%d %b %Y, %H:%M' 2>/dev/null || echo 'unknown')"
echo "   size      $(du -k "$FILE" | cut -f1) KB"
echo "   server    $PGHOST:$PGPORT"
echo

if [ "$EXISTS" = "1" ]; then
  # What is about to be lost, in the terms a hotelier thinks in — not "4,312
  # rows". Somebody about to overwrite a database deserves to see whether it
  # is the one they think it is.
  PGPASSWORD=$SUPERPASS "$PSQL" $S -d "$TARGET" -tAc "
    select '   it currently holds ' ||
           (select count(*) from hotels)::text || ' properties, ' ||
           (select count(*) from reservations)::text || ' reservations, ' ||
           (select count(*) from folio_postings)::text || ' ledger rows'
  " 2>/dev/null | sed 's/^ *//' | sed 's/^/  /'
  PGPASSWORD=$SUPERPASS "$PSQL" $S -d "$TARGET" -tAc "
    select '   most recent posting: ' ||
           coalesce(max(business_date)::text, 'none')
      from folio_postings" 2>/dev/null | sed 's/^ *//' | sed 's/^/  /'
  echo
  red  "   ALL OF THAT IS DESTROYED. There is no undo."
else
  echo "   $TARGET does not exist yet — it will be created."
fi
echo

if [ "$ASSUME_YES" = "1" ]; then
  if [ "$TARGET" = "$DB" ]; then
    red "  x --yes is refused for the live database ($DB)."
    red "    Type the name. That pause is the point of it."
    exit 1
  fi
  echo "  --yes on a non-live target ($TARGET). Proceeding."
else
  # The name, not "y". A confirmation you can answer without reading is not a
  # confirmation — and the name is the one thing a person restoring the wrong
  # database would get wrong.
  printf "  Type the database name to confirm (%s): " "$TARGET"
  read -r TYPED
  if [ "$TYPED" != "$TARGET" ]; then
    echo
    red "  x not confirmed. Nothing was changed."
    exit 1
  fi
fi

# ── Safety copy of what is about to go ───────────────────────────────────────
if [ "$EXISTS" = "1" ]; then
  echo
  echo "-- copying the current $TARGET first -----------------------"
  SAFETY="$ROOT/db/backups/${TARGET}-replaced-$(date +%Y%m%d-%H%M%S).dump"
  mkdir -p "$(dirname "$SAFETY")"
  PGPASSWORD=$SUPERPASS "$PGDUMP" $S -Fc --no-owner --no-acl \
    -f "$SAFETY" "$TARGET" 2>&1 | sed 's/^/    /'
  if [ -s "$SAFETY" ]; then
    green "  ✓ $(basename "$SAFETY")"
    echo "    if this restore was a mistake, that file is the way back"
  else
    red "  x could not copy the current database. STOPPING."
    red "    Restoring now would destroy it with nothing to return to."
    exit 1
  fi
fi

# ── Replace ──────────────────────────────────────────────────────────────────
echo
echo "-- restoring -----------------------------------------------"

PGPASSWORD=$SUPERPASS "$PSQL" $S -d postgres -q \
  -c "drop database if exists $TARGET with (force)" >/dev/null 2>&1
PGPASSWORD=$SUPERPASS "$PSQL" $S -d postgres -q \
  -c "create database $TARGET" >/dev/null 2>&1 \
  || { red "  x could not create $TARGET"; exit 1; }

OUT=$(PGPASSWORD=$SUPERPASS "$PGRESTORE" $S \
        -d "$TARGET" --no-owner --no-acl "$FILE" 2>&1)
RC=$?

if [ $RC -ne 0 ]; then
  red "  x pg_restore exited $RC"
  echo "$OUT" | grep -iE "error|fatal" | head -8 | sed 's/^/      /'
  exit 1
fi

green "  ✓ restored"

# ── And check it, rather than assuming ───────────────────────────────────────
echo
PGPASSWORD=$SUPERPASS "$PSQL" $S -d "$TARGET" -tAc "
  select '  ' || (select count(*) from hotels)::text || ' properties, ' ||
         (select count(*) from reservations)::text || ' reservations, ' ||
         (select count(*) from folio_postings)::text || ' ledger rows'
" 2>/dev/null | sed 's/^ *//' | sed 's/^/  /'

echo
warn "  Roles and grants come from the migrations, not the dump."
warn "  Run db/tests/run.sh --keep, or 010_roles.sql, before pointing"
warn "  the API at this database — pms_app has no privileges yet."
