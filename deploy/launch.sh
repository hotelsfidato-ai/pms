#!/usr/bin/env bash
# =============================================================================
# launch.sh — put this system on an Oracle Cloud box, once.
# =============================================================================
# Run ON the server, as a user with sudo:
#
#     git clone <repo> /opt/fidato && cd /opt/fidato
#     sudo DOMAIN=api.example.com EMAIL=you@example.com #          APP_ORIGIN=https://pms.example.com deploy/launch.sh
#
# DOMAIN is where the API answers. APP_ORIGIN is where the frontend is
# served from - Firebase Hosting - and is the origin the browser sends,
# so it is what CORS must allow. They are two different names on purpose:
# this box is a data server, and the app is a client of it exactly as the
# till and the CRS are. Several origins may be listed, comma-separated.
#
# Idempotent. Running it again upgrades in place: re-migrates, reinstalls API
# dependencies, restarts the service. It does NOT re-issue a certificate that
# is still valid, and it never touches the database beyond the migrations.
#
# TWO THINGS IT DOES NOT DO, both of which this comment used to claim:
#
#   · it does not `git pull`. You do that first, deliberately, so that what
#     is about to run as root is what you looked at.
#   · it does not build the frontend. That is built on YOUR machine with
#     `API_URL=https://<this domain> npm run build:app` and deployed to
#     Firebase Hosting. Building it here would drag a full toolchain onto a
#     2-OCPU box to produce assets Firebase serves anyway -- and the API
#     address it needs is a RUNTIME file, not a build flag.
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
APP_ORIGIN="${APP_ORIGIN:?set APP_ORIGIN=https://pms.example.com — where the frontend is served.
  This is the origin the browser sends and the only one CORS will accept. Get it
  wrong and every screen goes empty with no error a clerk can report.}"
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
  # ⚠ INSTALLING THE EPEL *RELEASE* PACKAGE IS NOT ENOUGH. It writes the
  # repository definition and Oracle Linux ships that definition DISABLED, so
  # the next line fails with "Unable to find a match: certbot" while the repo
  # sits there configured and switched off. The message names the package,
  # which sends you looking at the package.
  #
  # Enabled by name, and every name Oracle has used, because the repo id has
  # moved between OL8 and OL9 point releases. `|| true` throughout: a name
  # that does not exist on this image is not an error, it is one of the other
  # names being the right one.
  for repo in ol9_developer_EPEL ol8_developer_EPEL epel; do
    dnf config-manager --set-enabled "$repo" 2>/dev/null || true
  done

  # The web server and the database are NOT optional -- a failure here must
  # stop the run.
  dnf -y install nginx postgresql-server postgresql-contrib git

  # certbot IS optional while SKIP_TLS is set. Splitting it out so that a
  # machine which cannot reach EPEL can still finish the install and load its
  # data, rather than dying at a package it is not about to use.
  if ! dnf -y install certbot python3-certbot-nginx; then
    if [ "${SKIP_TLS:-}" = "1" ]; then
      echo "  ⚠ certbot is not available from this machine's repositories."
      echo "    Continuing, because SKIP_TLS=1 means no certificate is being"
      echo "    requested today. You will need it before the screens work:"
      echo "      sudo dnf config-manager --set-enabled ol9_developer_EPEL"
      echo "      sudo dnf -y install certbot python3-certbot-nginx"
    else
      die "certbot could not be installed, and a certificate is required.
  Enable EPEL and try again:
      sudo dnf config-manager --set-enabled ol9_developer_EPEL
  Or run with SKIP_TLS=1 to finish the install and add the certificate later."
    fi
  fi
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
say "SELinux"
# -----------------------------------------------------------------------------
# ⚠ WITHOUT THIS, nginx RETURNS 502 WHILE EVERYTHING IS HEALTHY.
#
# Oracle Linux ships SELinux enforcing, and its policy for the web server does
# not include "open a network connection" -- not even to 127.0.0.1. So nginx
# starts, the API starts, the API answers perfectly on localhost, and every
# request through the front door gets:
#
#     502 Bad Gateway
#
# Nothing in either program's log explains it, because neither program did
# anything wrong. A third thing refused to let them speak.
#
# Found on the first real Oracle Linux deploy, from outside, by curling the
# health endpoint over the internet -- which is the only place the fault is
# visible. `systemctl is-active` said active, and a local curl returned 200.
#
# -P writes it to policy. Without -P it is forgotten at the next reboot, and
# the system breaks weeks later with nobody remembering this step existed.
if command -v setsebool >/dev/null && [ "$(getenforce 2>/dev/null)" = "Enforcing" ]; then
  setsebool -P httpd_can_network_connect on
  echo "  httpd_can_network_connect on — nginx may reach the API"
