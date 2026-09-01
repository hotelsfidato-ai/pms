#!/usr/bin/env bash
# =============================================================================
# launch.sh — put this system on an Oracle Cloud box, once.
# =============================================================================
# Run ON the server, as a user with sudo:
#
#     git clone <repo> /opt/fidato && cd /opt/fidato
#     sudo DOMAIN=pms.example.com EMAIL=you@example.com deploy/launch.sh
#
# Idempotent. Running it again upgrades in place: it re-pulls, re-migrates,
# rebuilds the frontend and restarts the service. It does NOT re-issue a
# certificate that is still valid, and it never touches the database beyond
# applying migrations that have not run.
#
# IT REFUSES TO FINISH IF THE PREFLIGHT FAILS. That is the point: every check
# in api/scripts/preflight.ts is a way to have a system that starts, looks
# correct, and is wrong — dev auth left on, demo properties present, a service
# account from the wrong project. Better to stop here than to be found by a
# guest at the desk.
# =============================================================================

set -euo pipefail

DOMAIN="${DOMAIN:?set DOMAIN=pms.example.com}"
EMAIL="${EMAIL:?set EMAIL=you@example.com — certbot needs it for expiry warnings}"
APP_DIR="${APP_DIR:-/opt/fidato}"
DB_NAME="${DB_NAME:-fidato}"
DB_USER="${DB_USER:-pms_app}"
NODE_MAJOR="${NODE_MAJOR:-22}"

