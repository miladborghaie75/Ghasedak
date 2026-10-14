#!/usr/bin/env bash
# run-local.sh — اجرای کامل محلی Ghasedak با یک دستور (Git Bash روی ویندوز)
#
# استفاده:
#   bash infrastructure/run-local.sh start     # بالا آوردن همه (پیش‌فرض بدون آرگومان)
#   bash infrastructure/run-local.sh status    # وضعیت سرویس‌ها
#   bash infrastructure/run-local.sh stop      # خاموشی کامل
#   bash infrastructure/run-local.sh restart
#
# انتخاب دیتابیس با متغیر محیطی GHASEDAK_DB:
#   rehearsal (پیش‌فرض) — کلاستر تمرین :55433 / wave1rehearsal3
#                          (اسکیما هم‌راستا با کد فعلی + seed دمو — گزینهٔ امن)
#   primary             — دیتابیس اصلی :5433 / ghasedak
#                          (توجه: اگر مایگریشن‌های جدید اجرا نشده باشند،
#                          ReminderService هنگام استارت با P2022 کرش می‌کند)
#
# پورت‌ها (کانونیکال مطابق README): API ‏4000 — storefront ‏3111 — admin ‏3200
# قابل بازنویسی با API_PORT / SF_PORT / ADMIN_PORT
# لاگ‌ها و pidها در .run-local/ (gitignore شده)

set -u
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"

# ---------- گارد محیط ----------
# این اسکریپت برای Git Bash ویندوز (MSYS/MINGW) طراحی است: cygpath، netstat ویندوزی،
# باینری‌های postgres ویندوزی با مسیر C:/... . اگر cygpath نباشد یعنی احتمالاً WSL است؛
# در WSL node لینوکسی pg_ctl ویندوزی را اجرا نمی‌کند و netstat ویندوزی هم در دسترس نیست —
# بهتر است همان اول با پیام روشن متوقف شود تا وسط راه با خطاهای گمراه‌کننده برسد.
if ! command -v cygpath >/dev/null 2>&1; then
  printf '%s\n' "XX محیط اجرا اشتباه است: این اسکریپت باید با Git Bash ویندوز اجرا شود، نه WSL."
  if uname -r 2>/dev/null | grep -qi microsoft; then
    printf '%s\n' "   (الان داخل WSL هستید — برنامهٔ Git Bash را باز کنید و همان دستور را آنجا اجرا کنید)"
  else
    printf '%s\n' "   (cygpath در این bash موجود نیست)"
  fi
  exit 1
fi

RUN_DIR="$ROOT/.run-local"
mkdir -p "$RUN_DIR"

# ---------- پیکربندی ----------
API_PORT="${API_PORT:-4000}"
SF_PORT="${SF_PORT:-3111}"
ADMIN_PORT="${ADMIN_PORT:-3200}"
DB_MODE="${GHASEDAK_DB:-rehearsal}"

PG_HOME="${GHASEDAK_PG_HOME:-C:/ghasedak-pg}"
PRIMARY_PGCTL="$PG_HOME/bin/bin/pg_ctl"
PRIMARY_PGDATA="$PG_HOME/data"
PRIMARY_PORT=5433
PRIMARY_URL="postgresql://postgres:ghasedak-dev-pw@127.0.0.1:${PRIMARY_PORT}/ghasedak"

REHEARSAL_SCRIPT="infrastructure/backup/rehearsal/run-cluster.mjs"
REHEARSAL_PORT=55433
REHEARSAL_PGDATA="${REHEARSAL_PGDATA:-C:/ghasedak-phase9-recovery-rehearsal/wave1-pgdata2}"
REHEARSAL_LOG="${REHEARSAL_LOG:-C:/ghasedak-phase9-recovery-rehearsal/wave1-pgdata2.log}"
REHEARSAL_DB=wave1rehearsal3
REHEARSAL_PW=rehearsal-pw

NODE_EXE="$(command -v node.exe || command -v node)"

# ---------- ابزارهای کمکی ----------
say()  { printf '%s\n' "$*"; }
ok()   { printf '  \033[32mOK\033[0m  %s\n' "$*"; }
warn() { printf '  \033[33m!!\033[0m  %s\n' "$*"; }
bad()  { printf '  \033[31mXX\033[0m  %s\n' "$*"; }

