#!/usr/bin/env bash
# =============================================================================
# wal.sh — the database's change journal off the box, and back (D27-373, A3)
# =============================================================================
# Installed by launch.sh as /usr/local/bin/fidato-wal. Run as `postgres`:
#
#   archive_command = '/usr/local/bin/fidato-wal put %p %f'
#       PostgreSQL, from its data folder: one finished 16 MB piece of the
#       journal (WAL), gzipped (mostly a few hundred KB), into the spool
#       /var/lib/pgsql/wal-out. Local and quick, nothing over the network.
#
#   */5 * * * * postgres flock -n /var/lib/pgsql/wal-out.lock /usr/local/bin/fidato-wal push
#       (cron) every piece in the spool, oldest first, to
#       <BACKUP_UPLOAD_URL>/wal/<server>/<name>.gz with the nightly backup's
#       write-only link (/etc/fidato-backup.env); each one deleted from the
#       spool once the bucket has it. One line, rewritten every run, in
#       /var/log/fidato-wal.status, which Connection health reads (after a
#       failure, a second line says why):
#         wal-push 2026-11-02T09:35:01Z ok|failed sent=1 waiting=0
#
#   restore_command = '/usr/local/bin/fidato-wal get %f %p'
#       written by db/pitr-restore.sh into a TEMPORARY server only: fetches
#       <RESTORE_FROM>/wal/<server>/<name>.gz, from the read link the owner makes on
#       the day and passes on the command line
#
#   fidato-wal send <file> <name>
#       one file as it is to <BACKUP_UPLOAD_URL>/<name> (db/base-backup.sh)
#
# WHY A SPOOL, AND NOT curl INSIDE archive_command: the database runs
# confined by SELinux (Oracle Linux, enforcing; MEMORY 191), and nothing says
# its policy lets it open a connection to the internet; cron's jobs, like the
# nightly backup's upload, are not confined that way. A network fault also
# never holds the database's archiver up. The cost: up to five minutes more
# before a piece is off the box, after archive_timeout's hour.
#
# Either place may be a FOLDER instead of a link: the local rehearsal
# (db/tests/pitr.sh) uses one as its bucket.
#
# EXIT 0 ONLY WHEN THE FILE IS SAFELY THERE. PostgreSQL keeps a piece in
# pg_wal and asks again until `put` says 0; `push` keeps a piece in the spool
# until the bucket has it. Either one failing fills the disk, slowly:
# Connection health's Backups row turns red at once (pg_stat_archiver, and the
# status line), its Disk row at 80%.
#
# ⚠ THE STATUS CODE, NOT curl's EXIT CODE (db/backup.sh): 200 is a copy.
# 412 is "a file of that name is already there" (If-None-Match: *): an
# earlier push reached the bucket and did not hear back. Under one server's
# folder a piece's name never comes back with other bytes on the same
# timeline, so that is a copy too. In a folder, where it can, it
# compares the bytes, as the PostgreSQL manual asks.
# =============================================================================
set -uo pipefail

BACKUP_ENV="${BACKUP_ENV:-/etc/fidato-backup.env}"
[ -r "$BACKUP_ENV" ] && . "$BACKUP_ENV"
SPOOL="${WAL_SPOOL:-/var/lib/pgsql/wal-out}"
STATUS="${WAL_STATUS:-/var/log/fidato-wal.status}"

send() {                        # send <file> <name> - to BACKUP_UPLOAD_URL
  local to="${BACKUP_UPLOAD_URL:-}" code
  [ -n "$to" ] || { echo "fidato-wal: no BACKUP_UPLOAD_URL in $BACKUP_ENV - $2 NOT copied" >&2; return 1; }
  case "$to" in
    http*)
      code=$(curl -sS --retry 3 -m 900 -o /dev/null -w "%{http_code}" \
               -H "If-None-Match: *" \
               -H "Content-MD5: $(openssl dgst -md5 -binary "$1" | base64)" \
               -T "$1" "${to%/}/$2") || true
      [ "$code" = 200 ] || [ "$code" = 412 ] \
        || { echo "fidato-wal: $2 NOT copied (HTTP $code)" >&2; return 1; } ;;
    *)
      mkdir -p "$(dirname "$to/$2")" || return 1
      if [ -e "$to/$2" ]; then cmp -s "$1" "$to/$2"; return; fi
      cp "$1" "$to/$2.part" && mv "$to/$2.part" "$to/$2" ;;
  esac
}

