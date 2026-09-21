#!/usr/bin/env bash
# =============================================================================
# n8n.sh — workflow automation beside the PMS, on the same box, kept apart
# =============================================================================
# Run ON the server, as a user with sudo:
#
#   sudo N8N_DOMAIN=n8n.fidatohotels.com EMAIL=you@example.com \
#        ALLOW_FROM=${SSH_CLIENT%% *} deploy/n8n.sh
#       installs n8n and publishes it. The n8n SCREEN answers only
#       ALLOW_FROM, the address you are connected from. Webhooks --
#       /webhook/, /webhook-test/, /webhook-waiting/ -- answer anybody,
#       because an outside service calling a workflow is the point of them.
#       The address is saved, so later runs do not need it again.
#
#   sudo ALLOW_FROM=${SSH_CLIENT%% *} deploy/n8n.sh allow
#       YOUR INTERNET ADDRESS CHANGED. Most broadband here gets a new one
#       when the router restarts, and the n8n screen then says so and shows
#       the new address. SSH always works; this swaps the saved address and
#       reloads nginx. n8n itself is not restarted.
#
#   sudo deploy/n8n.sh lock       everything, webhooks too, answers only you
#   sudo deploy/n8n.sh webhooks   back to the default: screen locked, webhooks open
#   sudo deploy/n8n.sh open       everything answers everybody -- the screen is
#                                 then protected by its login alone
#       All three rewrite the nginx site and touch nothing else.
#
#   Chosen by the owner on 14 September: "screen locked, webhooks open",
#   on an address that changes. That is why it is the default and why
#   `allow` exists.
#
#   sudo deploy/n8n.sh local
#       n8n with NO domain yet. Installs and runs it on 127.0.0.1:5678 and
#       stops there -- no DNS, no nginx, no certificate. You reach it through
#       an SSH tunnel from your own machine:
#
#         ssh -i <key> -L 5678:127.0.0.1:5678 opc@api.fidatohotels.com
#         then open  http://localhost:5678
#
#       Asked for on 10 September: "the domain can wait, I just need to
#       start with n8n first". Nothing new faces the internet, so the
#       claimed-by-whoever-arrives-first setup page is reachable by you
#       alone. Webhooks from outside cannot arrive until the domain exists
#       -- that is the one thing local mode cannot do. Run the ordinary
#       install later; workflows, credentials and the owner all carry over.
#
# ⚠ `${SSH_CLIENT%% *}` MUST STAY ON THE COMMAND LINE. sudo strips SSH_CLIENT
# from the environment, and `who am i` prints nothing without a terminal --
# both checked on the box on 10 September. Written before `deploy/n8n.sh`,
# YOUR shell expands it before sudo ever runs.
#
# Idempotent. Running it again upgrades in place: pulls the pinned image,
# BACKS UP THE CURRENT DATA, rewrites the configuration, restarts. It NEVER
# regenerates the encryption key, and it never touches the hotel's database.
#
# TO UPDATE n8n, name the version on the command line:
#
#   sudo N8N_VERSION=2.40.0 deploy/n8n.sh      # and move the pin below to match
#
# The version is PINNED, so n8n never updates itself behind your back -- a
# workflow that ran on Friday is not broken on Monday by a release nobody
# chose. Versions: https://github.com/n8n-io/n8n/releases
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
#   the screen goes up reachable only from YOUR address and stays that way.
#   Opening the webhook paths from the first minute is safe: they run only
#   workflows that exist and are switched on, and a fresh install has none.
# =============================================================================
set -euo pipefail

# PINNED, AND THE PIN IS WHAT RUNS. The version is not saved on the box, so
# a plain `sudo deploy/n8n.sh` installs THIS number whatever is running. n8n
# migrates its database forward on start and does not migrate it back: a
# rerun with an older pin than the box has is a downgrade onto a newer
# database. Upgrade the box and this line together, never one alone.
#   16 Sep  2.38.5 -> 2.39.6 (stable), arm64 image checked on Docker Hub;
#           the box was upgraded with N8N_VERSION=2.39.6 the same day.
N8N_VERSION="${N8N_VERSION:-2.39.6}"
N8N_DOMAIN="${N8N_DOMAIN:-n8n.fidatohotels.com}"
EMAIL="${EMAIL:-}"
MODE="${1:-install}"