else
  echo "  not enforcing, or not an SELinux system — nothing to do"
fi


# -----------------------------------------------------------------------------
# Oracle's free tier ships with almost everything shut, in TWO places: the
# instance's own firewall AND the VCN security list in the Oracle console.
# This handles the first. THE SECOND IS A WEB CONSOLE STEP AND CANNOT BE
# SCRIPTED — see deploy/README.md. A box that passes this script and is still
# unreachable is almost always the VCN.
# ⚠ THIS RELOAD DELETES THE NETWORK RULES OF EVERY RUNNING CONTAINER.
#   Podman (netavark) writes the rules that let a container reach the
#   internet and let this box reach the container, and a firewalld reload
#   throws them away. n8n runs in a container here: from 10 September every
#   PMS deploy silently cut it off in both directions, and nothing said so.
#   Found 16 September — 0 netavark rules on the box, n8n healthy inside its
#   container and unreachable from outside it (MEMORY 279).
#   The fix is on the SERVER, not here: `netavark-firewalld-reload.service`,
#   shipped with netavark, puts the rules back after every reload. It must
#   stay ENABLED. Do not remove this reload to "fix" n8n — the box needs
#   http and https open, and the service is what keeps both working.
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
# ⚠ THIS LINE HAD A LITERAL BACKSLASH-n IN IT INSTEAD OF A LINE
# CONTINUATION, so the shell ran `id -u fidato n` -- two operands, which `id`
# always rejects. The guard therefore NEVER held: useradd ran on every pass,
# and on the second one it exits 9 with "user 'fidato' already exists". With
# `set -e` that aborted the whole script.
#
# So this worked exactly once per box, and the README says in its second
# sentence: "Run it again any time to upgrade." Every upgrade died here --
# before migrations, before the build, before the service restart.
if ! id -u fidato >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin fidato
fi
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

# ── The identity the PREFLIGHT reads with ───────────────────────────────────
# ⚠ THIS USED TO BE `postgres` OVER A PEER-AUTHENTICATED SOCKET, AND NOTHING
# COULD USE IT. Peer authentication means the operating-system user must have
# the same name as the database user -- so only the `postgres` account can be
# `postgres`. The preflight runs as `fidato`, and launch.sh runs it as root.
# Neither is `postgres`, so the check failed with
#
#     Peer authentication failed for user "postgres"
#
# on a database that was perfectly healthy. The check that exists to say
# whether the system is ready could not run, which is the worst possible
# thing for it to do quietly.
#
# So: a database role named for the OS account that actually runs the check.
# Peer authentication then works with no password anywhere.
#
# READ EVERYTHING, WRITE NOTHING. `pg_read_all_data` plus `bypassrls` is
# exactly what a checking tool needs: the preflight MUST see past row level
# security, because a check that reads an empty result reports all clear.
# It has no business changing anything, and cannot.
DB_USER_ADMIN="${DB_USER_ADMIN:-fidato}"

