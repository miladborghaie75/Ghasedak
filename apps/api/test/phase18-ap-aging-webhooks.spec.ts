/**
 * گام ۱۸ — سن بدهی (AP aging) + وبهوک خروجی: تست منطق بدون DB.
 *
 * سبدبندی تأخیر و امضای HMAC منطقِ محض‌اند؛ جریان ارسال/تلاش مجدد وبهوک با
 * Prisma stub و fetch جعلی پوشش داده می‌شود — همان الگوی بقیهٔ specهای
 * بدون-DB این مخزن (تست‌های DB-محور خرید از فاز ۱۳ پوشش داده شده‌اند).
 */
import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { agingBucketFor, buildApAging } from "../src/accounting/ap-aging";
import {
  WEBHOOK_MAX_ATTEMPTS,
  WebhooksService,
  verifyWebhookSignature,
  webhookSignature,
} from "../src/events/webhooks.service";

// ---------- AP aging ----------

describe("agingBucketFor", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  const day = 86_400_000;

  it("سررسید آینده/امروز → جاری", () => {
    expect(agingBucketFor(new Date(now.getTime() + 5 * day), now, now)).toBe("CURRENT");
    expect(agingBucketFor(now, now, now)).toBe("CURRENT");
  });

  it("تأخیر ۱–۳۰ / ۳۱–۶۰ / ۶۱–۹۰ / ۹۰+", () => {
    expect(agingBucketFor(new Date(now.getTime() - 1 * day), now, now)).toBe("D1_30");
    expect(agingBucketFor(new Date(now.getTime() - 30 * day), now, now)).toBe("D1_30");
    expect(agingBucketFor(new Date(now.getTime() - 31 * day), now, now)).toBe("D31_60");
    expect(agingBucketFor(new Date(now.getTime() - 60 * day), now, now)).toBe("D31_60");
    expect(agingBucketFor(new Date(now.getTime() - 61 * day), now, now)).toBe("D61_90");
    expect(agingBucketFor(new Date(now.getTime() - 90 * day), now, now)).toBe("D61_90");
    expect(agingBucketFor(new Date(now.getTime() - 91 * day), now, now)).toBe("D90_PLUS");
  });

  it("نبود سررسید → تاریخ ثبت مرجع است", () => {
    const createdAt = new Date(now.getTime() - 45 * day);
    expect(agingBucketFor(null, createdAt, now)).toBe("D31_60");
    const fresh = new Date(now.getTime() - 2 * day);
    expect(agingBucketFor(null, fresh, now)).toBe("D1_30");
  });
});

describe("buildApAging", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  const day = 86_400_000;

  it("تجمیع به سطر تامین‌کننده + جمع سبدی + رد شدن مانده صفر", () => {
    const report = buildApAging(
      [
        { supplierId: "s1", supplierName: "پارچه برتر", refType: "purchase_invoice", remaining: 1_000_000n, dueDate: new Date(now.getTime() - 10 * day), fallbackDate: now },
        { supplierId: "s1", supplierName: "پارچه برتر", refType: "purchase_invoice", remaining: 2_000_000n, dueDate: new Date(now.getTime() + 5 * day), fallbackDate: now },
        { supplierId: "s2", supplierName: "دودکمه", refType: "purchase_invoice", remaining: 500_000n, dueDate: new Date(now.getTime() - 120 * day), fallbackDate: now },
        { supplierId: "s3", supplierName: "تسویه‌شده", refType: "purchase_invoice", remaining: 0n, dueDate: null, fallbackDate: now },
      ],
      now,
    );
    expect(report.items).toHaveLength(2);
    const s1 = report.items.find((i) => i.supplierId === "s1")!;
    expect(s1.buckets.D1_30).toBe("1000000");
    expect(s1.buckets.CURRENT).toBe("2000000");
    expect(s1.total).toBe("3000000");
    expect(s1.invoiceCount).toBe(2);
    expect(report.totals.D90_PLUS).toBe("500000");
    expect(report.grandTotal).toBe("3500000");
    // سطرها بر اساس مانده نزولی
    expect(report.items[0].supplierId).toBe("s1");
  });
});

// ---------- وبهوک خروجی ----------