ENV_DIR=/etc/n8n
ENV_FILE=$ENV_DIR/n8n.env
KEY_FILE=$ENV_DIR/encryption-key
# Who the site answers. Two small files rather than flags on the command
# line, because the ordinary UPGRADE -- `sudo N8N_VERSION=... deploy/n8n.sh`
# -- carries neither. The first version read the address from ALLOW_FROM on
# every run, so an upgrade restarted n8n and then died at the nginx step
# asking for an address nobody had passed. Found on 14 September, reading.
ACCESS_FILE=$ENV_DIR/access          # webhooks | lock | open
ALLOW_FILE=$ENV_DIR/allow-from       # the one address the screen answers
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
  install|local) ;;
  webhooks|lock|open|allow)
    # nginx only. The first version re-ran everything on `open`, which
    # restarted n8n under the person who had just created its owner and
    # was still in it.
    [ -f "$CERT_DIR/fullchain.pem" ] \
      || die "n8n is not on $N8N_DOMAIN yet. Run the install first."
    ;;
  *) die "Unknown mode '$MODE'. Use no argument, or one of:
  local, allow, webhooks, lock, open" ;;
esac

# =============================================================================
# Where n8n thinks it lives. Local mode is reached through an SSH tunnel at
# http://localhost:5678; the ordinary install is https on the domain.
# =============================================================================
address_settings() {
  if [ "$MODE" = "local" ]; then
    cat <<EOF
N8N_HOST=localhost
N8N_PROTOCOL=http
N8N_PORT=5678
WEBHOOK_URL=http://localhost:5678/
N8N_EDITOR_BASE_URL=http://localhost:5678/
# ⚠ SECURE COOKIES OFF, AND ONLY HERE. They are refused over plain http,
# and n8n would sign you in and immediately forget you. It is safe in THIS
# mode only because the one way in is your SSH tunnel -- encrypted and
# authenticated by your key -- and the port is bound to loopback. The
# ordinary install writes this file again, with https and the default on.
N8N_SECURE_COOKIE=false
EOF
  else
    cat <<EOF
N8N_HOST=$N8N_DOMAIN
N8N_PROTOCOL=https
N8N_PORT=5678
WEBHOOK_URL=https://$N8N_DOMAIN/
N8N_EDITOR_BASE_URL=https://$N8N_DOMAIN/
# Behind nginx: trust one proxy for the client address.
N8N_PROXY_HOPS=1
EOF
  fi
}

# =============================================================================
# Everything that is not nginx. Skipped by allow, webhooks, lock and open.
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
$(address_settings)
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

  # ⚠ BACK UP BEFORE THE NEW VERSION STARTS, NOT AFTER. The backup step
  # further down runs once n8n is already up -- and on an upgrade that is
  # AFTER the new version has migrated its database. n8n does not migrate
  # backwards, so a broken release would leave last night's copy as the
  # only way back. Asked on 10 September: "if I need to update n8n, which
  # route do I go" -- and the honest answer was "back up by hand first",
  # which is a step people skip. Now the script does it.
  #
  # Only when there is something to protect: a first install has no volume
  # yet and no backup tool, and there is nothing to lose.
  if podman volume exists n8n_data && [ -x /usr/local/bin/n8n-backup ]; then
    /usr/local/bin/n8n-backup >/dev/null
    ok "backed up the current data before switching to $N8N_VERSION"
  fi

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

if [ "$MODE" != "local" ]; then
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
fi

case "$MODE" in install|local) install_runtime ;; esac