sudo -u postgres psql -tAc   "select 1 from pg_roles where rolname='$DB_USER_ADMIN'" | grep -q 1 ||   sudo -u postgres psql -qc "create role $DB_USER_ADMIN login bypassrls"
sudo -u postgres psql -qc "alter role $DB_USER_ADMIN bypassrls"
sudo -u postgres psql -qc "grant pg_read_all_data to $DB_USER_ADMIN"


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
# ⚠ THIS WAS ITS OWN LOOP, ONE psql PER FILE, AND THAT BROKE THE LIVE APP ON
# EVERY UPGRADE.
#
# The migrations are re-runnable, so an upgrade replays all of them from 001.
# One transaction per file means every intermediate state is visible to
# whoever is using the system -- and 001 installs an app.current_user_id()
# that 017 replaces. The API sets app.user_id to the FIREBASE UID, so for the
# sixteen migrations in between, every signed-in request 500s. Measured on the
# identical loop in db/migrate.sh: 53 failures in 400 requests.
#
# db/migrate.sh was fixed for exactly this and THIS COPY STILL CARRIED IT.
# One runner. A rule written in two places is wrong in one of them.
#
# Over the unix socket as `postgres`: peer authentication, no password
# anywhere, and the role that owns the schema.
sudo -u postgres env \
  PGHOST=/var/run/postgresql PGPORT=5432 SUPER=postgres DB="$DB_NAME" \
  bash "$APP_DIR/db/migrate.sh" \
  || die "Migrations failed. The database is exactly as it was: the whole
  run is one transaction and it rolled back."

# -----------------------------------------------------------------------------
say "Configuration"
# -----------------------------------------------------------------------------
ENV_FILE="$APP_DIR/api/.env"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<ENVEOF
DATABASE_URL=postgres://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME
ADMIN_DATABASE_URL=postgres://$DB_USER_ADMIN@/$DB_NAME?host=/var/run/postgresql
PORT=8787
NODE_ENV=production
CORS_ORIGIN=$APP_ORIGIN
FIREBASE_PROJECT_ID=poms-fad05
# Paste the WHOLE service account JSON on one line. Not a path to it.
FIREBASE_SERVICE_ACCOUNT=
ENVEOF
  chmod 600 "$ENV_FILE"
  echo "  wrote api/.env — FIREBASE_SERVICE_ACCOUNT is still empty"
else
  # An existing file is never overwritten; only the origin is kept current,
  # because that is the one value a re-run can legitimately change.
  sed -i "s#^CORS_ORIGIN=.*#CORS_ORIGIN=$APP_ORIGIN#" "$ENV_FILE"
  echo "  api/.env kept (CORS origin refreshed)"
fi

# NOTHING VITE_* IS WRITTEN HERE ANY MORE. The frontend is built and
# deployed to Firebase Hosting, not served off this box, and it resolves
# this API's address at RUNTIME from its own config.json - see
# src/lib/api.ts. That is what lets the backend move to another provider
# without rebuilding every client that talks to it.

# -----------------------------------------------------------------------------
# Where uploaded bills live
# -----------------------------------------------------------------------------
# ⚠ OUTSIDE THE CHECKOUT, DELIBERATELY. A deploy that re-clones or resets
# /opt/fidato would take the hotel's purchase invoices with it -- and a GST
# invoice is a document the property has to be able to produce years later.
#
# On the same disk as the database for now, which means the same warning the
# backup carries: a copy that dies in the same fire is not a copy. The Drive
# mirror (n8n) and Object Storage are both answers to that, and the
# `attachments` row records WHICH store holds each file so either can arrive
# without a migration.
UPLOAD_DIR="${UPLOAD_DIR:-/var/lib/fidato/uploads}"
install -d -o fidato -g fidato -m 700 "$UPLOAD_DIR"
if ! grep -q '^UPLOAD_DIR=' "$ENV_FILE"; then
  echo "UPLOAD_DIR=$UPLOAD_DIR" >> "$ENV_FILE"
fi
echo "  $UPLOAD_DIR"

chown fidato:fidato "$ENV_FILE" "$DB_PASS_FILE" 2>/dev/null || true

# -----------------------------------------------------------------------------
say "Build"
# -----------------------------------------------------------------------------
cd "$APP_DIR"
# API dependencies only. The frontend is not built here: `npm ci` across the
# whole workspace drags a full toolchain onto a 2-OCPU box to produce assets
# that Firebase serves anyway.
npm ci --omit=dev --prefix "$APP_DIR/api"
chown -R fidato:fidato "$APP_DIR"

# -----------------------------------------------------------------------------
say "nginx and TLS"
# -----------------------------------------------------------------------------
sed "s/__DOMAIN__/$DOMAIN/g" \
  "$APP_DIR/deploy/nginx.conf" > /etc/nginx/conf.d/fidato.conf
nginx -t || die "nginx rejected the configuration."
systemctl reload nginx

