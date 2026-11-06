#!/usr/bin/env bash
# Runs the control server as an unprivileged user. Run as root after sandbox/setup-host.sh.
# Reads the inference key from /root/.vultr-inference-key and never prints it.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
APP=/opt/si/app

id si >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/si --shell /usr/sbin/nologin si
usermod -aG kvm si
chmod 755 /opt/si
chown -R root:root "$APP"
chmod -R go-w "$APP"

# Microsandbox keeps its images per user, so the service user needs its own copy.
install -d -o si -g si /var/lib/si/.microsandbox /var/lib/si/checks /var/lib/si/runs
cp -a /root/.microsandbox/bin /root/.microsandbox/lib /var/lib/si/.microsandbox/
chown -R si:si /var/lib/si/.microsandbox
docker save si-sandbox:1 -o /var/lib/si/image.tar
chown si:si /var/lib/si/image.tar
sudo -u si env HOME=/var/lib/si /var/lib/si/.microsandbox/bin/msb load -i /var/lib/si/image.tar
rm -f /var/lib/si/image.tar

install -d -m 750 -o root -g si /etc/si
umask 027
{
  printf 'VULTR_INFERENCE_API_KEY=%s\n' "$(cat /root/.vultr-inference-key)"
  grep -v '^VULTR_INFERENCE_API_KEY=' "$APP/.env.example"
} > /etc/si/env
chown root:si /etc/si/env
chmod 640 /etc/si/env

install -m 644 "$APP/deploy/skill-inspector.service" /etc/systemd/system/skill-inspector.service
systemctl daemon-reload
systemctl enable --now skill-inspector
systemctl is-active skill-inspector
