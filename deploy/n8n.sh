#!/usr/bin/env bash
# =============================================================================
# n8n.sh — workflow automation beside the PMS, on the same box, kept apart
# =============================================================================
# Run ON the server, as a user with sudo:
#
#   sudo N8N_DOMAIN=n8n.fidatohotels.com EMAIL=you@example.com \
#        ALLOW_FROM=${SSH_CLIENT%% *} deploy/n8n.sh
#       installs n8n and publishes it -- reachable ONLY from ALLOW_FROM, the
#       address you are connected from, until you have created its owner
#
#   sudo deploy/n8n.sh open
#       removes that restriction so webhooks from the outside world work.
#       Rewrites the nginx site and touches nothing else.
#
# ⚠ `${SSH_CLIENT%% *}` MUST STAY ON THE COMMAND LINE. sudo strips SSH_CLIENT
# from the environment, and `who am i` prints nothing without a terminal --
# both checked on the box on 10 September. Written before `deploy/n8n.sh`,
# YOUR shell expands it before sudo ever runs.
#
# Idempotent. Running it again upgrades in place: pulls the pinned image,
# rewrites the configuration, restarts. It NEVER regenerates the encryption
# key, and it never touches the hotel's database.
#
# WHY A CONTAINER, AND NOT `npm install -g n8n` BESIDE THE API
#
#   n8n runs code people write -- a Code node is arbitrary JavaScript, and a
#   workflow imported from the internet is somebody else's arbitrary
#   JavaScript. This box also holds the hotel's database and `api/.env`, which
#   carries the Firebase Admin private key. Installed as a Node package it
#   would share a filesystem with both. In a container it sees its own data
#   volume and nothing else:
#
#     · no /opt/fidato, so no api/.env and no Firebase key
#     · no 127.0.0.1:5432 -- Postgres listens on the host's loopback, and the
#       container's loopback is its own. n8n CANNOT reach the hotel's
#       database, which is the point: every rule the PMS enforces lives in
#       the API, and a workflow that wrote a folio posting directly would
#       bypass the append-only ledger, the tax rules and the audit log.
#     · capped at 2 GB and one CPU, so a runaway workflow cannot starve the
#       API and Postgres on a two-CPU machine
#
#   It reaches the PMS the way a person does -- https://api.fidatohotels.com,
#   signed in as its own staff account. Checked on 10 September: the box can
#   reach its own public address (hairpin), so that works from inside.
#
# THE OWNER ACCOUNT IS CLAIMED BY WHOEVER ARRIVES FIRST
#
#   A fresh n8n shows a setup page, and the first visitor becomes its owner.
#   A new certificate is published to Certificate Transparency logs within
#   minutes, and there are scanners that read those logs looking for exactly
#   this -- fresh n8n and WordPress installs with an unclaimed setup page. So
#   the site goes up reachable only from YOUR address, and opens to the world
#   when you say so, after the owner exists.
# =============================================================================
set -euo pipefail

N8N_VERSION="${N8N_VERSION:-2.38.5}"      # pinned; checked for arm64 on 10 Sep
N8N_DOMAIN="${N8N_DOMAIN:-n8n.fidatohotels.com}"
EMAIL="${EMAIL:-}"
MODE="${1:-install}"

ENV_DIR=/etc/n8n
ENV_FILE=$ENV_DIR/n8n.env
KEY_FILE=$ENV_DIR/encryption-key
OPEN_MARK=$ENV_DIR/open-to-the-world
QUADLET=/etc/containers/systemd/n8n.container
SITE=/etc/nginx/conf.d/n8n.conf
WEBROOT=/var/www/letsencrypt
BACKUP_DIR=/var/backups/n8n
CERT_DIR=/etc/letsencrypt/live/$N8N_DOMAIN
IMAGE="docker.io/n8nio/n8n:$N8N_VERSION"

say() { printf "\n\033[1m-- %s\033[0m\n" "$1"; }
ok()  { printf "  \033[32mOK\033[0m %s\n" "$1"; }
die() { printf "\n\033[31m  x %s\033[0m\n\n" "$1" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "Run with sudo."

case "$MODE" in
  install) ;;
  open)
    # The first version re-ran everything on `open`, which restarted n8n
    # under the person who had just created its owner and was still in it.
    [ -f "$ENV_FILE" ] || die "n8n is not installed yet. Run the install first."
    touch "$OPEN_MARK"
    ;;
  *) die "Unknown mode '$MODE'. Use no argument, or 'open'." ;;
esac