function makePrisma() {
  const endpoints: Array<Record<string, any>> = [];
  const deliveries: Array<Record<string, any>> = [];
  let idSeq = 0;
  const nextId = () => `id_${++idSeq}`;
  const now = () => new Date();
  return {
    _endpoints: endpoints,
    _deliveries: deliveries,
    webhookEndpoint: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: nextId(), active: true, createdAt: now(), ...data };
        endpoints.push(row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: any) => endpoints.find((e) => e.id === where.id) ?? null),
      findMany: jest.fn(async ({ where }: any) => {
        let rows = [...endpoints];
        if (where?.active !== undefined) rows = rows.filter((e) => e.active === where.active);
        if (where?.OR) {
          rows = rows.filter((e) =>
            where.OR.some((cond: any) => cond.events?.has !== undefined && e.events.includes(cond.events.has)),
          );
        }
        return rows;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = endpoints.find((e) => e.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
      delete: jest.fn(async ({ where }: any) => {
        const i = endpoints.findIndex((e) => e.id === where.id);
        return endpoints.splice(i, 1)[0];
      }),
    },
    webhookDelivery: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: nextId(), state: "PENDING", attempts: 0, responseCode: null, lastError: null, nextAttemptAt: now(), deliveredAt: null, createdAt: now(), ...data };
        deliveries.push(row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const d = deliveries.find((x) => x.id === where.id) ?? null;
        // relation endpoint — مثل include واقعی Prisma
        return d ? { ...d, endpoint: endpoints.find((e) => e.id === d.endpointId) ?? null } : null;
      }),
      findMany: jest.fn(async () => deliveries.filter((d) => d.state === "PENDING")),
      update: jest.fn(async ({ where, data }: any) => {
        const row = deliveries.find((d) => d.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    $transaction: jest.fn(async (arg: any) => (Array.isArray(arg) ? [] : arg)),
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
}

/** attempt در سرویس private است — در تست با تایپ‌کست صدا زده می‌شود (bound به نمونه) */
const attemptOf = (svc: WebhooksService) =>
  ((svc as unknown as { attempt: (id: string, ep: any) => Promise<void> }).attempt).bind(svc);

async function makeService() {
  const prisma = makePrisma() as any;
  const svc = new WebhooksService(prisma);
  return { prisma, svc };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("WebhooksService.createEndpoint", () => {
  it("https معتبر ساخته می‌شود و secret یک‌بارنمایش برمی‌گردد", async () => {
    const { prisma, svc } = await makeService();
    const ep = await svc.createEndpoint({ url: "https://example.com/hook", events: ["OrderPaid"], description: "انبار" });
    expect(ep.url).toBe("https://example.com/hook");
    expect(ep.secret).toMatch(/^whsec_[0-9a-f]{48}$/);
    expect(prisma._endpoints[0].secret).toBe(ep.secret);
  });

  it("http فقط برای localhost مجاز است", async () => {
    const { svc } = await makeService();
    await expect(svc.createEndpoint({ url: "http://localhost:3000/hook", events: ["OrderPaid"] })).resolves.toBeTruthy();
    await expect(svc.createEndpoint({ url: "http://example.com/hook", events: ["OrderPaid"] })).rejects.toThrow(BadRequestException);
    await expect(svc.createEndpoint({ url: "ftp://example.com", events: ["OrderPaid"] })).rejects.toThrow(BadRequestException);
    await expect(svc.createEndpoint({ url: "نامعتبر", events: ["OrderPaid"] })).rejects.toThrow(BadRequestException);
  });

  it("لیست رویداد خالی رد می‌شود", async () => {
    const { svc } = await makeService();
    await expect(svc.createEndpoint({ url: "https://example.com/hook", events: [] })).rejects.toThrow(BadRequestException);
  });
});

describe("امضای HMAC", () => {
  it("امضای درست تأیید و بدنهٔ دستکاری‌شده رد می‌شود", () => {
    const secret = "whsec_abc";
    const t = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ event: "OrderPaid" });
    const header = `t=${t},v1=${webhookSignature(secret, t, body)}`;
    expect(verifyWebhookSignature(secret, header, body)).toBe(true);
    expect(verifyWebhookSignature(secret, header, body + " ")).toBe(false);
    expect(verifyWebhookSignature("whsec_other", header, body)).toBe(false);
    expect(verifyWebhookSignature(secret, "v1=deadbeef", body)).toBe(false);
  });

  it("timestamp خارج از پنجرهٔ ۵ دقیقه‌ای رد می‌شود (ضد replay)", () => {
    const secret = "whsec_abc";
    const old = Math.floor(Date.now() / 1000) - 3600;
    const body = "{}";
    const header = `t=${old},v1=${webhookSignature(secret, old, body)}`;
    expect(verifyWebhookSignature(secret, header, body)).toBe(false);
  });
});

describe("WebhooksService.dispatchEvent", () => {
  it("فقط به endpointهای منطبق (دقیق یا *) ارسال و در 2xx OK می‌شود", async () => {
    const { prisma, svc } = await makeService();
    await svc.createEndpoint({ url: "https://a.example/hook", events: ["OrderPaid"] });
    await svc.createEndpoint({ url: "https://b.example/hook", events: ["*"] });
    await svc.createEndpoint({ url: "https://c.example/hook", events: ["OrderCreated"] });

    const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
    jest.spyOn(global, "fetch").mockImplementation(fetchMock as any);

    await svc.dispatchEvent("OrderPaid", { orderId: "o1" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toEqual(["https://a.example/hook", "https://b.example/hook"]);
    // همهٔ تحویل‌ها OK با کد ۲۰۰
    for (const d of prisma._deliveries) {
      expect(d.state).toBe("OK");
      expect(d.responseCode).toBe(200);
      expect(d.deliveredAt).toBeTruthy();
    }
    // هدر امضا روی درخواست هست و معتبر است
    const [url, init] = fetchMock.mock.calls[0];
    const sig = (init.headers as Record<string, string>)["x-ghasedak-signature"];
    const secret = prisma._endpoints[0].secret;
    expect(verifyWebhookSignature(secret, sig, init.body as string)).toBe(true);
    expect((init.headers as Record<string, string>)["x-ghasedak-event"]).toBe("OrderPaid");
    expect(url).toBe("https://a.example/hook");
  });

  it("شکست ۵۰۰ → PENDING با backoff؛ بعد از ۵ تلاش FAILED", async () => {
    const { prisma, svc } = await makeService();
    await svc.createEndpoint({ url: "https://a.example/hook", events: ["OrderPaid"] });
    jest.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 500 }) as any);

    await svc.dispatchEvent("OrderPaid", { orderId: "o1" });
    let d = prisma._deliveries[0];
    expect(d.state).toBe("PENDING");
    expect(d.attempts).toBe(1);
    expect(d.responseCode).toBe(500);
    expect(d.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    for (let i = 2; i <= WEBHOOK_MAX_ATTEMPTS; i++) {
      await attemptOf(svc)(d.id, prisma._endpoints[0]);
    }
    d = prisma._deliveries[0];
    expect(d.attempts).toBe(WEBHOOK_MAX_ATTEMPTS);
    expect(d.state).toBe("FAILED");
  });

  it("خطای شبکه (timeout/رفت‌وسپد ناموفق) هم جذب delivery می‌شود و رویداد نمی‌شکند", async () => {
    const { prisma, svc } = await makeService();
    await svc.createEndpoint({ url: "https://a.example/hook", events: ["OrderPaid"] });
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("fetch failed"));

    await expect(svc.dispatchEvent("OrderPaid", { orderId: "o1" })).resolves.toBeUndefined();
    const d = prisma._deliveries[0];
    expect(d.state).toBe("PENDING");
    expect(d.lastError).toBe("fetch failed");
  });
});

