#!/usr/bin/env bash
# گام ۳۳ — استقرار روی سرور: کد ← وابستگی ← مایگریشن ← build ← سرویس‌ها ← SSL ← health
# اجرا:  sudo bash infrastructure/deploy/server/deploy.sh
# متغیرها: BRANCH=main CERT_EMAIL=you@example.com SKIP_CERT=1
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/ghasedak}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
REPO="${REPO:-https://github.com/miladborghaie75/Ghasedak.git}"
BRANCH="${BRANCH:-main}"
CERT_EMAIL="${CERT_EMAIL:-}"
SKIP_CERT="${SKIP_CERT:-0}"
RUN_AS="${RUN_AS:-ghasedak}"
HERE="$(cd "$(dirname "$0")" && pwd)"

log() { printf '\n== [%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { echo "!! $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "با sudo اجرا کنید"
[ -f "$ENV_FILE" ] || die "env نیست: $ENV_FILE — اول bootstrap.sh"
command -v pnpm >/dev/null 2>&1 || die "pnpm نیست — اول bootstrap.sh"

runas() { sudo -u "$RUN_AS" -H "$@"; }
# نکته: sudo به‌طور پیش‌فرض env را reset می‌کند — پس env سرور را داخل پروسهٔ فرزند
# دوباره باز می‌کنیم وگرنه Prisma/Next هیچ‌کدام DATABASE_URL و NEXT_PUBLIC_* را نمی‌بینند.
runenv() { sudo -u "$RUN_AS" -H bash -c "set -a; . '$ENV_FILE'; set +a; $1"; }

# همهٔ env برای build/migrate (فقط همین پروسه؛ وارد shell دیگری نمی‌شود)
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# ---------- 1) کد ----------
log "1/8 — کد ($BRANCH)"
# مالکیت مختلط (root ⇄ ghasedak) هشدار dubious ownership می‌دهد — برای هر دو کاربر مجاز می‌شود
git config --global --add safe.directory "$APP_DIR"
runas git config --global --add safe.directory "$APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  runas git -C "$APP_DIR" fetch origin "$BRANCH" --prune
  runas git -C "$APP_DIR" checkout "$BRANCH"
  runas git -C "$APP_DIR" merge --ff-only "origin/$BRANCH" \
    || die "شعبه از origin جلوتر/عقب‌تر است — روی سرور تغییر دستی ندهید (git -C $APP_DIR status)"
else
  # bootstrap قبلاً /opt/ghasedak را ساخته و .env را آنجا گذاشته ⇒ clone مستقیم ممکن نیست:
  # در یک مسیر موقت clone می‌کنیم و محتوا را روی می‌گذاریم (فایل‌های موجود، از جمله .env، دست نمی‌خورند)
  TMPDIR_CLONE="$(mktemp -d)"
  git clone --branch "$BRANCH" "$REPO" "$TMPDIR_CLONE/repo"
  cp -a "$TMPDIR_CLONE/repo/." "$APP_DIR/"
  rm -rf "$TMPDIR_CLONE"
  chown -R "$RUN_AS:$RUN_AS" "$APP_DIR"
fi
COMMIT="$(git -C "$APP_DIR" rev-parse --short HEAD)"
log "کامیت: $COMMIT"

# ---------- 2) env برای اپ‌های Next ----------
# NEXT_PUBLIC_* در زمان build داخل باندل می‌شود → باید قبل از build خوانده شود.
log "2/8 — env اپ‌ها"
for app in apps/storefront apps/admin; do
  grep -E '^(NEXT_PUBLIC_|API_ORIGIN=|CANONICAL_HOST=|FRAME_ALLOWED_ORIGINS=|GHASEDAK_API_KEY=)' "$ENV_FILE" \
    > "$APP_DIR/$app/.env.production.local"
  chown "$RUN_AS:$RUN_AS" "$APP_DIR/$app/.env.production.local"
done
echo "   .env.production.local نوشته شد (NEXT_PUBLIC_* + API_ORIGIN)"

# ---------- 3) وابستگی‌ها ----------
log "3/8 — pnpm install"
runas bash -c "cd '$APP_DIR' && pnpm install --frozen-lockfile"

# ---------- 4) دیتابیس ----------
log "4/8 — migrate + seed (فقط اگر خالی باشد)"
runenv "cd '$APP_DIR' && pnpm db:generate && pnpm db:deploy"
USER_COUNT="$(sudo -u postgres psql -tAc 'SELECT count(*) FROM "User"' ghasedak 2>/dev/null | tr -d '[:space:]' || echo unknown)"
if [ "$USER_COUNT" = "0" ]; then
  log "   جدول User خالی است → db:seed"
  # seed به dist پکیج contracts نیاز دارد (main: dist/index.js) — قبلاً build نشده
  runenv "cd '$APP_DIR' && pnpm --filter @ghasedak/contracts build"
  runenv "cd '$APP_DIR' && pnpm --filter @ghasedak/database db:seed"
else
  log "   seed رد شد (User=$USER_COUNT)"
fi

# ---------- 5) build (تک‌تک — سرور ۲ گیگ رم) ----------
log "5/8 — build (turbo با ترتیب وابستگی‌ها؛ تک‌تک چون رم ۲ گیگ است)"
export NODE_OPTIONS=--max-old-space-size=1536
runenv "cd '$APP_DIR' && pnpm exec turbo run build --concurrency=1"
unset NODE_OPTIONS

# ---------- 6) سرویس‌ها ----------
log "6/8 — systemd"
chown -R "$RUN_AS:$RUN_AS" "$APP_DIR"
install -m 644 "$HERE"/systemd/*.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable ghasedak-api ghasedak-storefront ghasedak-admin >/dev/null 2>&1
systemctl restart ghasedak-api ghasedak-storefront ghasedak-admin
sleep 4
# بوت Nest روی این سرور تا ~۱۵ ثانیه طول می‌کشد (map صدها روت) — تا وقتی API واقعاً
# جواب ندهد سلامت‌سنجی نکنیم وگرنه هر استقرار «شکست‌خورده» گزارش می‌شود.
for i in $(seq 1 45); do
  curl -fsS -m 2 http://127.0.0.1:4000/api/v1/health >/dev/null 2>&1 && break
  sleep 1
done
for s in ghasedak-api ghasedak-storefront ghasedak-admin; do
  state="$(systemctl is-active "$s" 2>/dev/null || true)"
  printf '   %-22s %s\n' "$s" "$state"
  [ "$state" = "active" ] || { journalctl -u "$s" -n 25 --no-pager; die "$s بالا نیامد"; }
done

# ---------- 7) nginx + SSL ----------
log "7/8 — nginx + گواهی"
CERT_DIR=""
for d in /etc/letsencrypt/live/www.lebaszirghasedak.ir /etc/letsencrypt/live/*; do
  [ -f "$d/fullchain.pem" ] && { CERT_DIR="$d"; break; }
done

if [ -z "$CERT_DIR" ] && [ "$SKIP_CERT" != "1" ]; then
  echo "   نصب پیکربندی HTTP (مرحله ۱) برای ACME"
  install -m 644 "$HERE/nginx/ghasedak-http.conf" /etc/nginx/conf.d/ghasedak.conf
  nginx -t
  systemctl reload nginx
  mkdir -p /var/www/html
  ACME_ARGS=(--webroot -w /var/www/html --agree-tos --non-interactive --keep-until-expiring)
  if [ -n "$CERT_EMAIL" ]; then ACME_ARGS+=(--email "$CERT_EMAIL"); else ACME_ARGS+=(--register-unsafely-without-email); fi
  certbot certonly "${ACME_ARGS[@]}" \
    -d www.lebaszirghasedak.ir -d lebaszirghasedak.ir -d admin.lebaszirghasedak.ir
  for d in /etc/letsencrypt/live/www.lebaszirghasedak.ir /etc/letsencrypt/live/*; do
    [ -f "$d/fullchain.pem" ] && { CERT_DIR="$d"; break; }
  done
elif [ -z "$CERT_DIR" ]; then
  echo "   SKIP_CERT=1 → فقط HTTP"
fi

if [ -n "$CERT_DIR" ]; then
  echo "   نصب پیکربندی HTTPS با گواهی $CERT_DIR"
  sed "s#__CERT_DIR__#${CERT_DIR}#g" "$HERE/nginx/ghasedak-ssl.conf" > /etc/nginx/conf.d/ghasedak.conf
else
  install -m 644 "$HERE/nginx/ghasedak-http.conf" /etc/nginx/conf.d/ghasedak.conf
fi
nginx -t
systemctl reload nginx

# ---------- 8) health ----------
log "8/8 — health"
fail=0
probe() { # name url
  local out
  if out="$(curl -fsS -m 15 -o /tmp/.ghasedak-health -w '%{http_code}' "$2" 2>&1)"; then
    printf '   %-34s %s\n' "$1" "$out"
  else
    printf '   %-34s FAIL %s\n' "$1" "$out"; fail=1
  fi
}
probe "API 127.0.0.1:4000/health"   "http://127.0.0.1:4000/api/v1/health"
probe "Storefront 127.0.0.1:3111"   "http://127.0.0.1:3111/"
probe "Admin 127.0.0.1:3200"        "http://127.0.0.1:3200/login"
if [ -n "$CERT_DIR" ]; then
  probe "https://www.lebaszirghasedak.ir"   "https://www.lebaszirghasedak.ir/"
  probe "https://admin.lebaszirghasedak.ir" "https://admin.lebaszirghasedak.ir/login"
  echo "   ریدایرکت apex:"
  curl -sI -m 15 http://lebaszirghasedak.ir/ | head -3 | sed 's/^/     /' || true
fi

if [ "$fail" != "0" ]; then
  echo "!! health ناقص — آخرین لاگ API:" >&2
  journalctl -u ghasedak-api -n 30 --no-pager >&2 || true
  exit 1
fi
log "استقرار سبز — $COMMIT"
