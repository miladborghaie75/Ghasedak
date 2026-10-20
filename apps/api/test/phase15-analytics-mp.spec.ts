/**
 * گام ۱۵-۵ — شاهد مکانیکی Measurement Protocol.
 *
 * به‌جای GA4 واقعی، یک endpoint محلی (شاهد) بالا می‌آوریم و GA4_MP_ENDPOINT
 * را به آن اشاره می‌دهیم؛ بعد `sendPurchase` را صدا می‌زنیم و **دقیقاً همان
 * چیزی که روی سیم می‌رود** را می‌سنجم:
 *  ۱) endpoint/کوئری‌ها: mp/collect + measurement_id + api_secret؛
 *  ۲) بدنهٔ رویداد: name=purchase، transaction_id کد سفارش، value/ارز/اقلام؛
 *  ۳) client_id: ۳۲ hex و پایدار برای کد سفارش یکسان (بدون دادهٔ شخصی)؛
 *  ۴) فال‌بک کلید سروری: بدون GA4_MEASUREMENT_ID همان NEXT_PUBLIC_ خوانده می‌شود؛
 *  ۵) خاموش صادقانه: بدون هر دو کلید هیچ درخواستی نمی‌رود و false برمی‌گردد.
 *
 * تست خالص است — به DB وصل نمی‌شود (jest.setup فقط URL صریح می‌خواهد).
 */
import "reflect-metadata";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { PrismaService } from "../src/prisma/prisma.service";
import { MeasurementService } from "../src/analytics/measurement.service";

/** درخواست‌های دریافتیٔ شاهد */
type WitnessHit = { url: string; body: any };