# WHICH SERVER'S JOURNAL: its system identifier, read in the data folder
# PostgreSQL runs these commands in. The bucket keeps each server's pieces
# under wal/<identifier>/, because a server built again after the old one died
# (deploy/IF-THE-SERVER-DIES.md) names its pieces from the beginning again:
# in one folder they would meet the old server's names, and a 412 would then
# hide a piece that never arrived. A restore reads the identifier from its
# base copy, so it finds that server's folder by itself.
sysid() { LC_ALL=C "${PGBIN:+$PGBIN/}pg_controldata" . 2>/dev/null | sed -n 's/^Database system identifier: *//p'; }

put() {                         # put <path> <name> - into the spool
  local id; id=$(sysid)
  [ -n "$id" ] || { echo "fidato-wal: no system identifier in $(pwd)" >&2; return 1; }
  # -n: no name or time in the header, so a piece always gzips to the same
  # bytes, and a folder's comparison holds.
  mkdir -p "$SPOOL" && gzip -nc "$1" > "$SPOOL/$id-$2.gz.part" && mv "$SPOOL/$id-$2.gz.part" "$SPOOL/$id-$2.gz"
}

push() {                        # push - the spool to the bucket, oldest first
  # One at a time: cron runs it under flock (deploy/README.md).
  local f n sent=0 rc=0 why="" waiting
  for f in "$SPOOL"/*.gz; do    # <identifier>-<journal name>, oldest first
    [ -e "$f" ] || break
    n=${f##*/}
    why=$(send "$f" "wal/${n%%-*}/${n#*-}" 2>&1) || { rc=1; break; }
    rm -f "$f"; sent=$((sent + 1))
  done
  waiting=$(find "$SPOOL" -maxdepth 1 -name '*.gz' | wc -l)
  # The first line is the one a program reads; the second says why.
  { echo "wal-push $(date -u +%Y-%m-%dT%H:%M:%SZ) $([ $rc -eq 0 ] && echo ok || echo failed) sent=$sent waiting=$waiting"
    [ $rc -eq 0 ] || echo "$why"; } > "$STATUS"
  return $rc
}

get() {                         # get <name> <path> - from RESTORE_FROM
  local from="${RESTORE_FROM:-}" id; id=$(sysid)
  [ -n "$from" ] || { echo "fidato-wal: no RESTORE_FROM" >&2; return 1; }
  [ -n "$id" ] || { echo "fidato-wal: no system identifier in $(pwd)" >&2; return 1; }
  # Asked for names that were never archived (PostgreSQL does, on purpose):
  # a nonzero answer then is not an error, and nothing is left at <path>.
  case "$from" in
    http*) curl -sSf --retry 3 -m 900 -o "$2.gz" "${from%/}/wal/$id/$1.gz" ;;
    *)     cp "$from/wal/$id/$1.gz" "$2.gz" 2>/dev/null ;;
  esac || { rm -f "$2.gz"; return 1; }
  gzip -dc "$2.gz" > "$2.part" && rm -f "$2.gz" && mv "$2.part" "$2" \
    || { rm -f "$2.gz" "$2.part"; return 1; }
}

case "${1:-}" in
  put)  put "$2" "$3" ;;
  push) mkdir -p "$SPOOL" && push ;;
  get)  get "$2" "$3" ;;
  send) send "$2" "$3" ;;
  *)    echo "use: fidato-wal put <path> <name> | push | get <name> <path> | send <file> <name>" >&2; exit 2 ;;
esac
