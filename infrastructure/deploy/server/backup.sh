#!/usr/bin/env bash
# گام ۳۷ — بکاپ روزانهٔ قاصدک + نگهداری GHASEDAK_BACKUP_KEEP نسخهٔ آخر
# cron (root):  0 2 * * * /root/ghasedak-deploy/backup.sh >> /var/backups/ghasedak/backup.log 2>&1
set -euo pipefail
ENV_FILE="${ENV_FILE:-/opt/ghasedak/.env}"
OUT="${OUT:-/var/backups/ghasedak}"
KEEP="${GHASEDAK_BACKUP_KEEP:-14}"
TOOLS="${GHASEDAK_PG_TOOLS:-/opt/ghasedak-tools/pg-client/package.json}"

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
export GHASEDAK_PG_TOOLS="$TOOLS"

mkdir -p "$OUT"
cd /opt/ghasedak
node infrastructure/backup/ghasedak-backup.mjs --url "$DATABASE_URL" --out "$OUT"

# verify واقعی: sha256 هر CSV با manifest مقایسه و verify.json کنار manifest نوشته می‌شود
# (پنل از همین فیلد «تأییدشده» را می‌خواند؛ HealthWatch بدون آن هشدار BACKUP_FAILED می‌دهد)
LATEST="$(ls -1dt "$OUT"/*/ | head -1)"
node infrastructure/backup/rehearsal/verify-backup.mjs "$LATEST"

# نگهداری: فقط KEEP پوشهٔ آخر نگه داشته می‌شود
ls -1dt "$OUT"/*/ 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -rf

# پوشه‌ها متعلق به کاربر سرویس باشند تا endpoint وضعیت بکاپ پنل بتواند بخواند
chown -R ghasedak:ghasedak "$OUT"
echo "$(date -Is) backup ok (keep=$KEEP, dirs=$(ls -1d "$OUT"/*/ 2>/dev/null | wc -l))"
