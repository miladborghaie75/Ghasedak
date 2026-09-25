/**
 * Rehearsal cluster manager — خوشهٔ PostgreSQL کاملاً جدا (فقط loopback).
 * Primary (5433, C:\ghasedak-pg\data) را به هیچ عنوان لمس نمی‌کند؛
 * PGDATA/پورت/لوگ کاملاً جدا با مسیرهای دریافتی از argv.
 *
 * usage:
 *   node run-cluster.mjs start    --pgdata <dir> --port <p> --log <file>
 *   node run-cluster.mjs status   --pgdata <dir>
 *   node run-cluster.mjs stop     --pgdata <dir>
 *   node run-cluster.mjs identify --pgdata <dir>
 */
import { execFileSync } from "node:child_process";
import net from "node:net";
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";

const PG = process.env.REHEARSAL_PG_BIN ?? "C:/ghasedak-pg/bin/bin";
// credential فقط برای cluster موقتی loopback — با env قابل override؛ primary هرگز استفاده نمی‌شود
const REHEARSAL_PW = process.env.REHEARSAL_PG_PASSWORD ?? "rehearsal-pw";
// مسیرهای PGDATA ممنوع (primary production و هر مسیر مشکوک دیگری)
const FORBIDDEN_PGDATA = ["c:/ghasedak-pg/data", "c:\\ghasedak-pg\\data"];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}
const action = arg("action");
const pgdata = arg("pgdata");
const port = arg("port");
const logfile = arg("log");

function run(tool, args, { capture = true } = {}) {
  // نکتهٔ ویندوز: pg_ctl هندل‌های stdio را به postgres (فرزند detached) منتقل می‌کند؛
  // اگر pipe بدهیم، execFileSync هرگز برنمی‌گردد و timeout کل process tree را می‌کشد.
  // برای start/stop هیچ خروجی pipe نمی‌گیریم (نتیجه در log file و exit code است).
  return execFileSync(`${PG}/${tool}`, args, {
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "ignore",
  });
}

if (!pgdata || !action) {
  console.error("usage: run-cluster.mjs action=<start|stop|status|identify> --pgdata <dir> [--port <p>] [--log <file>]");
  process.exit(2);
}
// fail-safe: هرگز روی PGDATA اولیه اجرا نشو
if (FORBIDDEN_PGDATA.includes(String(pgdata).toLowerCase().replace(/\\+/g, "/").replace(/\/$/, ""))) {
  console.error("REFUSED: this pgdata is the PRIMARY production cluster — rehearsal tools never touch it");
  process.exit(3);
}

if (action === "start") {
  if (!port || !Number(port) || Number(port) === 5433) {
    console.error("port must be provided and must NOT be 5433");
    process.exit(2);
  }
  if (!existsSync(pgdata)) {
    mkdirSync(pgdata, { recursive: true });
    // initdb به --pwfile نیاز دارد؛ فایل موقت کنار pgdata
    const pwfile = `${pgdata}.pwfile`;
    writeFileSync(pwfile, `${REHEARSAL_PW}\n`);
    try {
      const out = run("initdb", ["-D", pgdata, "-U", "postgres", "-E", "UTF8", "-A", "scram-sha-256", `--pwfile=${pwfile}`]);
      console.log(out.split("\n").filter((l) => /Success|initialized/.test(l)).join("\n") || "initdb done");
    } finally {
      rmSync(pwfile, { force: true });
    }
  }
  const out = run("pg_ctl", [
    "-D", pgdata,
    "-o", `-p ${port} -h 127.0.0.1 -k "${pgdata}"`,
    "-l", logfile || `${pgdata}.log`,
    "-w", "-t", "60", "start",
  ], { capture: false });
  // تأیید واقعی: تلاش برای TCP connect به پورت
  const up = await new Promise((resolve) => {
    let tries = 0;
    const probe = () => {
      const s = net.connect(Number(port), "127.0.0.1");
      s.once("connect", () => { s.destroy(); resolve(true); });
      s.once("error", () => {
        s.destroy();
        if (++tries > 20) return resolve(false);
        setTimeout(probe, 500);
      });
    };
    probe();
  });
  console.log(up ? `STARTED, port=${port} accepting connections` : "FAILED to accept connections");
  if (!up) process.exit(1);
}

if (action === "stop") {
  run("pg_ctl", ["-D", pgdata, "-m", "fast", "-w", "stop"], { capture: false });
  console.log("stop requested");
}

if (action === "status") {
  const out = run("pg_ctl", ["-D", pgdata, "status"]);
  console.log(out.trim());
}

if (action === "identify") {
  // pg_controldata منبع رسمی؛ raw-check فقط نمایشی
  const ctl = run("pg_controldata", [pgdata]);
  const line = ctl.split("\n").find((l) => /Database system identifier/.test(l));
  console.log(line?.trim() ?? "not found");
  const buf = readFileSync(`${pgdata}/global/pg_control`);
  const hi = buf.readUInt32BE(8);
  const lo = buf.readUInt32BE(12);
  console.log(`raw-check: ${hi} * 2^32 + ${lo}`);
}