if [ "$MODE" = "local" ]; then
  install_backups
  printf "\n\033[32m  n8n is running on this server at 127.0.0.1:5678 -- nowhere else.\033[0m\n"
  printf "\n  On YOUR machine, in a new PowerShell window, open the tunnel and leave it open:\n"
  printf "    ssh -i <your key> -L 5678:127.0.0.1:5678 %s@%s\n" "${SUDO_USER:-opc}" "api.fidatohotels.com"
  printf "\n  Then in your browser:  http://localhost:5678\n"
  printf "  Create the owner account. Only you can reach it.\n\n"
  exit 0
fi

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

# =============================================================================
# Who it answers
# =============================================================================
# The access level: named on the command line, else what was chosen last
# time, else the owner's choice of 14 September.
case "$MODE" in
  webhooks|lock|open) ACCESS="$MODE" ;;
  *) ACCESS="$(cat "$ACCESS_FILE" 2>/dev/null || true)"; ACCESS="${ACCESS:-webhooks}" ;;
esac
case "$ACCESS" in webhooks|lock|open) ;; *) die "$ACCESS_FILE says '$ACCESS'." ;; esac

# The address: given now, else saved last time. `allow` exists to change it,
# so it insists on being given one.
ADMIN_IP="${ALLOW_FROM:-}"
if [ -z "$ADMIN_IP" ] && [ "$MODE" != "allow" ]; then
  ADMIN_IP="$(cat "$ALLOW_FILE" 2>/dev/null || true)"
fi
if [ -z "$ADMIN_IP" ] && [ "$ACCESS" != "open" ]; then
  die "Which address should the n8n screen answer? Put this in front of the
  command, so YOUR shell expands it before sudo does:
    ALLOW_FROM=\${SSH_CLIENT%% *}"
fi
if [ -n "$ADMIN_IP" ]; then
  # A stray word here would become an nginx directive. Dotted numbers only.
  [[ "$ADMIN_IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] \
    || die "ALLOW_FROM='$ADMIN_IP' is not an IPv4 address."
fi

# Every route into n8n proxies the same way, so it is written once.
PROXY="        proxy_pass http://127.0.0.1:5678;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$n8n_connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        # A long-running workflow or a held webhook is not a dead one.
        proxy_read_timeout 300s;
        proxy_buffering off;"

LOCKED="        allow $ADMIN_IP;
        deny all;"

# ⚠ 127.0.0.1 MEANS "CLOSED TO THE INTERNET" (the owner's choice, 21
# September). Nobody outside arrives from the server's own address, so the
# screen refuses everybody, webhooks stay open, and the owner opens n8n
# through an SSH tunnel straight to 127.0.0.1:5678 -- which never passes
# through nginx. The refusal must then say THAT, not "run allow with your
# address", which would undo the choice.
if [ "$ADMIN_IP" = "127.0.0.1" ]; then
  LOCKED_MSG="The n8n screen is closed to the internet.\n\nThe owner opens it through the secure link from their own computer (HANDOVER, section 9).\n"
else
  LOCKED_MSG="This n8n answers only the internet address saved on the server, and you are coming from \$remote_addr.\n\nIf that is you, connect to the server with SSH and run:\n\n    sudo ALLOW_FROM=\$remote_addr /opt/fidato/deploy/n8n.sh allow\n"
fi

# ⚠ ONLY THE THREE WEBHOOK PATHS. n8n's own screen, its REST API under
# /rest/ and its sign-in all live under / -- opening "everything except the
# editor" by listing what to close would miss the next path n8n adds. This
# lists what to OPEN, so a path nobody named stays shut.
#
# Forms (/form/) are NOT here. A form page loads the editor's scripts and
# styles, which are locked, so it would render broken -- and nobody has
# asked for a public form yet.
case "$ACCESS" in
  webhooks) SCREEN_RULE="$LOCKED"; HOOK_RULE="" ;;
  lock)     SCREEN_RULE="$LOCKED"; HOOK_RULE="$LOCKED" ;;
  open)     SCREEN_RULE="";        HOOK_RULE="" ;;
