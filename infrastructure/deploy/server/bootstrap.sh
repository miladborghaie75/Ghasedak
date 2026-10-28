#!/usr/bin/env bash
# گام ۳۳ — راه‌اندازی زیرساخت سرور (Ubuntu 24.04، یک‌بار اجرا)
# اجرا:  sudo bash infrastructure/deploy/server/bootstrap.sh
# خروجی: پشتهٔ نرم‌افزاری + دیتابیس + فایروال + env اولیه؛ هیچ کدی build نمی‌شود (deploy.sh).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

SSH_PORT="${SSH_PORT:-6579}"          # پورت SSH اختصاصی این VPS (آذرآنلاین) — از 22 متفاوت است
APP_DIR="${APP_DIR:-/opt/ghasedak}"
DB_USER="ghasedak"
DB_NAME="ghasedak"

log() { printf '\n== [%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

if [ "$(id -u)" -ne 0 ]; then echo "!! با root اجرا کنید (sudo)" >&2; exit 1; fi

log "1/7 — swap (سرور ۲ گیگ رم؛ build دو اپ Next بدون swap OOM می‌شود)"
if ! swapon --show 2>/dev/null | grep -q '/swapfile'; then
  fallocate -l 4G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=4096 status=none
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
printf 'vm.swappiness=10\n' > /etc/sysctl.d/99-ghasedak.conf
sysctl -p /etc/sysctl.d/99-ghasedak.conf >/dev/null
swapon --show

log "2/7 — بسته‌های سیستمی"
apt-get update -y
apt-get install -y --no-install-recommends \
  curl ca-certificates gnupg git jq rsync openssl ufw dnsutils \
  build-essential python3-venv
apt-get install -y nginx postgresql postgresql-contrib certbot
systemctl enable --now nginx >/dev/null 2>&1 || true
systemctl enable --now postgresql >/dev/null 2>&1 || true

log "3/7 — Node 22 + pnpm 10"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -c1-3)" != "v22" ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
corepack enable >/dev/null 2>&1 || true
if ! corepack prepare pnpm@10.12.1 --activate; then
  echo "! corepack نتوانست pnpm را بگیرد — تلاش از npm"
  npm i -g pnpm@10.12.1
fi
echo "node=$(node -v) pnpm=$(pnpm -v) nginx=$(nginx -v 2>&1 | awk '{print $3}')"

log "4/7 — کاربر سرویس و مسیرها"
id -u ghasedak >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash ghasedak
mkdir -p "$APP_DIR" /var/backups/ghasedak /var/www/html
chown -R ghasedak:ghasedak "$APP_DIR" /var/backups/ghasedak
chmod 755 /var/www/html

log "5/7 — دیتابیس (نقش + پایگاه‌داده؛ رمز تصادفی و یک‌بار)"
PASS_FILE="/root/.ghasedak-db.pass"
if [ ! -f "$PASS_FILE" ]; then
  openssl rand -hex 24 > "$PASS_FILE"
  chmod 600 "$PASS_FILE"
fi
DB_PASS="$(tr -d '[:space:]' < "$PASS_FILE")"

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
  sudo -u postgres psql -qc "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';"
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
fi

log "6/7 — env سرور (فقط اگر نباشد؛ رمز دیتابیس همین‌جا تزریق می‌شود)"
ENV_FILE="$APP_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  install -m 600 -o ghasedak -g ghasedak \
    "$(dirname "$0")/env.production" "$ENV_FILE"
  # DATABASE_URL را با رمز واقعی جایگزین می‌کنیم
  sed -i "s#^DATABASE_URL=.*#DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}?schema=public#" "$ENV_FILE"
  echo "   env ساخته شد: $ENV_FILE (رمز DB از $PASS_FILE)"
else
  echo "   env از قبل هست — دست نمی‌زنم: $ENV_FILE"
fi

log "7/7 — فایروال (SSH اختصاصی + 80/443)"
ufw default allow outgoing >/dev/null
ufw allow "${SSH_PORT}/tcp" comment 'ssh-custom' >/dev/null
ufw allow 80/tcp  comment 'http'  >/dev/null
ufw allow 443/tcp comment 'https' >/dev/null
ufw --force enable >/dev/null
ufw status verbose | sed -n '1,12p'

log "تمام شد — قدم بعدی: sudo bash infrastructure/deploy/server/deploy.sh"