# =============================================================================
# Everything that is not nginx. Skipped by `open`.
# =============================================================================
install_runtime() {
  say "Certificates renew themselves"
  # ⚠ THIS WAS OFF ON THE BOX, FOR THE API AS WELL. Oracle Linux ships
  # certbot-renew.timer disabled ("preset: disabled"), and launch.sh issued
  # api.fidatohotels.com's certificate without ever enabling it. Found on
  # 10 September while preparing this script: that certificate expires on
  # 7 December 2026, and on that day every screen of the PMS would have
  # stopped reaching the API. launch.sh now enables it too.
  systemctl enable --now certbot-renew.timer >/dev/null
  ok "certbot-renew.timer enabled"

  say "Podman"
  command -v podman >/dev/null || dnf install -y -q podman
  ok "$(podman --version)"

  say "Configuration"
  install -d -m 700 "$ENV_DIR"
  # ⚠ THE ENCRYPTION KEY IS CREATED ONCE AND NEVER AGAIN. n8n encrypts every
  # credential it stores -- the PMS password, a WhatsApp token -- with it. A
  # new key on a re-run would leave every saved credential unreadable,
  # silently, the first time a workflow used one. It lives in a file of its
  # own so the rest of the configuration can be rewritten freely around it.
  if [ ! -s "$KEY_FILE" ]; then
    ( umask 077; openssl rand -hex 32 > "$KEY_FILE" )
    ok "encryption key created -- without it, saved credentials are lost"
  else
    ok "encryption key kept"
  fi

  ( umask 077; cat > "$ENV_FILE" <<EOF
# Written by deploy/n8n.sh. Rewritten on every run -- edit the script, not this.
N8N_HOST=$N8N_DOMAIN
N8N_PROTOCOL=https
N8N_PORT=5678
WEBHOOK_URL=https://$N8N_DOMAIN/
N8N_EDITOR_BASE_URL=https://$N8N_DOMAIN/
# Behind nginx: trust one proxy for the client address.
N8N_PROXY_HOPS=1
# The hotel's clock. A "run at 7am" schedule means 7am in Akkalkot.
GENERIC_TIMEZONE=Asia/Kolkata
TZ=Asia/Kolkata
N8N_DIAGNOSTICS_ENABLED=false
N8N_ENCRYPTION_KEY=$(cat "$KEY_FILE")
EOF
  )
  ok "$ENV_FILE"

  say "The container"
  # Pulled here rather than on first start, so a slow or failed download is
  # a visible step with an error, not a service that times out with none.
  podman pull -q "$IMAGE" >/dev/null
  ok "$IMAGE"

  install -d /etc/containers/systemd
  cat > "$QUADLET" <<EOF
# Written by deploy/n8n.sh.
[Unit]
Description=n8n workflow automation
After=network-online.target
Wants=network-online.target

[Container]
Image=$IMAGE
ContainerName=n8n
# Loopback only. nginx is the one door in; the firewall is the second, and a
# service that relies on the firewall alone is one rule change from exposed.
PublishPort=127.0.0.1:5678:5678
# :U gives the volume to the container's own user so n8n can write to it.
Volume=n8n_data:/home/node/.n8n:U
EnvironmentFile=$ENV_FILE
# Two CPUs on this box. n8n gets one of them, and 2 GB of the ten, so the
# hotel's API and database always have room whatever a workflow does.
PodmanArgs=--memory=2g --cpus=1

[Service]
Restart=always
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl restart n8n.service

  local i
  for i in $(seq 1 60); do
    curl -fsS --max-time 2 http://127.0.0.1:5678/healthz >/dev/null 2>&1 && break
    [ "$i" = 60 ] && die "n8n did not answer on 127.0.0.1:5678 within two minutes.
  Look at:  journalctl -u n8n -n 60 --no-pager"
    sleep 2
  done
  ok "n8n answers on 127.0.0.1:5678"
}

install_backups() {
  say "Backups"
  # The nightly fidato-backup dumps the hotel's database and nothing else.
  # n8n's workflows and credentials live in its own volume, and the
  # credentials are useless without the key file -- so both go together.
  install -d -m 700 "$BACKUP_DIR"
  cat > /usr/local/bin/n8n-backup <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
D=/var/backups/n8n; T=$(date +%Y%m%d-%H%M%S)
podman volume export n8n_data > "$D/n8n-data-$T.tar"
cp /etc/n8n/encryption-key "$D/encryption-key-$T"
chmod 600 "$D/n8n-data-$T.tar" "$D/encryption-key-$T"
# Fourteen nights. The PMS keeps its own backups; these are workflows only.
find "$D" -type f -mtime +14 -delete
echo "n8n backed up: n8n-data-$T.tar"
EOF
  chmod 700 /usr/local/bin/n8n-backup
  echo "30 3 * * * root /usr/local/bin/n8n-backup >> /var/log/n8n-backup.log 2>&1" \
    > /etc/cron.d/n8n-backup
  /usr/local/bin/n8n-backup >/dev/null
  ok "nightly at 03:30 into $BACKUP_DIR -- ON THE SAME DISK, like the PMS's"
}

# =============================================================================
say "Is the name pointing here"
# =============================================================================
# certbot fails with a paragraph about ACME challenges if it is not, and the
# paragraph does not say "you have not added the DNS record yet".
HERE="$(curl -s -4 --max-time 8 ifconfig.me || true)"
THERE="$(getent ahostsv4 "$N8N_DOMAIN" | awk 'NR==1{print $1}' || true)"
[ -n "$THERE" ] || die "$N8N_DOMAIN does not resolve yet.
  Add an A record:  $N8N_DOMAIN  ->  ${HERE:-the public IP of this server}
  then wait a few minutes and run this again."