port_pid() {
  netstat -ano 2>/dev/null | grep -i listening | grep -E "[:.]$1[[:space:]]" | awk '{print $NF}' | head -1
}
listening() { [ -n "$(port_pid "$1")" ]; }

http_code() { curl -s --max-time 5 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null; }

# spawn_detached <name> <appdir> <logfile> <exe> [args...]
# پروسه را detached بالا می‌آورد و PID آن را چاپ می‌کند.
# نکات:
#  - مسیرها با cygpath به فرم ویندوزی تبدیل می‌شوند (یونیکد سالم می‌ماند —
#    node خودش argv/cwd را UTF-16 به ویندوز می‌دهد، برخلاف فایل batch).
#  - stdio پروسه به فایل لاگ وصل است، نه به pipe اسکریپت؛ بنابراین
#    گرفتن خروجی این تابع باعث hang نمی‌شود و بلافاصله برمی‌گردد.
spawn_detached() { # <name> <appdir> <logfile> <exe> [args...]
  local name="$1" appdir="$2" logfile="$3" exe="$4"; shift 4
  local wexe wwd wlog arr="" a
  wexe=$(cygpath -w "$exe")
  wwd=$(cygpath -w "$appdir")
  wlog=$(cygpath -w "$logfile")
  for a in "$@"; do arr="$arr\"$a\","; done
  arr="[${arr%,}]"
  node -e '
    const { spawn } = require("child_process"), fs = require("fs");
    const log = fs.openSync(process.argv[1], "a");
    try {
      const child = spawn(process.argv[2], JSON.parse(process.argv[3]), {
        cwd: process.argv[4], stdio: ["ignore", log, log], detached: true,
      });
      child.unref();
      console.log(child.pid);
    } catch (e) { console.error(e.message); process.exit(1); }
  ' "$wlog" "$wexe" "$arr" "$wwd" 2>>"$RUN_DIR/spawn.err.log"
}