esac

# ⚠ A REJECTED SITE MUST NOT BE LEFT IN conf.d. `nginx -t` below refuses to
# reload, and the first version stopped there -- with the bad file still in
# place, where the API certificate's renewal hook would trip over it at its
# next `systemctl reload nginx`, and a reboot would bring nginx up with
# neither site. The API shares this nginx. The last good file comes back.
if [ -f "$SITE" ]; then cp -a "$SITE" "$SITE.last-good"; fi

cat > "$SITE" <<EOF
# Written by deploy/n8n.sh -- rewritten on every run. Edit the script.
# Access: $ACCESS${ADMIN_IP:+, screen answers $ADMIN_IP}

# The editor keeps a websocket open to the server. Named for n8n so it
# cannot collide with a map anybody later adds for the API.
map \$http_upgrade \$n8n_connection_upgrade {
    default upgrade;
    ''      close;
}

# Webhooks answer the whole internet, so they are rate-limited per address:
# a flood aimed at one cannot fill n8n's execution log or its one CPU.
# Generous -- a real service sends a handful a second at most.
limit_req_zone \$binary_remote_addr zone=n8n_hooks:10m rate=10r/s;

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

    # ⚠ WHEN THE ADDRESS CHANGES, SAY SO. A bare 403 after a router restart
    # reads as "n8n is broken". This names the visitor's new address and the
    # one command that lets it in. Only nginx's own refusals come here --
    # n8n's answers pass through untouched, because nothing intercepts them.
    error_page 403 = @n8n_locked;
    location @n8n_locked {
        default_type text/plain;
        return 403 "$LOCKED_MSG";
    }

    location ~ ^/(webhook|webhook-test|webhook-waiting)/ {
$HOOK_RULE
        limit_req zone=n8n_hooks burst=40 nodelay;
        limit_req_status 429;
$PROXY
    }

    location / {
$SCREEN_RULE
$PROXY
    }
}
EOF
if ! nginx -t -q; then
  if [ -f "$SITE.last-good" ]; then mv -f "$SITE.last-good" "$SITE"; else rm -f "$SITE"; fi
  die "nginx rejected the new n8n site. The previous one is back and nothing was
  reloaded -- the API is unaffected."
fi
rm -f "$SITE.last-good"
systemctl reload nginx

# Saved only once nginx has accepted them, so a rejected run leaves the
# last working choice on file.
echo "$ACCESS" > "$ACCESS_FILE"
if [ -n "$ADMIN_IP" ]; then echo "$ADMIN_IP" > "$ALLOW_FILE"; fi

case "$ACCESS" in
  webhooks) ok "screen: only $ADMIN_IP -- webhooks: everybody" ;;
  lock)     ok "screen and webhooks: only $ADMIN_IP" ;;
  open)     ok "screen and webhooks: everybody -- the n8n login is the only lock" ;;
esac

if [ "$MODE" = "install" ]; then install_backups; fi

# =============================================================================
printf "\n\033[32m  n8n is running at https://%s\033[0m\n" "$N8N_DOMAIN"
case "$ACCESS" in
  webhooks)
    printf "\n  The screen answers only %s. Webhook addresses answer anybody:\n" "$ADMIN_IP"
    printf "    https://%s/webhook/...\n" "$N8N_DOMAIN"
    printf "\n  When your internet address changes, the screen tells you the new one.\n"
    printf "  Connect with SSH and run:  sudo ALLOW_FROM=\${SSH_CLIENT%%%% *} deploy/n8n.sh allow\n\n" ;;
  lock)
    printf "\n  Everything, webhooks too, answers only %s.\n" "$ADMIN_IP"
    printf "  To let outside services in again:  sudo deploy/n8n.sh webhooks\n\n" ;;
  open)
    printf "\n  Everything answers everybody. Turn on two-step sign-in for every\n"
    printf "  n8n user: Settings -> Personal -> Enable 2FA.\n\n" ;;
esac