describe("Phase 15 — شاهد مکانیکی GA4 Measurement Protocol", () => {
  let witness: Server;
  let hits: WitnessHit[];
  let baseUrl = "";
  const svc = () => new MeasurementService(new PrismaService());

  const ENV_KEYS = ["GA4_MEASUREMENT_ID", "NEXT_PUBLIC_GA4_MEASUREMENT_ID", "GA4_API_SECRET", "GA4_MP_ENDPOINT"] as const;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    hits = [];
    witness = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        hits.push({
          url: req.url ?? "",
          body: Buffer.concat(chunks).toString("utf8") ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null,
        });
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
      });
    });
    await new Promise<void>((resolve) => witness.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(witness.address() as AddressInfo).port}/mp/collect`;
    for (const k of ENV_KEYS) saved[k] = process.env[k];
  });

  afterAll(async () => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    }
    await new Promise<void>((resolve) => witness.close(() => resolve()));
  });

  /** env را ست می‌کند و مطمئن می‌شود سرویس آماده است */
  const configure = (opts: { serverId?: string; publicId?: string; secret?: string }) => {
    if (opts.serverId === undefined) delete process.env.GA4_MEASUREMENT_ID;
    else process.env.GA4_MEASUREMENT_ID = opts.serverId;
    if (opts.publicId === undefined) delete process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID;
    else process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID = opts.publicId;
    if (opts.secret === undefined) delete process.env.GA4_API_SECRET;
    else process.env.GA4_API_SECRET = opts.secret;
    process.env.GA4_MP_ENDPOINT = baseUrl;
  };

  it("۱) رویداد purchase با endpoint/کوئری/بدنهٔ درست روی سیم می‌رود", async () => {
    configure({ serverId: "G-WITNESS-01", secret: "wit-secret" });
    const ok = await svc().sendPurchase({
      orderCode: "GH-241001-AB12",
      amount: 1_250_000,
      currency: "IRT",
      items: [
        { item_id: "SKU-1", item_name: "تی‌شرت نمونه", quantity: 2, price: 500_000 },
      ],
    });
    expect(ok).toBe(true);
    expect(hits).toHaveLength(1);

    const hit = hits[0];
    // endpoint و کوئری‌ها — همان قالب GA4 MP
    const u = new URL(hit.url, baseUrl);
    expect(u.pathname).toBe("/mp/collect");
    expect(u.searchParams.get("measurement_id")).toBe("G-WITNESS-01");
    expect(u.searchParams.get("api_secret")).toBe("wit-secret");

    // بدنهٔ رویداد
    expect(hit.body.client_id).toMatch(/^[0-9a-f]{32}$/);
    expect(hit.body.events).toHaveLength(1);
    const ev = hit.body.events[0];
    expect(ev.name).toBe("purchase");
    expect(ev.params.transaction_id).toBe("GH-241001-AB12");
    expect(ev.params.value).toBe(1_250_000);
    expect(ev.params.currency).toBe("IRT");
    expect(ev.params.items).toEqual([
      { item_id: "SKU-1", item_name: "تی‌شرت نمونه", quantity: 2, price: 500_000 },
    ]);

    // هیچ دادهٔ شخصی (موبایل/آدرس) روی سیم نمی‌رود — payload فقط همین فیلدهاست
    const flat = JSON.stringify(hit.body);
    expect(flat).not.toMatch(/09\d{9}/);
    expect(Object.keys(hit.body)).toEqual(["client_id", "events"]);
  });

  it("۲) client_id برای کد سفارش یکسان پایدار است (ریلود دوباره‌شماری نمی‌کند)", async () => {
    configure({ serverId: "G-WITNESS-01", secret: "wit-secret" });
    const a = await svc().sendPurchase({ orderCode: "GH-SAME-ORDER", amount: 1 });
    const b = await svc().sendPurchase({ orderCode: "GH-SAME-ORDER", amount: 1 });
    expect(a).toBe(true);
    expect(b).toBe(true);
    const [h1, h2] = hits.slice(-2);
    expect(h1.body.client_id).toBe(h2.body.client_id);
  });

  it("۳) فال‌بک: بدون GA4_MEASUREMENT_ID همان NEXT_PUBLIC_ خوانده می‌شود", async () => {
    configure({ publicId: "G-PUBLIC-77", secret: "wit-secret" });
    expect(svc().isConfigured()).toBe(true);
    const ok = await svc().sendPurchase({ orderCode: "GH-FALLBACK-1", amount: 99 });
    expect(ok).toBe(true);
    const hit = hits[hits.length - 1];
    expect(new URL(hit.url, baseUrl).searchParams.get("measurement_id")).toBe("G-PUBLIC-77");
  });

  it("۴) خاموش صادقانه: بدون کلیدها هیچ درخواستی نمی‌رود و false برمی‌گردد", async () => {
    configure({ secret: undefined });
    hits = []; // شمارش تازه برای همین حالت
    const ok = await svc().sendPurchase({ orderCode: "GH-OFF-1", amount: 1 });
    expect(ok).toBe(false);
    expect(hits).toHaveLength(0); // شاهد هیچ‌چیز نگرفت — «ارسال شد» جعلی هم نیست
    expect(svc().isConfigured()).toBe(false);
  });

  it("۵) بدنهٔ خراب شاهد (۵۰۰) → false و بدون throw", async () => {
    // شاهد را موقتاً خطادار می‌کنیم تا مسیر «پاسخ غیر 2xx» را ببینیم
    await new Promise<void>((resolve) => witness.close(() => resolve()));
    const broken = createServer((_req, res) => {
      res.writeHead(500);
      res.end("boom");
    });
    await new Promise<void>((resolve) => broken.listen(0, "127.0.0.1", resolve));
    process.env.GA4_MP_ENDPOINT = `http://127.0.0.1:${(broken.address() as AddressInfo).port}/mp/collect`;
    configure({ serverId: "G-WITNESS-01", secret: "wit-secret" });
    process.env.GA4_MP_ENDPOINT = `http://127.0.0.1:${(broken.address() as AddressInfo).port}/mp/collect`;
    const ok = await svc().sendPurchase({ orderCode: "GH-ERR-1", amount: 1 });
    expect(ok).toBe(false); // sendPurchase هرگز throw نمی‌کند (مسیر finalizePaid سالم می‌ماند)
    await new Promise<void>((resolve) => broken.close(() => resolve()));
  });
});