describe("WebhooksService.testPing و retryDelivery", () => {
  it("پینگ رویداد ping می‌سازد و endpoint ناموجود ۴۰۴ منطقی می‌دهد", async () => {
    const { svc } = await makeService();
    await expect(svc.testPing("nope")).rejects.toMatchObject({ response: { code: "NOT_FOUND" } });
  });

  it("retry تحویل OK رد می‌شود و تحویل PENDING دوباره تلاش می‌شود", async () => {
    const { prisma, svc } = await makeService();
    const ep = await svc.createEndpoint({ url: "https://a.example/hook", events: ["OrderPaid"] });
    const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
    jest.spyOn(global, "fetch").mockImplementation(fetchMock as any);

    await svc.dispatchEvent("OrderPaid", {});
    const okId = prisma._deliveries[0].id;
    await expect(svc.retryDelivery(okId)).rejects.toMatchObject({ response: { code: "INVALID_STATE" } });

    // یک تحویل شکسته دستی می‌سازیم و retry می‌کنیم
    const broken = await prisma.webhookDelivery.create({ data: { endpointId: ep.id, eventName: "OrderPaid", payload: {}, state: "FAILED", attempts: 5, lastError: "HTTP 500" } });
    const res = await svc.retryDelivery(broken.id);
    expect(res!.state).toBe("OK");
    expect(res!.attempts).toBe(6);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
