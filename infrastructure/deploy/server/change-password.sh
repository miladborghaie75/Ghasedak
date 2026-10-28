#!/usr/bin/env bash
# تغییر رمز یک حساب ادمین از روی سرور (بدون نیاز به SMTP/پنل)
# استفاده:
#   bash /root/ghasedak-deploy/change-password.sh admin@ghasedak.demo 'رمز-تازه-شما'
# نکته: در رمز از ' استفاده نکنید (در SQL شکسته می‌شود).
set -euo pipefail
ENV_FILE="${ENV_FILE:-/opt/ghasedak/.env}"

EMAIL="${1:?ایمیل حساب را بدهید}"
NEW_PW="${2:?رمز تازه را بدهید}"
case "$NEW_PW" in *"'"*) echo "!! رمز نباید شامل ' باشد" >&2; exit 2 ;; esac

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

cd /opt/ghasedak/packages/database
HASH="$(node -e '
const a = require("argon2");
a.hash(process.argv[1], { type: a.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 })
  .then((h) => process.stdout.write(h))
  .catch((e) => { console.error(e); process.exit(1); });
' "$NEW_PW")"

SQL="UPDATE \"User\" SET \"passwordHash\" = '${HASH}' WHERE email = '${EMAIL}';"
# psql پارامتر query پرایسما (؟schema=public) را قبول ندارد — حذف می‌شود
PSQL_URL="${DATABASE_URL%%\?*}"
psql "$PSQL_URL" -v ON_ERROR_STOP=1 -c "$SQL"

echo "انجام شد: رمز '${EMAIL}' عوض شد."
psql "$PSQL_URL" -tAc "SELECT email || ' — ' || role FROM \"User\" WHERE email = '${EMAIL}';"
