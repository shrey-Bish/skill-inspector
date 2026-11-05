#!/usr/bin/env bash
# Prepares a fresh Vultr VX1 (Ubuntu 24.04) host to run sandboxes. Run as root from the repo root.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq docker.io caddy
docker build -q -t si-sandbox:1 -f sandbox/image/Dockerfile sandbox/image
docker save si-sandbox:1 -o /tmp/si-sandbox.tar
msb load -i /tmp/si-sandbox.tar
rm -f /tmp/si-sandbox.tar
ls -l /dev/kvm