kill_tree() { taskkill //PID "$1" //T //F >/dev/null 2>&1; }

db_port() { if [ "$DB_MODE" = "primary" ]; then echo "$PRIMARY_PORT"; else echo "$REHEARSAL_PORT"; fi; }
db_url() {
  # اگر DATABASE_URL از بیرون داده شده باشد، محترمانه همان استفاده می‌شود (بند: Existing Capability First)
  # وگرنه پیش‌فرض محیط آزمایشی است. نکته: پایگاه دادهٔ پیش‌فرض rehearsal (wave1rehearsal3)
  # ممکن است اسکیمای عقب‌مانده داشته باشد — برای دادهٔ تازه از DATABASE_URL استفاده کنید
  # یا GHASEDAK_DB=primary بگذارید.
  if [ -n "${DATABASE_URL:-}" ]; then
    echo "$DATABASE_URL"
  elif [ "$DB_MODE" = "primary" ]; then
    echo "$PRIMARY_URL"
  else
    echo "postgresql://postgres:${REHEARSAL_PW}@127.0.0.1:${REHEARSAL_PORT}/${REHEARSAL_DB}"
  fi
}

# ---------- start ----------
start_db() {
  local pg_log="$RUN_DIR/pg-start.log"
  if [ "$DB_MODE" != "primary" ]; then pg_log="$RUN_DIR/rehearsal-pg.log"; fi
  say "— PostgreSQL ($DB_MODE) :$(db_port)"
  if listening "$(db_port)"; then
    ok "از قبل بالا است (pid $(port_pid "$(db_port)"))"
  else
    if [ "$DB_MODE" = "primary" ]; then
      "$PRIMARY_PGCTL" -D "$PRIMARY_PGDATA" -o "-p $PRIMARY_PORT -h 127.0.0.1" \
        -l "$RUN_DIR/primary-pg.log" -w start >>"$pg_log" 2>&1
    else
      node "$REHEARSAL_SCRIPT" --action start --pgdata "$REHEARSAL_PGDATA" \
        --port "$REHEARSAL_PORT" --log "$REHEARSAL_LOG" >>"$pg_log" 2>&1
    fi
    if listening "$(db_port)"; then
      ok "بالا آمد (pid $(port_pid "$(db_port)"))"
    else
      bad "بالا نیامد — لاگ: $pg_log"
      return 1
    fi
  fi
  echo "$DB_MODE" >"$RUN_DIR/db-mode"
}

start_api() {
  say "— API :$API_PORT"
  if listening "$API_PORT"; then
    ok "از قبل بالا است (pid $(port_pid "$API_PORT"))"
    return 0
  fi
  local pid code=000 i
  # گیت کارهای پس‌زمینه برای محیط توسعه محلی — تایمرهای خودکار روشن نمی‌شوند مگر GHASEDAK_WORKERS=on
  local workers_flag="${GHASEDAK_WORKERS:-off}"
  # گام F0-5: allowlist بازگشت درگاه — در dev همان origin فروشگاه محلی؛
  # در production این متغیر روی دامنهٔ واقعی تنظیم می‌شود (بدون آن پرداخت آغاز نمی‌شود).
  local callback_origins="${PAYMENT_CALLBACK_ORIGINS:-http://localhost:${SF_PORT},http://127.0.0.1:${SF_PORT}}"
  pid=$(PORT="$API_PORT" DATABASE_URL="$(db_url)" GHASEDAK_WORKERS="$workers_flag" \
    PAYMENT_CALLBACK_ORIGINS="$callback_origins" \
    spawn_detached "api" "$ROOT/apps/api" "$RUN_DIR/api.log" "$NODE_EXE" "dist/main.js")
  for i in $(seq 1 30); do
    sleep 1
    code=$(http_code "http://localhost:$API_PORT/api/v1/health")
    [ "$code" = "200" ] && break
  done
  if [ "$code" = "200" ]; then
    [ -z "$pid" ] && pid=$(port_pid "$API_PORT")
    echo "$pid" >"$RUN_DIR/api.pid"
    ok "health 200 (pid $pid)"
  else
    bad "health پاسخ نداد (code=$code) — لاگ: $RUN_DIR/api.err.log"
    return 1
  fi
}

start_frontend() { # <نام> <پورت> <دایرکتوری اپ>
  local name="$1" port="$2" dir="$3"
  say "— $name :$port"
  if listening "$port"; then
    ok "از قبل بالا است (pid $(port_pid "$port"))"
    return 0
  fi
  local js="$dir/node_modules/next/dist/bin/next"
  if [ ! -f "$js" ]; then
    bad "بستهٔ next پیدا نشد: $js (اول pnpm install + build)"
    return 1
  fi
  local pid code=000 i
  # اجرای مستقیم node.exe روی فایل JS — بدون shell و بدون batch (یونیکد/quote امن)
  pid=$(spawn_detached "$name" "$dir" "$RUN_DIR/$name.log" \
    "$NODE_EXE" "node_modules/next/dist/bin/next" start -p "$port")
  for i in $(seq 1 45); do
    sleep 1
    code=$(http_code "http://localhost:$port/")
    [ "$code" != "000" ] && break
  done
  if [ "$code" = "200" ] || [ "$code" = "307" ]; then
    [ -z "$pid" ] && pid=$(port_pid "$port")
    echo "$pid" >"$RUN_DIR/$name.pid"
    ok "پاسخ داد (http $code, pid $pid)"
  else
    bad "پاسخ نداد (code=$code) — لاگ: $RUN_DIR/$name.err.log"
    return 1
  fi
}

cmd_start() {
  say "== راه‌اندازی Ghasedak (DB=$DB_MODE) =="
  local failed=0
  if [ "$DB_MODE" = "primary" ]; then
    warn "حالت primary: اگر مایگریشن‌های جدید روی اسکیما اجرا نشده باشند API با P2022 کرش می‌کند"
  fi
  start_db || failed=1
  start_api || failed=1
  # گام F0-7: صفحهٔ درگاه آزمایشی در build تولیدی بسته است (404)؛ اجرای local هم
  # روی build تولیدی است، پس فقط برای همین محیط صریحاً روشن می‌شود.
  local mock_gateway="${GHASEDAK_MOCK_GATEWAY:-on}"
  GHASEDAK_MOCK_GATEWAY="$mock_gateway" start_frontend "storefront" "$SF_PORT" "$ROOT/apps/storefront" || failed=1
  start_frontend "admin" "$ADMIN_PORT" "$ROOT/apps/admin" || failed=1
  say ""
  if [ "$failed" = "0" ]; then
    say "همه سرویس‌ها بالا هستند:"
    say "  storefront  http://localhost:$SF_PORT"
    say "  admin       http://localhost:$ADMIN_PORT"
    say "  api         http://localhost:$API_PORT/api/v1/health"
  else
    warn "یک یا چند سرویس بالا نیامد — bash infrastructure/run-local.sh status"
    return 1
  fi
}

# ---------- stop ----------
stop_service() { # <نام> <پورت>
  local name="$1" port="$2" pidfile="$RUN_DIR/$1.pid" pid=""
  if [ -f "$pidfile" ]; then pid=$(tr -d '\r[:space:]' <"$pidfile"); fi
  if [ -z "$pid" ] && listening "$port"; then
    pid=$(port_pid "$port")
    warn "$name: pidfile نبود؛ با pid پورت ($pid) خاموش می‌شود"
  fi
  if [ -n "$pid" ]; then
    kill_tree "$pid"
    say "  $name خاموش شد (pid $pid)"
  else
    say "  $name از قبل خاموش است"
  fi
  rm -f "$pidfile"
}

cmd_stop() {
  say "== خاموش کردن سرویس‌ها =="
  stop_service "admin" "$ADMIN_PORT"
  stop_service "storefront" "$SF_PORT"
  stop_service "api" "$API_PORT"
  local mode=""; [ -f "$RUN_DIR/db-mode" ] && mode=$(tr -d '\r[:space:]' <"$RUN_DIR/db-mode")
  if [ -z "$mode" ]; then
    warn "DB توسط این اسکریپت start نشده (state نبود) — دستی خاموش کنید"
  elif [ "$mode" = "primary" ]; then
    if listening "$PRIMARY_PORT"; then
      "$PRIMARY_PGCTL" -D "$PRIMARY_PGDATA" stop -m fast -w >>"$RUN_DIR/pg-stop.log" 2>&1
      say "  postgres (primary) خاموش شد"
    else
      say "  postgres (primary) از قبل خاموش است"
    fi
  else
    if listening "$REHEARSAL_PORT"; then
      node "$REHEARSAL_SCRIPT" --action stop --pgdata "$REHEARSAL_PGDATA" \
        --port "$REHEARSAL_PORT" --log "$REHEARSAL_LOG" >>"$RUN_DIR/rehearsal-pg.log" 2>&1
      say "  postgres (rehearsal) خاموش شد"
    else
      say "  postgres (rehearsal) از قبل خاموش است"
    fi
  fi
  rm -f "$RUN_DIR/db-mode"
}

# ---------- status ----------
status_row() { # <برچسب> <آدرس http یا -> <پورت>
  local label="$1" url="$2" port="$3" pid code="-" dbflag=""
  if listening "$port"; then
    pid=$(port_pid "$port")
    if [ "$url" != "-" ]; then
      code=$(http_code "$url")
      if [ "$code" = "200" ] || [ "$code" = "307" ]; then
        if [ "$label" = "API" ]; then
          dbflag=$(curl -s --max-time 5 "http://localhost:$port/api/v1/health" 2>/dev/null | grep -o '"db":true' >/dev/null && echo " [db:true]" || echo " [db:false]")
        fi
        ok "$(printf '%-12s :%-6s pid=%-8s http=%s%s' "$label" "$port" "$pid" "$code" "$dbflag")"
      else
        bad "$(printf '%-12s :%-6s pid=%-8s http=%s (پاسخ غیرمنتظره)' "$label" "$port" "$pid" "$code")"
      fi
    else
      ok "$(printf '%-12s :%-6s pid=%-8s (پورت باز)' "$label" "$port" "$pid")"
    fi
  else
    bad "$(printf '%-12s :%-6s خاموش' "$label" "$port")"
  fi
}

cmd_status() {
  local mode=""; [ -f "$RUN_DIR/db-mode" ] && mode=$(tr -d '\r[:space:]' <"$RUN_DIR/db-mode")
  say "== وضعیت سرویس‌های Ghasedak (DB=${mode:-?}) =="
  if [ "${mode:-$DB_MODE}" = "primary" ]; then
    status_row "postgres" "-" "$PRIMARY_PORT"
  else
    status_row "postgres" "-" "$REHEARSAL_PORT"
  fi
  status_row "API" "http://localhost:$API_PORT/api/v1/health" "$API_PORT"
  status_row "storefront" "http://localhost:$SF_PORT/" "$SF_PORT"
  status_row "admin" "http://localhost:$ADMIN_PORT/" "$ADMIN_PORT"
}

# ---------- dispatch ----------
case "${1:-start}" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) cmd_stop; say ""; cmd_start ;;
  status)  cmd_status ;;
  *) say "استفاده: bash infrastructure/run-local.sh {start|stop|status|restart}"; exit 2 ;;
esac
