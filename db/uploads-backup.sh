#!/usr/bin/env bash
# =============================================================================
# uploads-backup.sh — the files uploaded into the PMS, off the box (D27-377)
# =============================================================================
# Installed by launch.sh as /usr/local/bin/fidato-uploads-backup. Cron runs it
# at 03:15 as `fidato`, the API's own account, whose folder it is
# (/etc/cron.d/fidato-uploads; a customer's, fidato-uploads-<code>):
#
#   fidato-uploads-backup /var/lib/fidato/uploads fidato
#       every file in the folder not yet copied (bill photos, petty-cash
#       receipts, repair and bar bills: whatever the PMS's attachments hold)
#       to <BACKUP_UPLOAD_URL>/uploads/fidato/<hotel id>/<name>, through
#       fidato-wal send (db/wal.sh): Content-MD5, and only a 200, or a 412
#       "already there", is a copy. The API names each file once and never
#       writes other bytes under that name (api/src/storage.ts), so a 412 is
#       a copy. A file changed in the last minute waits for the next night:
#       it may still be being written.
#
#   <names> | fidato-uploads-backup get /var/lib/fidato/uploads fidato
#       each name on stdin (the database's attachments.storage_key) that is
#       missing from the folder, fetched from
#       <RESTORE_FROM>/uploads/fidato/<name>: the read link the owner makes on
#       the day (deploy/README.md, Backups, "Getting a copy back"). Files
#       already there are left alone.
#
# WHAT WAS COPIED is listed in <folder>.sent, one name a line, so a night sends
# only what is new. Emptied, the next night sends everything again, and what
# the bucket already has answers 412.
#
# ONE LINE in <folder>.status, rewritten every night, which Connection health
# reads (the Backups row); after a failure a second line says why:
#   uploads-backup 2026-11-02T21:45:01Z ok|failed|off sent=3 waiting=0
# "off": no link yet, so these files are on this disk only.
#
# THE LINK IS IN A FILE OF ITS OWN, /etc/fidato-uploads.env: root's to write,
# fidato's to read. /etc/fidato-backup.env is the postgres account's to write,
# and reading it here would let that account choose where the hotel's files
# go (n8n has its own for the same reason, deploy/n8n.sh).
#
# THEY NEVER EXPIRE FROM THE BUCKET: the lifecycle rule that deletes the
# database's copies after 31 days leaves uploads/ out (Backups, step 1.4).
# =============================================================================
set -uo pipefail
export LC_ALL=C                 # one sort order for the folder and the record

UPLOADS_ENV="${UPLOADS_ENV:-/etc/fidato-uploads.env}"
WAL="${WAL_SH:-/usr/local/bin/fidato-wal}"
[ -x "$WAL" ] || WAL="$(dirname "${BASH_SOURCE[0]}")/wal.sh"
USE="use: fidato-uploads-backup [get] <uploads folder> <database>"

if [ "${1:-}" = get ]; then
  DIR="${2:?$USE}" NAME="${3:?$USE}" FROM="${RESTORE_FROM:?the read link: RESTORE_FROM=...}"
  back=0 rc=0
  while IFS= read -r k; do
    [ -n "$k" ] || continue
    # The database's word for it, so checked: <hotel id>/<id>.<ext>, never a path.
    [[ "$k" =~ ^[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z]{3,4}$ ]] \
      || { echo "  x not a stored file's name: $k" >&2; rc=1; continue; }
    [ -e "$DIR/$k" ] && continue
    # ⚠ The status code, not curl's exit code: with --retry, curl 8.14 exits 0
    # on a failed fetch too (db/backup.sh). Only a 200 is the file.
    code=$(curl -sS --retry 3 -m 900 --create-dirs -o "$DIR/$k" -w "%{http_code}" \
             "${FROM%/}/uploads/$NAME/$k") || true
    if [ "$code" = 200 ]; then
      back=$((back + 1))
    else
      rm -f "$DIR/$k"; rc=1; echo "  x not in the bucket (HTTP $code): $k" >&2
    fi
  done
  echo "put back $back file(s)$([ $rc -eq 0 ] || echo "; the ones above are NOT back")"
  exit $rc
fi

DIR="${1:?$USE}" NAME="${2:?$USE}"
[ -r "$UPLOADS_ENV" ] && . "$UPLOADS_ENV"
todo() { (cd "$DIR" && find . -type f -mmin +1 -printf '%P\n') | sort | comm -23 - <(sort "$DIR.sent"); }

touch "$DIR.sent" || exit 1
sent=0 rc=0 why="" result=off
if [ -n "${BACKUP_UPLOAD_URL:-}" ]; then
  result=ok
  while IFS= read -r f; do
    why=$(BACKUP_ENV="$UPLOADS_ENV" bash "$WAL" send "$DIR/$f" "uploads/$NAME/$f" 2>&1 < /dev/null) \
      || { result=failed rc=1; break; }
    echo "$f" >> "$DIR.sent"; sent=$((sent + 1))
  done < <(todo)
fi
# The first line is the one a program reads; the second says why.
{ echo "uploads-backup $(date -u +%Y-%m-%dT%H:%M:%SZ) $result sent=$sent waiting=$(todo | wc -l)"
  [ $rc -eq 0 ] || echo "$why"; } > "$DIR.status"
exit $rc
