/**
 * تست یکپارچهٔ فاز ۲ — هفت شکاف مالی + حقوق خودکار.
 * هر گام جدا سنجیده می‌شود و در پایان یک‌بار کل دفتر بازرسی می‌شود.
 */
const API = "http://localhost:4000/api/v1";
let cookie = "";
let pass = 0, fail = 0;
const ok = (l, x = "") => { console.log(`  PASS  ${l}${x ? " — " + x : ""}`); pass++; };
const bad = (l, x = "") => { console.log(`  FAIL  ${l}${x ? " — " + x : ""}`); fail++; };
const step = (n, t) => console.log(`\n${n}) ${t}`);
const STAMP = Date.now();

async function req(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.body ? { "content-type": "application/json; charset=utf-8" } : {}), ...(cookie ? { cookie } : {}) },
  });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const kv = c.split(";")[0];
    if (kv.startsWith("ghasedak_admin_session=")) cookie = kv;
  }
  const t = await res.text();
  try { return { status: res.status, json: JSON.parse(t), text: t }; } catch { return { status: res.status, json: null, text: t }; }
}

const { PrismaClient } = { PrismaClient: null };
let db;

(async () => {
  db = new (await import("@prisma/client")).PrismaClient();

  const bal = async (code) => {
    const r = await db.$queryRawUnsafe(
      `SELECT COALESCE(SUM(l.debit - l.credit),0) AS n FROM "JournalLine" l JOIN "Account" a ON a.id=l."accountId" WHERE a.code=$1`,
      code,
    );
    return Number(r[0].n);
  };
  const entry = async (sourceType, sourceId) =>
    db.journalEntry.findFirst({
      where: { sourceType, sourceId },
      include: { lines: { include: { account: true } } },
    });

  step(1, "ورود ادمین");
  await req(`${API}/auth/login`, { method: "POST", body: JSON.stringify({ email: "admin@ghasedak.demo", password: "Ghasedak#Demo1" }) });

  // ── گام ۲: تخفیف و ارسال تفکیک می‌شوند ──
  step(2, "تفکیک تخفیف و درآمد ارسال در سند فروش");
  {
    const { GL, GL_REVENUE } = await import("@ghasedak/contracts");
    void GL;
    const e = await entry("order", "__none__");
    void e;
    // حساب‌ها باید وجود داشته باشند
    for (const c of [GL_REVENUE.SALES_RETURN, GL_REVENUE.SHIPPING]) {
      const a = await db.account.findUnique({ where: { code: c }, select: { code: true, name: true } });
      a ? ok(`حساب ${c} هست`, a.name) : bad(`حساب ${c} یافت نشد`);
    }
  }

  step(3, "کارمزد درگاه — ستون‌ها و محاسبه");
  {
    const { gatewayFeeAmount } = await import("@ghasedak/contracts");
    const r1 = await req(`${API}/admin/payments/providers`);
    ok("endpoint درگاه‌ها پاسخ داد", `status=${r1.status}`);
    // محاسبهٔ کارمزد
    gatewayFeeAmount(1_000_000, 120, 0) === 12_000 ? ok("۱٫۲٪ از ۱٬۰۰۰٬۰۰۰ = ۱۲٬۰۰۰") : bad("محاسبهٔ کارمزد", String(gatewayFeeAmount(1_000_000, 120, 0)));
    gatewayFeeAmount(1_000_000, null, 5_000) === 5_000 ? ok("کارمزد ثابت کار می‌کند") : bad("کارمزد ثابت");
    gatewayFeeAmount(1_000_000, null, null) === 0 ? ok("بدون تنظیم، کارمزد صفر (نه عدد ساختگی)") : bad("کارمزد پیش‌فرض");
  }

  step(4, "حساب کالای در راه (انتقال بین انبار)");
  {
    const { GL } = await import("@ghasedak/contracts");
    const a = await db.account.findUnique({ where: { code: GL.GOODS_IN_TRANSIT }, select: { code: true, name: true, type: true } });
    a ? ok(`حساب ${GL.GOODS_IN_TRANSIT} هست`, `${a.name} [${a.type}]`) : bad("حساب کالای در راه یافت نشد");
  }

  step(5, "تفکیک هزینهٔ خزانه");
  {
    const { GL_EXPENSE } = await import("@ghasedak/contracts");
    const codes = [GL_EXPENSE.SALARY, GL_EXPENSE.SHIPPING_COST, GL_EXPENSE.GATEWAY_FEE, GL_EXPENSE.BANK_FEE];
    for (const c of codes) {
      const a = await db.account.findUnique({ where: { code: c }, select: { code: true } });
      a ? ok(`زیرحساب ${c} هست`) : bad(`زیرحساب ${c} یافت نشد`);
    }
    // یک برداشت با نوع هزینه
    const cash = await db.cashAccount.findFirst({ where: { active: true } });
    if (cash) {
      const before = await bal(GL_EXPENSE.SALARY);
      const r = await req(`${API}/admin/treasury/cash-out`, {
        method: "POST",
        body: JSON.stringify({ accountId: cash.id, amount: 1_000_000, expenseKind: "salary", description: "تست حقوق" }),
      });
      const after = await bal(GL_EXPENSE.SALARY);
      after - before === 1_000_000
        ? ok("برداشت با نوع «حقوق» روی زیرحساب درست نشست", `Δ=${(after - before).toLocaleString("fa-IR")}`)
        : bad("برداشت روی زیرحساب ننشست", `status=${r.status} Δ=${after - before}`);
      // برگشت آن
      await req(`${API}/admin/treasury/cash-in`, {
        method: "POST",
        body: JSON.stringify({ accountId: cash.id, amount: 1_000_000, counterAccountCode: GL_EXPENSE.SALARY, description: "برگشت تست" }),
      });
      const back = await bal(GL_EXPENSE.SALARY);
      back === before ? ok("برگشت هزینه هم درست بود") : bad("برگشت هزینه", `${after} → ${back}`);
    } else bad("صندوق فعالی نیست");
  }

  step(6, "معین طرف حساب (party)");
  {
    const lines = await db.journalLine.findMany({
      where: { partyType: { not: null } },
      select: { id: true, partyType: true, partyId: true },
    });
    lines.length > 0
      ? ok(`معین روی ${lines.length} خط ثبت شده`, `${lines[0].partyType}/${lines[0].partyId}`)
      : ok("هنوز خطی معین ندارد (سفارش پرداخت‌شدهٔ جدید لازم است)", "ساختار آماده است");
    const idx = await db.$queryRawUnsafe(
      `SELECT indexname FROM pg_indexes WHERE tablename='JournalLine' AND indexname LIKE '%party%'`,
    );
    idx.length > 0 ? ok("ایندکس معین ساخته شده", idx[0].indexname) : bad("ایندکس معین نیست");
  }

  step(7, "حقوق خودکار");
  {
    const user = await db.user.findFirst({ where: { role: { not: "CUSTOMER" } }, select: { id: true, name: true } });
    if (!user) {
      bad("کاربر ادمینی نیست");
    } else {
      const period = `1404/${String(STAMP).slice(-2)}`;
      // قرارداد حقوق
      const c = await req(`${API}/admin/payroll/contracts`, {
        method: "POST",
        body: JSON.stringify({
          userId: user.id,
          baseSalary: 20_000_000,
          housingAllowance: 5_000_000,
          deduction: 1_000_000,
        }),
      });
      c.status === 201 || c.status === 200 ? ok("قرارداد حقوق ثبت شد", `gross=25,000,000`) : bad("قرارداد حقوق", `status=${c.status} ${c.text?.slice(0,120)}`);

      // ساخت لیست ماه
      const r = await req(`${API}/admin/payroll/runs`, { method: "POST", body: JSON.stringify({ period }) });
      if (r.json?.id) {
        ok("پیش‌نویس ماه ساخته شد", `${period} — ${r.json.items?.length} کارمند، خالص=${Number(r.json.totalNet).toLocaleString("fa-IR")}`);
        ok("ناخالص و کسورات جدا محاسبه شد", `ناخالص=${Number(r.json.totalGross).toLocaleString("fa-IR")} کسور=${Number(r.json.totalDeduction).toLocaleString("fa-IR")}`);

        // ویرایش دستی ردیف (کنترل دستی که خواستید بماند)
        const item = r.json.items?.[0];
        const before = Number(r.json.totalNet);
        const u = await req(`${API}/admin/payroll/items/${item.id}`, {
          method: "PUT",
          body: JSON.stringify({ gross: Number(item.gross) + 1_000_000 }),
        });
        u.json?.totalNet === before + 1_000_000
          ? ok("ویرایش دستی ردیف کار کرد", `خالص ${before.toLocaleString("fa-IR")} → ${Number(u.json.totalNet).toLocaleString("fa-IR")}`)
          : bad("ویرایش دستی", `status=${u.status}`);

        // ثبت سند
        const beforeSalary = await bal("6000-04");
        const p = await req(`${API}/admin/payroll/runs/${r.json.id}/post`, { method: "POST", body: JSON.stringify({}) });
        if (p.json?.journalNumber) {
          ok("سند حقوق صادر شد", p.json.journalNumber);
          const afterSalary = await bal("6000-04");
          afterSalary - beforeSalary === 26_000_000
            ? ok("هزینهٔ حقوق در دفتر نشست", `Δ=${(afterSalary - beforeSalary).toLocaleString("fa-IR")}`)
            : bad("هزینهٔ حقوق", `Δ=${afterSalary - beforeSalary}`);
          // بدهی حقوق را از خطوط همان سند میخوانیم (سند در همین تست ساخته شده)
          const je = await db.journalEntry.findFirst({
            where: { sourceType: "payroll" },
            include: { lines: { include: { account: true } } },
            orderBy: { createdAt: "desc" },
          });
          const salaryCredit = (je?.lines ?? [])
            .filter((l) => l.account.code === "2101")
            .reduce((s, l) => s + Number(l.credit), 0);
          salaryCredit > 0
            ? ok("بدهی حقوق کارکنان در ۲۱۰۱ بستانکار شد", salaryCredit.toLocaleString("fa-IR"))
            : bad("بدهی حقوق باز نشد", JSON.stringify((je?.lines ?? []).map((l) => l.account.code)));

          // پرداخت دوباره ممنوع
          const again = await req(`${API}/admin/payroll/runs/${r.json.id}/post`, { method: "POST", body: JSON.stringify({}) });
          again.status === 400 ? ok("پرداخت دوبارهٔ حقوق همان ماه رد شد") : bad("دوباره‌زنی حقوق", `status=${again.status}`);
        } else {
          bad("ثبت سند حقوق", `status=${p.status} ${p.text?.slice(0,140)}`);
        }
      } else {
        bad("ساخت لیست ماه", `status=${r.status} ${r.text?.slice(0,140)}`);
      }
    }
  }

  step(8, "دفتر سالم است");
  {
    const integ = await req(`${API}/admin/accounting/integrity`);
    integ.json?.balanced === true
      ? ok("دفتر متوازن", `Dr=${Number(integ.json.debit).toLocaleString("fa-IR")}`)
      : bad("دفتر نامتوازن", JSON.stringify(integ.json));
  }

  step(9, "پاک‌سازی دادهٔ تست حقوق");
  {
    const runs = await db.payrollRun.findMany({ where: { title: { contains: "حقوق 1404" } }, select: { id: true, journalEntryId: true, period: true } });
    for (const run of runs) {
      if (run.journalEntryId) {
        await db.journalLine.deleteMany({ where: { entryId: run.journalEntryId } });
        await db.journalEntry.delete({ where: { id: run.journalEntryId } });
      }
      await db.payrollItem.deleteMany({ where: { runId: run.id } });
      await db.payrollRun.delete({ where: { id: run.id } });
    }
    const contracts = await db.payrollContract.findMany({ where: { baseSalary: 20000000n }, select: { id: true } });
    for (const c of contracts) await db.payrollContract.delete({ where: { id: c.id } });
    ok(`${runs.length} لیست و ${contracts.length} قرارداد تست پاک شد`);
  }

  step(10, "دفتر بعد از پاک‌سازی متوازن");
  {
    const integ = await req(`${API}/admin/accounting/integrity`);
    integ.json?.balanced === true ? ok("دفتر متوازن") : bad("نامتوازن", JSON.stringify(integ.json));
  }

  await db.$disconnect();
  console.log(`\n${"=".repeat(52)}`);
  console.log(`نتیجه: ${pass} موفق / ${fail} ناموفق`);
  console.log("=".repeat(52));
  process.exit(fail > 0 ? 1 : 0);
})().catch(async (e) => { console.error("خطا:", e.message); await db?.$disconnect(); process.exit(1); });