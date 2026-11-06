#!/usr/bin/env bash
# Puts HTTPS in front of the control server. Run as root: bash deploy/setup-caddy.sh your.domain
set -euo pipefail
ADDRESS="${1:?Usage: setup-caddy.sh your.domain}"
APP=/opt/si/app
export DEBIAN_FRONTEND=noninteractive
command -v caddy >/dev/null || apt-get install -y -qq caddy
printf 'SITE_ADDRESS=%s\n' "$ADDRESS" > /etc/default/caddy
install -d /etc/systemd/system/caddy.service.d /opt/si/web
printf '[Service]\nEnvironmentFile=/etc/default/caddy\n' > /etc/systemd/system/caddy.service.d/site.conf
install -m 644 "$APP/deploy/Caddyfile" /etc/caddy/Caddyfile
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
systemctl daemon-reload
systemctl restart caddy
systemctl is-active caddy
