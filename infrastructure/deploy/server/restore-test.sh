#!/usr/bin/env bash
# گام ۳۷ — تست بازیابی هفتگی: اثبات واقعیِ قابل‌بازیابی بودن آخرین بکاپ
# cron (root):  0 3 * * 0 /root/ghasedak-deploy/restore-test.sh >> /var/backups/ghasedak/restore-test.log 2>&1
set -euo pipefail
ENV_FILE="${ENV_FILE:-/opt/ghasedak/.env}"
OUT="${OUT:-/var/backups/ghasedak}"
TOOLS="${GHASEDAK_PG_TOOLS:-/opt/ghasedak-tools/pg-client/package.json}"
PW_FILE="${RESTORE_PASS_FILE:-/root/.ghasedak-restore.pass}"

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
export GHASEDAK_PG_TOOLS="$TOOLS"

[ -f "$PW_FILE" ] || { echo "!! $PW_FILE موجود نیست (رمز نقش postgres برای admin-url)"; exit 1; }
PW="$(tr -d '[:space:]' < "$PW_FILE")"

D="$(ls -1dt "$OUT"/*/ | head -1)"
cd /opt/ghasedak
node infrastructure/backup/ghasedak-restore-test.mjs \
  --backup "$D" \
  --repo /opt/ghasedak \
  --admin-url "postgresql://postgres:${PW}@127.0.0.1:5432/postgres" \
  | sed "s#${PW}#***#g"

chown -R ghasedak:ghasedak /opt/ghasedak
echo "$(date -Is) restore-test ok from $D"
