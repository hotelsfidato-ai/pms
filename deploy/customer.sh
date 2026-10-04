#!/usr/bin/env bash
# =============================================================================
# customer.sh — the names a customer gets on this server (D27-278)
# =============================================================================
# Sourced by deploy/launch.sh, and by deploy/customer.test.mjs, which proves
# that with no customer it renders exactly what launch.sh rendered before.
#
# The owner, 4 October: each customer has ITS OWN DATABASE, all on this one
# server. Every customer's API logs in as the same pms_app (option a, the
# owner's choice): so each database is marked with its customer
# (app.customer), and an API refuses to start on a database marked for
# anybody else (api/src/server.ts, wrongDatabase).
#
#                 no CUSTOMER (Fidato)          CUSTOMER=abc
#   database      fidato                        fidato_abc
#   checkout      /opt/fidato                   /opt/fidato-abc
#   service       fidato-api                    fidato-api-abc
#   port          8787                          PORT, from deploy/customers.txt
#   nginx file    conf.d/fidato.conf            conf.d/pms-abc.conf
#   nginx zones   fidato_channel, …             fidato_abc_channel, …
#   uploads       /var/lib/fidato/uploads       /var/lib/fidato-abc/uploads
#   backup log    /var/log/fidato-backup.log    /var/log/fidato-backup-abc.log
#   pool          20 (DB_POOL_MAX unset)        10
#
# ⚠ pms-abc.conf, NOT fidato-abc.conf. nginx reads conf.d in name order, and
#   the first server on a port is the one an unknown name reaches. "-" sorts
#   before ".", so fidato-abc.conf would come before fidato.conf and take that
#   from Fidato.
# ⚠ The zones are renamed because nginx refuses a second limit_req_zone of
#   the same name: a copy of Fidato's file would fail `nginx -t`.
# =============================================================================

FIDATO_DIR=/opt/fidato

# customer_names — sets the names above from CUSTOMER (and PORT, for a
# customer). A bad code or port: a sentence on stderr, and 1.
customer_names() {
  if [ -z "${CUSTOMER:-}" ]; then
    # Fidato: exactly the values launch.sh had before, overrides included.
    APP_DIR="${APP_DIR:-$FIDATO_DIR}" DB_NAME="${DB_NAME:-fidato}"
    UPLOAD_DIR="${UPLOAD_DIR:-/var/lib/fidato/uploads}"
    PORT=8787 SERVICE=fidato-api ZONE=fidato NGINX_SITE=/etc/nginx/conf.d/fidato.conf
    BACKUP_LOG=/var/log/fidato-backup.log POOL=20 FIREBASE_PROJECT=poms-fad05
    return 0
  fi
  if ! [[ "$CUSTOMER" =~ ^[a-z][a-z0-9]{1,15}$ ]]; then
    echo "CUSTOMER must be 2 to 16 small letters and digits, starting with a letter: '$CUSTOMER'" >&2
    return 1
  fi
  if [ -n "${APP_DIR:-}${DB_NAME:-}${UPLOAD_DIR:-}" ]; then
    echo "A customer's folder, database and uploads come from CUSTOMER alone. Unset APP_DIR, DB_NAME and UPLOAD_DIR." >&2
    return 1
  fi
  if ! [[ "${PORT:-}" =~ ^[0-9]{4,5}$ ]] || [ "$PORT" = 8787 ]; then
    echo "A customer needs its own PORT, from deploy/customers.txt (8787 is Fidato's): '${PORT:-}'" >&2
    return 1
  fi
  APP_DIR="$FIDATO_DIR-$CUSTOMER" DB_NAME="fidato_$CUSTOMER"
  UPLOAD_DIR="/var/lib/fidato-$CUSTOMER/uploads"
  SERVICE="fidato-api-$CUSTOMER" ZONE="fidato_$CUSTOMER"
  NGINX_SITE="/etc/nginx/conf.d/pms-$CUSTOMER.conf"
  # The Firebase project stays empty: one per customer or one for all is
  # still the owner's to decide (D27-278 (4)).
  BACKUP_LOG="/var/log/fidato-backup-$CUSTOMER.log" POOL=10 FIREBASE_PROJECT=
}

# render_nginx <template> — this API's server block. For Fidato every
# substitution after the first is a no-op: 8787 for 8787, fidato_ for fidato_.
render_nginx() {
  sed -e "s/__DOMAIN__/$DOMAIN/g" -e "s/127\.0\.0\.1:8787/127.0.0.1:$PORT/g" \
      -e "s/zone=fidato_/zone=${ZONE}_/g" "$1"
}

# render_unit <template> — this API's systemd unit. Fidato's identifier stays.
render_unit() {
  sed -e "s#__APP_DIR__#$APP_DIR#g" -e "s#__UPLOAD_DIR__#$UPLOAD_DIR#g" \
      -e "s#^SyslogIdentifier=fidato-api\$#SyslogIdentifier=$SERVICE#" "$1"
}

# env_value <file> <key> <default> — one setting from an api/.env, and only
# that one: the file holds secrets and nothing else of it is printed.
env_value() {
  local v
  v="$(sed -n "s/^$2=//p" "$1" 2>/dev/null | tail -1)"
  echo "${v:-$3}"
}

# installed_apis <unit dir> <this service> — "service port pool" for every PMS
# API installed on this server except this one. Unset means the API's own
# defaults: port 8787, pool 20 (api/src/env.ts).
installed_apis() {
  local unit name dir
  for unit in "$1"/fidato-api*.service; do
    name="$(basename "$unit" .service)"
    [ -f "$unit" ] && [ "$name" != "$2" ] || continue
    dir="$(sed -n 's/^WorkingDirectory=//p' "$unit")"
    echo "$name $(env_value "$dir/.env" PORT 8787) $(env_value "$dir/.env" DB_POOL_MAX 20)"
  done
}

# budget <max_connections> <superuser_reserved> — reads "service port pool"
# lines, this API's included. Each API holds its pool and one LISTEN
# connection (api/src/realtime.ts); 5 more are kept for the backup, its
# restore check, migrations and a person's psql. One line; 1 when over, or
# when two APIs are given one port.
budget() {
  awk -v max="$1" -v res="$2" '
    { need += $3 + 1; if (seen[$2]++) twice = twice " " $2 }
    END {
      room = max - res - 5
      printf "  connections: %d API(s) need %d of %d (max_connections %d, less %d reserved and 5 for scripts)\n", NR, need, room, max, res
      if (twice != "") { printf "  x port%s is given to two APIs\n", twice; exit 1 }
      if (need > room) { print "  x over budget: lower DB_POOL_MAX in a customer api/.env, or raise max_connections"; exit 1 }
    }'
}