say() { printf "\n\033[1m── %s\033[0m\n" "$1"; }
die() { printf "\n\033[31m✗ %s\033[0m\n\n" "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run with sudo."

# -----------------------------------------------------------------------------
say "Packages"
# -----------------------------------------------------------------------------
# Oracle Linux and Ubuntu both appear on the free tier. Detect rather than
# assume: the wrong package manager fails halfway and leaves a broken box.
if command -v dnf >/dev/null; then
  PKG=dnf
  # certbot and its nginx plugin are not in Oracle Linux's own repos —
  # they come from EPEL, and without it the install fails on a line that
  # reads like a typo rather than a missing repository.
  dnf -y install oracle-epel-release-el9 2>/dev/null \
    || dnf -y install epel-release 2>/dev/null || true
  # PostgreSQL 16, not the AppStream default of 13. The schema was built and
  # tested against 17.6 — nothing in it needs newer than 13, but there is no
  # reason to run a live hotel on a version this suite has never seen.
  #
  # `|| true` because the module name has moved between OL9 point releases and
  # a missing module must not abort the install — the version check after the
  # database is up is what actually enforces this.
  dnf -y module reset postgresql 2>/dev/null || true
  dnf -y module enable postgresql:16 2>/dev/null || true
  dnf -y install nginx postgresql-server postgresql-contrib certbot \
                 python3-certbot-nginx git
  [ -d /var/lib/pgsql/data/base ] || postgresql-setup --initdb
elif command -v apt-get >/dev/null; then
  PKG=apt
  apt-get update -qq
  apt-get -y install nginx postgresql postgresql-contrib certbot \
                     python3-certbot-nginx git
else
  die "Neither dnf nor apt-get. Unsupported image."
fi

if ! command -v node >/dev/null || \
   [ "$(node -v | cut -d. -f1 | tr -d v)" -lt "$NODE_MAJOR" ]; then
  # Chosen by package manager, not by which download happens to succeed:
  # rpm.nodesource.com serves its script to anybody who asks, Ubuntu
  # included, where running it then fails obscurely.
  if [ "$PKG" = dnf ]; then NS=rpm; else NS=deb; fi
  curl -fsSL "https://${NS}.nodesource.com/setup_${NODE_MAJOR}.x" -o /tmp/ns.sh \
    || die "Could not fetch the NodeSource installer."
  bash /tmp/ns.sh
  $PKG -y install nodejs
fi
node -v | grep -qE "^v(2[2-9]|[3-9][0-9])" \
  || die "Node $NODE_MAJOR+ required — env.ts uses process.loadEnvFile."

systemctl enable --now postgresql nginx

# -----------------------------------------------------------------------------
say "Unattended security updates"
# -----------------------------------------------------------------------------
# The one thing added beyond the minimum, because it is the only risk that grows
# on its own. Nobody is going to log into this box for months; without it the
# kernel and openssl sit at whatever version was current the day it was built.
#
# SECURITY updates only, not every update. A box that upgrades everything
# unattended is a box that changes under a hotel with nobody watching.
if command -v dnf >/dev/null; then
  dnf -y install dnf-automatic
  sed -i 's/^upgrade_type.*/upgrade_type = security/' /etc/dnf/automatic.conf
  sed -i 's/^apply_updates.*/apply_updates = yes/'    /etc/dnf/automatic.conf
  systemctl enable --now dnf-automatic.timer
  echo "  dnf-automatic — security updates only, applied nightly"
else
  apt-get -y install unattended-upgrades
  dpkg-reconfigure -f noninteractive unattended-upgrades
  echo "  unattended-upgrades enabled"
fi
echo "  ⚠ Reboots are NOT automatic. A kernel update sits until somebody reboots."
echo "    Ksplice is free on Oracle Linux on OCI and removes that gap — worth"
echo "    setting up once the system is live and you can afford to experiment."

# -----------------------------------------------------------------------------
say "The firewall"
# -----------------------------------------------------------------------------
# Oracle's free tier ships with almost everything shut, in TWO places: the
# instance's own firewall AND the VCN security list in the Oracle console.
# This handles the first. THE SECOND IS A WEB CONSOLE STEP AND CANNOT BE
# SCRIPTED — see deploy/README.md. A box that passes this script and is still
# unreachable is almost always the VCN.
if command -v firewall-cmd >/dev/null; then
  firewall-cmd --permanent --add-service=http  --quiet || true
  firewall-cmd --permanent --add-service=https --quiet || true
  firewall-cmd --reload --quiet || true
elif command -v ufw >/dev/null; then
  ufw allow 80/tcp  || true
  ufw allow 443/tcp || true
fi
# Oracle images also carry iptables rules that outlive firewalld.
if command -v iptables >/dev/null; then
  iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || \
    iptables -I INPUT 1 -p tcp --dport 443 -j ACCEPT || true
  iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || \
    iptables -I INPUT 1 -p tcp --dport 80 -j ACCEPT || true
  command -v netfilter-persistent >/dev/null && netfilter-persistent save || true
fi

# -----------------------------------------------------------------------------
say "The service account (unix)"
# -----------------------------------------------------------------------------
# The API runs as `fidato`, not root and not your login. A system account with
# no shell and no home: if the process is ever compromised, what it can reach
# is the app directory and the Postgres socket.
id -u fidato >/dev/null 2>&1 \n  || useradd --system --no-create-home --shell /usr/sbin/nologin fidato
chown -R fidato:fidato "$APP_DIR"

# -----------------------------------------------------------------------------
say "Who Postgres will listen to"
# -----------------------------------------------------------------------------
# Oracle Linux ships pg_hba.conf with `ident` for host connections. The API
# connects as pms_app over 127.0.0.1 WITH A PASSWORD, and ident refuses that —
# so everything below would succeed, the service would start, and every request
# would fail with "Ident authentication failed for user pms_app". A working
# install that cannot reach its own database.
#
# Only the loopback lines are touched. `local` (unix socket, peer auth) is left
# exactly as it is: that is how `sudo -u postgres psql` works above, and how
# ADMIN_DATABASE_URL reaches the schema owner without a password anywhere.
HBA="$(sudo -u postgres psql -tAc 'show hba_file' | tr -d '[:space:]')"
if [ -f "$HBA" ]; then
  cp -n "$HBA" "$HBA.before-fidato" 2>/dev/null || true
  sed -i -E 's#^([[:space:]]*host[[:space:]]+all[[:space:]]+all[[:space:]]+(127\.0\.0\.1/32|::1/128)[[:space:]]+).*$#\1scram-sha-256#' "$HBA"
  grep -qE '^[[:space:]]*host[[:space:]]+all[[:space:]]+all[[:space:]]+127\.0\.0\.1/32[[:space:]]+scram-sha-256' "$HBA" \
    || echo "host    all             all             127.0.0.1/32            scram-sha-256" >> "$HBA"
  systemctl reload postgresql
  echo "  $HBA — loopback set to scram-sha-256"
else
  echo "  could not locate pg_hba.conf; leaving authentication as found"
fi

# -----------------------------------------------------------------------------
say "The database"
# -----------------------------------------------------------------------------
# The password is generated here and written only to api/.env, root-readable.
# A password in this script would be a password in git.
DB_PASS_FILE="$APP_DIR/api/.db-password"
if [ ! -f "$DB_PASS_FILE" ]; then
  head -c 32 /dev/urandom | base64 | tr -d '/+=' > "$DB_PASS_FILE"
  chmod 600 "$DB_PASS_FILE"
fi
DB_PASS="$(cat "$DB_PASS_FILE")"

sudo -u postgres psql -tAc \
  "select 1 from pg_roles where rolname='$DB_USER'" | grep -q 1 || \
  sudo -u postgres psql -qc \
    "create role $DB_USER login password '$DB_PASS'"
sudo -u postgres psql -qc \
  "alter role $DB_USER password '$DB_PASS'"

sudo -u postgres psql -tAc \
  "select 1 from pg_database where datname='$DB_NAME'" | grep -q 1 || \
  sudo -u postgres createdb -O postgres "$DB_NAME"

# The version actually running, said out loud. The module enable above is
# best-effort, so without this a silent fall back to PostgreSQL 13 would only
# surface as odd behaviour months later. 13 runs this schema — the suite has
# simply never been pointed at it.
PGVER="$(sudo -u postgres psql -tAc "show server_version" | cut -d. -f1)"
echo "  PostgreSQL $PGVER"
if [ "$PGVER" -lt 14 ]; then
  echo "  ⚠ PostgreSQL $PGVER — the suite was proven on 17.6. It will run, but this is a version nobody has tested this schema against."
fi

# -----------------------------------------------------------------------------
say "Sizing Postgres for the box"
# -----------------------------------------------------------------------------
# Postgres ships with shared_buffers at 128 MB, which is a default chosen to
# start anywhere, not to run anything. On 12 GB it is absurd.
#
# It also solves a problem specific to Oracle's free tier. Oracle RECLAIMS an
# idle Always Free instance when, across seven days, CPU AND network AND memory
# are all under 20%. A property system for thirty-five staff is comfortably
# under on CPU and network — memory is the one we can honestly hold above the
# line, because a database given room to cache is a database doing its job.
#
# 25% of RAM is the ordinary recommendation for shared_buffers. Here it also
# keeps the instance alive.
MEM_MB="$(free -m | awk '/^Mem:/{print $2}')"
SHARED="$(( MEM_MB / 4 ))MB"
PGCONF="$(sudo -u postgres psql -tAc 'show config_file' | tr -d '[:space:]')"
if [ -f "$PGCONF" ]; then
  sed -i "s/^#*shared_buffers.*/shared_buffers = $SHARED/" "$PGCONF"
  sed -i "s/^#*effective_cache_size.*/effective_cache_size = $(( MEM_MB / 2 ))MB/" "$PGCONF"
  systemctl restart postgresql
  echo "  shared_buffers = $SHARED  (of ${MEM_MB}MB)"
else
  echo "  could not locate postgresql.conf — left at defaults"
fi

say "Migrations"
for f in "$APP_DIR"/db/migrations/*.sql; do
  sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d "$DB_NAME" -f "$f" \
    || die "Migration failed: $(basename "$f")"
done
echo "  $(ls "$APP_DIR"/db/migrations/*.sql | wc -l) applied"

# -----------------------------------------------------------------------------
say "Configuration"
# -----------------------------------------------------------------------------
ENV_FILE="$APP_DIR/api/.env"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<ENVEOF
DATABASE_URL=postgres://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME
ADMIN_DATABASE_URL=postgres://postgres@/$DB_NAME?host=/var/run/postgresql
PORT=8787
NODE_ENV=production
CORS_ORIGIN=https://$DOMAIN
FIREBASE_PROJECT_ID=poms-fad05
# Paste the WHOLE service account JSON on one line. Not a path to it.
FIREBASE_SERVICE_ACCOUNT=
ENVEOF
  chmod 600 "$ENV_FILE"
  echo "  wrote api/.env — FIREBASE_SERVICE_ACCOUNT is still empty"
else
  # An existing file is never overwritten; only the origin is kept current,
  # because that is the one value a re-run can legitimately change.
  sed -i "s#^CORS_ORIGIN=.*#CORS_ORIGIN=https://$DOMAIN#" "$ENV_FILE"
  echo "  api/.env kept (CORS origin refreshed)"
fi

# The frontend needs the API's public origin baked in at BUILD time — Vite
# inlines VITE_* at build, so changing it later means rebuilding, not
# restarting.
FE_ENV="$APP_DIR/.env.production"
cat > "$FE_ENV" <<FEEOF
VITE_API_URL=https://$DOMAIN
VITE_FIREBASE_API_KEY=AIzaSyCx1hqJ9Q1xRwtu6O3jeOT_eMdgwE3zUZs
VITE_FIREBASE_AUTH_DOMAIN=poms-fad05.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=poms-fad05
VITE_FIREBASE_STORAGE_BUCKET=poms-fad05.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=575257818677
VITE_FIREBASE_APP_ID=1:575257818677:web:3823708636d4fc8592237c
VITE_FIREBASE_MEASUREMENT_ID=G-32J438GWVV
FEEOF
# No VITE_ALLOW_DEV_AUTH. Its absence is what turns the dev sign-in buttons off.

chown fidato:fidato "$ENV_FILE" "$FE_ENV" "$DB_PASS_FILE" 2>/dev/null || true

# -----------------------------------------------------------------------------
say "Build"
# -----------------------------------------------------------------------------
cd "$APP_DIR"
npm ci --omit=dev --prefix "$APP_DIR/api"
npm ci
npm run build
[ -d "$APP_DIR/dist" ] || die "No dist/ — the frontend build produced nothing."
# nginx reads dist/ as its own user and traverses every parent to reach it.
chown -R fidato:fidato "$APP_DIR"
chmod o+x "$APP_DIR" "$APP_DIR/dist"

# -----------------------------------------------------------------------------
say "nginx and TLS"
# -----------------------------------------------------------------------------
sed "s/__DOMAIN__/$DOMAIN/g; s#__ROOT__#$APP_DIR/dist#g" \
  "$APP_DIR/deploy/nginx.conf" > /etc/nginx/conf.d/fidato.conf
nginx -t || die "nginx rejected the configuration."
systemctl reload nginx

# Certbot edits the file in place and installs its own renewal timer.
if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" \
    --redirect || die "Certificate failed. Almost always DNS: $DOMAIN must
  already resolve to this box's public IP, and Oracle's VCN security list must
  allow 80 and 443. See deploy/README.md."
fi

# -----------------------------------------------------------------------------
say "The service"
# -----------------------------------------------------------------------------
sed "s#__APP_DIR__#$APP_DIR#g" "$APP_DIR/deploy/fidato-api.service" \
  > /etc/systemd/system/fidato-api.service
systemctl daemon-reload
systemctl enable fidato-api
systemctl restart fidato-api
sleep 3
systemctl is-active --quiet fidato-api \
  || die "The API did not start. journalctl -u fidato-api -n 50"

# -----------------------------------------------------------------------------
say "Backups"
# -----------------------------------------------------------------------------
# The free tier has no managed backups, so this cron entry IS the backup story.
# Nightly at 03:00, after any plausible night audit.
install -m 755 "$APP_DIR/db/backup.sh" /usr/local/bin/fidato-backup
cat > /etc/cron.d/fidato-backup <<'CRONEOF'
0 3 * * * root /usr/local/bin/fidato-backup >> /var/log/fidato-backup.log 2>&1
CRONEOF
echo "  nightly at 03:00 — ON THE SAME DISK. See README: a copy that dies in"
echo "  the same fire is not a backup. Getting it off-box is one more step."

# -----------------------------------------------------------------------------
say "Preflight"
# -----------------------------------------------------------------------------
cd "$APP_DIR/api"
if npm run --silent preflight; then
  printf "\n\033[32m  %s is live.\033[0m\n\n" "https://$DOMAIN"
else
  printf "\n\033[33m  Deployed, and NOT READY TO SERVE. Fix what preflight
  listed above, then re-run:  cd %s/api && npm run preflight\033[0m\n\n" "$APP_DIR"
  exit 1
fi