# Certbot edits the file in place and installs its own renewal timer.
# ── When the certificate cannot be issued YET ───────────────────────────────
# SKIP_TLS=1 installs everything and leaves the API on plain http.
#
# A real situation, not a convenience: DNS is often somebody else's to change.
# A stray AAAA record is the common one -- Let's Encrypt prefers IPv6 when a
# name has both, and falls back to IPv4 only if the IPv6 address is completely
# dead. Point it at a parking page and validation fails against a server that
# answered perfectly well, with the wrong content.
#
# Without this flag the run DIES here, so the service, the backups and the
# preflight never happen -- and whoever ran it is left with a half-built box
# and no obvious reason why. Worse, Let's Encrypt allows five failures per
# hostname per hour, so the natural response (retry) locks them out for the
# afternoon.
#
# ⚠ THE APP CANNOT TALK TO A PLAIN-HTTP API. A page served over https may not
# call http, and the browser blocks it without showing anybody an error. This
# is a state for finishing the install and loading data -- NOT a state to give
# anybody a link to.
if [ "${SKIP_TLS:-}" = "1" ]; then
  say "TLS — SKIPPED"
  echo "  No certificate was requested. The API answers on http only."
  echo "  When DNS is ready, finish it with one command:"
  echo ""
  echo "    sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m $EMAIL --redirect"
  echo ""
  echo "  The screens will not work until that is done."
