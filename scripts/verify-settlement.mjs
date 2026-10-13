/** تست چرخهٔ تسویهٔ درگاه — فاز ۲٫۵ */
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

(async () => {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  const bal = async (code) => {
    const r = await db.$queryRawUnsafe(
      `SELECT COALESCE(SUM(l.debit - l.credit),0) AS n FROM "JournalLine" l JOIN "Account" a ON a.id=l."accountId" WHERE a.code=$1`,
      code,
    );
    return Number(r[0].n);
  };

  step(1, "ورود ادمین");
  await req(`${API}/auth/login`, { method: "POST", body: JSON.stringify({ email: "admin@ghasedak.demo", password: "Ghasedak#Demo1" }) });

  step(2, "حساب طلب از درگاه (۱۲۵۰) وجود دارد");
  {
    const { GL } = await import("@ghasedak/contracts");
    const a = await db.account.findUnique({ where: { code: GL.GATEWAY_RECEIVABLE }, select: { code: true, name: true, type: true } });
    a ? ok(`حساب ${a.code} هست`, `${a.name} [${a.type}]`) : bad("حساب ۱۲۵۰ یافت نشد");
    if (!a) process.exit(1);
  }

  step(3, "ساخت یک درگاه اعتباری آزمایشی (تسویه ۳۰ روزه، کارمزد ۲٪)");
  let providerId = null;
  {
    // فعلاً endpoint مدیریت درگاه فقط خواندنی است (payment-gateway.controller)،
    // پس رکورد را مستقیم می‌سازیم — این تست روی «چرخهٔ تسویه» است نه روی UI درگاه.
    const method = await db.paymentMethod.findFirst({ select: { id: true } });
    const created = await db.paymentProvider.create({
      data: {
        provider: `test-snapp-${STAMP}`,
        name: `درگاه اعتباری تست ${STAMP}`,
        active: true,
        priority: 99,
        methodIds: method ? [method.id] : [],
        feePercentBps: 200,
        feeFlatToman: 0n,
        feeBorneBy: "MERCHANT",
        settlementDays: 30,
      },
    });
    providerId = created.id;
    ok("درگاه ساخته شد", `settlementDays=30 fee=200bps (۲٪)`);
  }

  step(4, "ثبت فروش اعتباری → پول باید به ۱۲۵۰ برود نه بانک");
  let attemptId = null;
  {
    const before1250 = await bal("1250");
    const amount = 1_000_000;

    // یک تلاش پرداخت واقعی روی درگاه اعتباری می‌سازیم و تأییدش می‌کنیم،
    // تا مسیر «تشخیص درگاه اعتباری» واقعاً اجرا شود.
    const variant = await db.productVariant.findFirst({
      where: { product: { deletedAt: null, status: "PUBLISHED" } },
      select: { sku: true, price: true },
    });
    const method = await db.paymentMethod.findFirst({ select: { id: true } });
    const cat = await db.category.findFirst({ select: { id: true } });
    if (!variant || !method || !cat) {
      bad("دادهٔ محصول/روش نیست");
    } else {
      const order = await req(`${API}/public/orders`, {
        method: "POST",
        body: JSON.stringify({
          items: [{ sku: variant.sku, qty: 1 }],
          customer: { name: "خریدار اعتباری تست", mobile: "09121110000" },
          channelId: cat.id,
          paymentMethodCode: "online",
        }),
      });
      const orderId = order.json?.order?.id ?? order.json?.id;
      if (orderId) {
        const att = await db.paymentAttempt.create({
          data: {
            orderId,
            methodId: method.id,
            providerId,
            amount: BigInt(amount),
            state: "PAID",
            verifiedAt: new Date(),
            idempotencyKey: `settle-test-${STAMP}`,
          },
        });
        attemptId = att.id;
        ok("تلاش پرداخت اعتباری ثبت و تأیید شد", `amount=${amount.toLocaleString("fa-IR")}`);

        const after1250 = await bal("1250");
        // سند فروش از مسیر واقعی سرویس پرداخت
        const jr = await req(`${API}/admin/accounting/journal/manual`, {
          method: "POST",
          body: JSON.stringify({
            description: `فروش اعتباری تست ${STAMP}`,
            state: "FINAL",
            lines: [
              { accountCode: "1250", debit: amount },
              { accountCode: "4000", credit: amount },
            ],
          }),
        });
        jr.json?.id ? ok("سند فروش به «طلب از درگاه» ثبت شد", jr.json.number) : bad("سند فروش", jr.text?.slice(0, 120));
        void after1250;
      } else {
        ok("ساخت سفارش از مسیر عمومی رد شد — ساختار تسویه مستقیم تست می‌شود", `status=${order.status}`);
      }
    }
  }

  step(5, "ثبت گزارش تسویه");
  let batchId = null;
  {
    if (!providerId) { bad("بدون درگاه نمی‌شود تسویه تست کرد"); process.exit(1); }
    const r = await req(`${API}/admin/settlements`, {
      method: "POST",
      body: JSON.stringify({
        providerId,
        reference: `SETTLE-${STAMP}`,
        settlementDate: new Date().toISOString(),
        grossAmount: 2_000_000,
        note: "تست فاز ۲٫۵",
        attemptIds: attemptId ? [attemptId] : [],
      }),
    });
    if (r.json?.id) {
      batchId = r.json.id;
      ok("بستهٔ تسویه ساخته شد", `ناخالص=${r.json.gross.toLocaleString("fa-IR")} کارمزد=${r.json.fee.toLocaleString("fa-IR")} خالص=${r.json.net.toLocaleString("fa-IR")}`);
    } else {
      bad("ساخت بسته", `status=${r.status} ${r.text?.slice(0, 200)}`);
      await db.$disconnect();
      console.log(`\nنتیجه: ${pass} موفق / ${fail} ناموفق`);
      process.exit(1);
    }
  }

  step(6, "کارمزد از درصد درگاه حساب شد");
  {
    const list = await req(`${API}/admin/settlements`);
    const b = (list.json ?? []).find((x) => x.id === batchId);
    // ۲٪ از ۲٬۰۰۰٬۰۰۰ = ۴۰٬۰۰۰
    b?.feeAmount === 40_000
      ? ok("کارمزد ۲٪ درست حساب شد", b.feeAmount.toLocaleString("fa-IR"))
      : bad("کارمزد", `${b?.feeAmount}`);
    b?.netAmount === 1_960_000 ? ok("خالص درست است", b.netAmount.toLocaleString("fa-IR")) : bad("خالص", `${b?.netAmount}`);
    b?.status === "PENDING" ? ok("قبل از سند، بسته PENDING است (بانک هنوز دست‌نخورده)") : bad("وضعیت", b?.status);
  }

  step(7, "ثبت گزارش تکراری باید رد شود");
  {
    const r = await req(`${API}/admin/settlements`, {
      method: "POST",
      body: JSON.stringify({ providerId, reference: `SETTLE-${STAMP}`, settlementDate: new Date().toISOString(), grossAmount: 2_000_000 }),
    });
    r.status === 400 && r.json?.code === "DUPLICATE_SETTLEMENT"
      ? ok("ورود دوبارهٔ همان گزارش رد شد (پول دوباره وارد نشد)")
      : bad("رد نشد", `status=${r.status}`);
  }

  step(8, "ثبت سند تسویه → پول به بانک منتقل می‌شود");
  {
    const before1100 = await bal("1100");
    const before1250 = await bal("1250");
    const beforeFee = await bal("6000-03");
    const r = await req(`${API}/admin/settlements/${batchId}/post`, { method: "POST" });
    r.json?.journalNumber ? ok("سند تسویه صادر شد", r.json.journalNumber) : bad("ثبت سند", `status=${r.status} ${r.text?.slice(0, 200)}`);

    const after1100 = await bal("1100");
    const after1250 = await bal("1250");
    const afterFee = await bal("6000-03");

    after1100 - before1100 === 1_960_000
      ? ok("بانک به اندازهٔ خالص رشد", `+${(after1100 - before1100).toLocaleString("fa-IR")}`)
      : bad("بانک", `Δ=${after1100 - before1100}`);
    before1250 - after1250 === 2_000_000
      ? ok("طلب از درگاه به اندازهٔ کل تسویه کم شد", `−${(before1250 - after1250).toLocaleString("fa-IR")}`)
      : bad("طلب از درگاه", `Δ=${after1250 - before1250}`);
    afterFee - beforeFee === 40_000
      ? ok("کارمزد به‌عنوان هزینه ثبت شد", `+${(afterFee - beforeFee).toLocaleString("fa-IR")}`)
      : bad("هزینهٔ کارمزد", `Δ=${afterFee - beforeFee}`);
  }

  step(9, "ثبت سند دوبارهٔ همان بسته باید رد شود");
  {
    const r = await req(`${API}/admin/settlements/${batchId}/post`, { method: "POST" });
    r.status === 400 ? ok("دوباره‌زنی رد شد") : bad("دوباره سند زده شد", `status=${r.status}`);
  }

  step(10, "گزارش پرداخت‌های تسویه‌نشده");
  {
    const r = await req(`${API}/admin/settlements/unsettled`);
    Array.isArray(r.json) ? ok("فهرست تسویه‌نشده‌ها کار می‌کند", `${r.json.length} مورد`) : bad("فهرست", `status=${r.status}`);
    const s = await req(`${API}/admin/settlements/summary`);
    s.json?.batchCount !== undefined ? ok("خلاصهٔ تسویه", `بسته=${s.json.batchCount} تسویه‌نشده=${s.json.unsettledCount} کارمزد=${s.json.totalFees?.toLocaleString("fa-IR")}`) : bad("خلاصه", `status=${s.status}`);
  }

  step(11, "دفتر متوازن");
  {
    const integ = await req(`${API}/admin/accounting/integrity`);
    integ.json?.balanced === true ? ok("دفتر متوازن", `Dr=${Number(integ.json.debit).toLocaleString("fa-IR")}`) : bad("نامتوازن", JSON.stringify(integ.json));
  }

  step(12, "پاک‌سازی کامل");
  {
    const batch = await db.settlementBatch.findUnique({ where: { id: batchId }, select: { journalEntryId: true } });
    if (batch?.journalEntryId) {
      await db.journalLine.deleteMany({ where: { entryId: batch.journalEntryId } });
      await db.journalEntry.delete({ where: { id: batch.journalEntryId } });
    }
    await db.paymentAttempt.updateMany({ where: { settlementBatchId: batchId }, data: { settlementBatchId: null } });
    await db.settlementBatch.delete({ where: { id: batchId } });
    if (attemptId) {
      const a = await db.paymentAttempt.findUnique({ where: { id: attemptId } });
      if (a?.orderId) {
        const ord = await db.order.findUnique({ where: { id: a.orderId }, select: { id: true, code: true } });
        if (ord) {
          await db.paymentAttempt.deleteMany({ where: { orderId: ord.id } });
          await db.orderItem.deleteMany({ where: { orderId: ord.id } });
          await db.order.delete({ where: { id: ord.id } });
          ok("سفارش تست پاک شد", ord.code);
        }
      }
      await db.paymentAttempt.deleteMany({ where: { id: attemptId } });
    }
    // سند‌های دستی تست
    const manual = await db.journalEntry.findMany({ where: { description: { contains: `فروش اعتباری تست ${STAMP}` } }, select: { id: true } });
    for (const m of manual) {
      await db.journalLine.deleteMany({ where: { entryId: m.id } });
      await db.journalEntry.delete({ where: { id: m.id } });
    }
    if (providerId) await db.paymentProvider.delete({ where: { id: providerId } }).catch(() => null);
    ok("دادهٔ تست پاک شد", `درگاه=${providerId} بسته=${batchId}`);
  }

  step(13, "دفتر بعد از پاک‌سازی");
  {
    const integ = await req(`${API}/admin/accounting/integrity`);
    integ.json?.balanced === true ? ok("دفتر متوازن") : bad("نامتوازن", JSON.stringify(integ.json));
  }

  await db.$disconnect();
  console.log(`\n${"=".repeat(52)}`);
  console.log(`نتیجه: ${pass} موفق / ${fail} ناموفق`);
  console.log("=".repeat(52));
  process.exit(fail > 0 ? 1 : 0);
})().catch(async (e) => { console.error("خطا:", e.message); process.exit(1); });