if [ -n "$HERE" ] && [ "$THERE" != "$HERE" ]; then
  die "$N8N_DOMAIN points at $THERE, and this server is $HERE.
  Fix the A record, wait for it to spread, and run this again."
fi
ok "$N8N_DOMAIN -> $THERE"

if [ "$MODE" = "install" ]; then install_runtime; fi

# =============================================================================
say "nginx and TLS"
# =============================================================================
# ⚠ THIS SCRIPT OWNS THE WHOLE FILE AND CERTBOT ONLY ISSUES. launch.sh let
# `certbot --nginx` edit its site in place, then overwrote that file on the
# next upgrade and destroyed the TLS block (defect 211). Here the certificate
# comes from `certonly --webroot`, which edits no nginx config at all, and
# the site is written in full every time with the certificate paths in it.
# Re-running this can never lose TLS.
install -d -m 755 "$WEBROOT"
restorecon -R "$WEBROOT" 2>/dev/null || true

if [ ! -f "$CERT_DIR/fullchain.pem" ]; then
  [ -n "$EMAIL" ] || die "EMAIL is needed for the first certificate."
  # Port 80 only, long enough to prove the name is ours.
  cat > "$SITE" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $N8N_DOMAIN;
    location /.well-known/acme-challenge/ { root $WEBROOT; }
    location / { return 404; }
}
EOF
  nginx -t -q && systemctl reload nginx
  certbot certonly --webroot -w "$WEBROOT" -d "$N8N_DOMAIN" \
    --non-interactive --agree-tos -m "$EMAIL" \
    --deploy-hook "systemctl reload nginx" >/dev/null
  ok "certificate issued for $N8N_DOMAIN"
else
  ok "certificate present -- $(openssl x509 -enddate -noout -in "$CERT_DIR/cert.pem" | cut -d= -f2)"
fi

# Who may reach it until it is opened.
ALLOW_LINES=""
if [ ! -f "$OPEN_MARK" ]; then
  ADMIN_IP="${ALLOW_FROM:-}"
  if [ -z "$ADMIN_IP" ]; then
    ADMIN_IP="$(who am i 2>/dev/null | sed -nE 's/.*\(([0-9.]+)\).*/\1/p')"
  fi
  [ -n "$ADMIN_IP" ] || die "Could not tell which address you are connecting from.
  Put this in front of the command, so YOUR shell expands it before sudo:
    ALLOW_FROM=\${SSH_CLIENT%% *}"
  # A stray word here would become an nginx directive. Dotted numbers only.
  [[ "$ADMIN_IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] \
    || die "ALLOW_FROM='$ADMIN_IP' is not an IPv4 address."
  ALLOW_LINES="        allow $ADMIN_IP;
        deny all;"
fi

cat > "$SITE" <<EOF
# Written by deploy/n8n.sh -- rewritten on every run. Edit the script.

# The editor keeps a websocket open to the server. Named for n8n so it
# cannot collide with a map anybody later adds for the API.
map \$http_upgrade \$n8n_connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    listen [::]:80;
    server_name $N8N_DOMAIN;
    location /.well-known/acme-challenge/ { root $WEBROOT; }
    location / { return 301 https://\$host\$request_uri; }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name $N8N_DOMAIN;

    ssl_certificate     $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Workflows move files. The default of 1 MB refuses a single photo.
    client_max_body_size 50m;

    location / {
$ALLOW_LINES
        proxy_pass http://127.0.0.1:5678;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$n8n_connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        # A long-running workflow or a held webhook is not a dead one.
        proxy_read_timeout 300s;
        proxy_buffering off;
    }
}
EOF
nginx -t -q || die "nginx rejected the site. Nothing was reloaded; the API is unaffected."
systemctl reload nginx
if [ -n "$ALLOW_LINES" ]; then
  ok "https://$N8N_DOMAIN -- reachable ONLY from $ADMIN_IP"
else
  ok "https://$N8N_DOMAIN -- open to the world"
fi

if [ "$MODE" = "install" ]; then install_backups; fi

# =============================================================================
if [ "$MODE" = "open" ]; then
  printf "\n\033[32m  n8n is open to the world at https://%s\033[0m\n\n" "$N8N_DOMAIN"
elif [ ! -f "$OPEN_MARK" ]; then
  printf "\n\033[32m  n8n is running at https://%s\033[0m\n" "$N8N_DOMAIN"
  printf "\n  1. Open it now and create the owner account. Only you can reach it.\n"
  printf "  2. Then:  sudo deploy/n8n.sh open\n\n"
else
  printf "\n\033[32m  n8n is running at https://%s\033[0m\n\n" "$N8N_DOMAIN"
fi