elif [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  # ⚠ THE CERTIFICATE SURVIVED A RE-RUN. ITS NGINX CONFIG DID NOT.
  #
  # Twenty lines above, this script OVERWRITES /etc/nginx/conf.d/fidato.conf
  # from the template. Certbot's 443 server block lives in that file, so every
  # re-run erased it — and the old condition here (`if the cert does NOT
  # exist`) then skipped certbot precisely because the certificate DID exist.
  #
  # The result, on 8 September: an upgrade that reported success at every
  # step, with nginx listening on port 80 only, the API unreachable, and the
  # app calling https into a server that had stopped speaking it. Nothing in
  # the run said so. `curl` from outside said `Failed to connect ... port 443`.
  #
  # README promised "run it again any time to upgrade" and "leaves the
  # certificate alone". The certificate was indeed left alone. The
  # configuration that USES it was not, and that is the distinction that cost
  # an outage.
  #
  # `certbot install` re-applies an existing certificate to the freshly
  # written config. It does not talk to Let's Encrypt, so it cannot fail on
  # DNS and cannot burn the five-failures-per-hour allowance.
  say "TLS — reinstalling into the rewritten config"
  certbot install --cert-name "$DOMAIN" --nginx \
    || die "The certificate exists but could not be re-applied to nginx.
  The API is reachable on port 80 only, which the app cannot use. Try:
    sudo certbot install --cert-name $DOMAIN --nginx"
  nginx -t || die "nginx rejected the configuration certbot just wrote."
  systemctl reload nginx
else
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" \
    --redirect || die "Certificate failed. Almost always DNS: $DOMAIN must
  already resolve to this box's public IP, and Oracle's VCN security list must
  allow 80 and 443. See deploy/README.md."
fi

# ⚠ ISSUING IS HALF OF TLS, AND THIS SCRIPT ONLY EVER DID THAT HALF.
#
# Oracle Linux installs certbot-renew.timer DISABLED ("preset: disabled").
# Every branch above issues or re-applies a certificate and none of them
# turned renewal on, so a Let's Encrypt certificate -- 90 days -- simply ran
# out. Found on 10 September while preparing deploy/n8n.sh:
#
#     certbot-renew.timer   loaded; disabled; inactive (dead)
#     api.fidatohotels.com  notAfter=Dec  7 03:45:33 2026 GMT
#
# On 7 December every screen would have stopped reaching the API, with a
# browser certificate error that says nothing about a timer. Enabling it is
# idempotent and costs nothing on a box where it is already on.
if [ "${SKIP_TLS:-}" != "1" ]; then
  systemctl enable --now certbot-renew.timer >/dev/null 2>&1 \
    || echo "  ⚠ could not enable certbot-renew.timer -- renew by hand before expiry"
  echo "  certificates renew themselves (certbot-renew.timer)"
fi

# -----------------------------------------------------------------------------
say "Can the server actually load this code"
# -----------------------------------------------------------------------------
# ⚠ BEFORE THE RESTART, NOT AFTER. The service runs
# `node --experimental-strip-types`, which erases types and emits nothing — so
# a parameter property, an enum or a namespace is valid TypeScript that this
# box cannot load. `tsc` accepts all three; every local gate passed; and on
# 8 September one parameter property in till.ts left the API crash-looping
# after a deploy that reported success right up to the restart.
#
# Checked here rather than only on a laptop because this is the one machine
# whose answer counts, and because "it built fine locally" is exactly what was
# true that day.
if [ -f "$APP_DIR/api/scripts/strip-check.mjs" ]; then
  ( cd "$APP_DIR/api" && node scripts/strip-check.mjs ) \
    || die "The server cannot load this code. NOTHING HAS BEEN RESTARTED - the
    API is still running whatever it was running before. Fix the file named
    above, push, pull, and run this again."
else
  printf "  (no strip-check in this checkout - skipping)\n"
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

# Runs as `postgres`, NOT root. The script reaches the database over the unix
# socket under peer authentication, and root is not postgres. Scheduled as root
# it would fail every night into a log nobody reads - which is exactly how this
# system spent its first weeks believing it had backups.
BACKUP_DIR="${BACKUP_DIR:-/var/backups/fidato}"
install -d -o postgres -g postgres -m 700 "$BACKUP_DIR"
: > /var/log/fidato-backup.log
chown postgres:postgres /var/log/fidato-backup.log
cat > /etc/cron.d/fidato-backup <<CRONEOF
0 3 * * * postgres /usr/local/bin/fidato-backup $BACKUP_DIR >> /var/log/fidato-backup.log 2>&1
CRONEOF

# Prove it works NOW rather than finding out at 03:00 that it never did.
runuser -u postgres -- /usr/local/bin/fidato-backup "$BACKUP_DIR"   || die "The nightly backup failed on its very first run. Fix this before
  anything else - every other failure here is recoverable and this one is not."
echo "  nightly at 03:00 — ON THE SAME DISK. See README: a copy that dies in"
echo "  the same fire is not a backup. Getting it off-box is one more step."

# -----------------------------------------------------------------------------
say "Preflight"
# -----------------------------------------------------------------------------
cd "$APP_DIR/api"
# ⚠ RUN AS THE DATABASE USER'S NAMESAKE, NOT AS ROOT.
#
# ADMIN_DATABASE_URL reaches Postgres over the unix socket, which is PEER
# authenticated: the operating system user must have the same name as the
# database role. This script runs under sudo, so the OS user is `root`, and
# root can never be `fidato`. The check therefore failed on every single run
# with
#
#     ✗ database reachable
#         Peer authentication failed for user "fidato"
#
# and reported a healthy box as NOT READY TO SERVE. Defect 192 named this and
# fixed the missing role; it did not fix who runs the check.
#
# The service account and the admin role share a name ON PURPOSE — that is
# what makes peer authentication work without a password anywhere. HOME is
# set because the account deliberately has no home directory and npm needs
# somewhere to write.
if sudo -u "$DB_USER_ADMIN" env HOME=/tmp npm run --silent preflight; then
  if [ "${SKIP_TLS:-}" = "1" ]; then
    printf "\n\033[33m  Installed. The API answers on http://%s\n" "$DOMAIN"
    printf "  NO CERTIFICATE YET -- and the app CANNOT reach an http API.\n"
    printf "  A page served over https may not call http, and the browser\n"
    printf "  blocks it without showing anybody an error. Finish with:\n\n"
    printf "    sudo certbot --nginx -d %s --non-interactive --agree-tos -m %s --redirect\033[0m\n\n" "$DOMAIN" "$EMAIL"
  else
  printf "\n\033[32m  %s is live.\033[0m\n\n" "https://$DOMAIN"
  fi
else
  printf "\n\033[33m  Deployed, and NOT READY TO SERVE. Fix what preflight
  listed above, then re-run:  cd %s/api && npm run preflight\033[0m\n\n" "$APP_DIR"
  exit 1
fi
