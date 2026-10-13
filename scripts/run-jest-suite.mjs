/**
 * اجرای کل مجموعهٔ تست API — هر spec روی **کپی تازهٔ baseline** اجرا میشود.
 *
 * چرا: specها در rehearsal DB مشترک state جا میگذارند (مثلاً phase9-wave1
 * وضعیت چک/بانک را عوض میکند و wave2 را میشکند). بهتنهایی هر spec سبز است —
 * پس این runner قبل از هر spec، دیتابیس تمرین را از مبدا بازساری میکند.
 *
 * اجرا:
 *   node scripts/run-jest-suite.mjs
 * متغیرها:
 *   SOURCE_URL  — دیتابیس مبدا (پیش‌فرض همان DATABASE_URL اولیهٔ shell)
 *   DATABASE_URL — دیتابیس تمرین (الزامی — گارد jest.setup هم هست)
 */
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const apiDir = join(process.cwd(), "apps", "api");
const dbDir = join(process.cwd(), "packages", "database");

const target = process.env.DATABASE_URL ?? "";
if (!target) {
  console.error("DATABASE_URL لازم است — دیتابیس تمرین (هرگز Production).");
  process.exit(2);
}
if (/5433\/ghasedak(\?|$)/.test(target)) {
  console.error("DATABASE_URL به Production اشاره میکند — ممنوع (گارد jest.setup).");
  process.exit(2);
}
const source = process.env.SOURCE_URL ?? process.env.SOURCE_DB_URL ?? "";

const specs = readdirSync(join(apiDir, "test")).filter((f) => f.endsWith(".spec.ts")).sort();

const jestEnv = { ...process.env, FORCE_COLOR: "0", DATABASE_URL: target };
// heap کافی برای مجموعههای سنگین (journal/چک) — وگرنه jest وسط کار OOM میکند
jestEnv.NODE_OPTIONS = `--max-old-space-size=4096 ${process.env.NODE_OPTIONS ?? ""}`.trim();

/** بازساری دیتابیس تمرین از مبدا — خواندن با SOURCE_URL، نوشتن با DATABASE_URL (اسکریپت موقت) */
function resetRehearsal() {
  const script = join(apiDir, "tmp-reset-rehearsal.mjs");
  const body = `
import { Prisma, PrismaClient } from "@prisma/client";
const src = new PrismaClient({ datasources: { db: { url: process.env.SOURCE_URL } } });
const dst = new PrismaClient();
const models = Prisma.dmmf.datamodel.models.map((m) => ({ name: m.name, delegate: m.name[0].toLowerCase() + m.name.slice(1) }));
const q = (s) => s.replace(/"/g, '\\\\"');
const all = {};
for (const m of models) all[m.name] = await src[m.delegate].findMany();
await dst.$transaction(
  async (tx) => {
    await tx.$executeRawUnsafe(\`SET session_replication_role = replica\`);
    for (const m of models) await tx.$executeRawUnsafe(\`DELETE FROM "\${q(m.name)}"\`);
    let total = 0;
    for (const m of models) {
      for (const r of all[m.name] ?? []) {
        await tx[m.delegate].create({ data: r });
        total++;
      }
    }
    return total;
  },
  { timeout: 300000, maxWait: 10000 }
);
console.log("reset rows:", Object.values(all).reduce((s, a) => s + a.length, 0));
await src.$disconnect();
await dst.$disconnect();
`;
  writeFileSync(script, body, "utf8");
  execSync(`node ${JSON.stringify(script)}`, {
    cwd: apiDir,
    env: { ...process.env, SOURCE_URL: source, DATABASE_URL: target, FORCE_COLOR: "0" },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 300_000,
  });
  rmSync(script, { force: true });
}

// ۰) خواندن baseline از مبدا (یک‌بار) — با اتصال مستقیم مبدا
if (!source) {
  console.error("SOURCE_URL لازم است — دیتابیس مبدا (دمو).");
  process.exit(2);
}

let suitesPass = 0, suitesFail = 0, testsPass = 0, testsFail = 0;
const failed = [];

for (const spec of specs) {
  process.stdout.write(`${spec} … `);
  // ریست قبل از هر spec — هر تست از baseline پاک شروع میشود
  try {
    resetRehearsal();
  } catch (e) {
    console.log("SKIP (reset failed)");
    suitesFail++; failed.push(spec);
    continue;
  }
  try {
    // خروجی jest روی stderr است — 2>&1 تا در execSync گرفته شود
    const out = execSync(`npx jest test/${spec} --runInBand 2>&1`, {
      cwd: apiDir,
      env: jestEnv,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 600_000,
    }).toString();
    const clean = out.replace(/\x1b\[[0-9;]*m/g, "");
    const m = clean.match(/Tests:\s+(\d+) passed(?:,\s+(\d+) failed)?(?:,\s+(\d+) total)?/);
    const p = m ? Number(m[1]) : 0;
    const f = m && m[2] ? Number(m[2]) : 0;
    testsPass += p; testsFail += f;
    if (f > 0 || !m) {
      suitesFail++;
      failed.push(spec + (f ? ` (${f})` : ""));
      console.log(`FAIL${f ? ` (${f} failed)` : " (no summary)"}`);
    } else {
      suitesPass++;
      console.log(`OK (${p} tests)`);
    }
  } catch (e) {
    const out = ((e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "")).replace(/\x1b\[[0-9;]*m/g, "");
    const m = out.match(/Tests:\s+(\d+) passed(?:,\s+(\d+) failed)?/);
    const p = m ? Number(m[1]) : 0;
    const f = m && m[2] ? Number(m[2]) : 0;
    testsPass += p; testsFail += f;
    suitesFail++;
    failed.push(spec + (f ? ` (${f})` : " (crash)"));
    console.log(`FAIL${f ? ` (${f} failed, ${p} passed)` : " (crash)"}`);
  }
}

console.log(`\nنتیجهٔ مجموعه: ${suitesPass} مجموعه سبز / ${suitesFail} مجموعه قرمز از ${specs.length}`);
console.log(`تستها: ${testsPass} موفق / ${testsFail} ناموفق`);
if (failed.length) console.log("قرمزها:", failed.join("، "));
process.exit(suitesFail > 0 ? 1 : 0);
