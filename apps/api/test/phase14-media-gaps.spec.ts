/**
 * فاز ۱۴ — شکاف رسانه: دانلود مستقیم، لینک عمومی، ابعاد از محتوای واقعی فایل.
 * روی rehearsal و دیسک واقعی اجرا می‌شود؛ خواندن ابعاد PNG/JPEG تابع خالص است.
 */
import "reflect-metadata";
import { PrismaService } from "../src/prisma/prisma.service";
import { NotificationDispatcherService } from "../src/events/notification-dispatcher.service";
import { SmsProvidersService } from "../src/events/sms-providers.service";
import { CapabilitiesController, readImageSize } from "../src/admin/capabilities.controller";

jest.setTimeout(120_000);

/** کوچک‌ترین PNG معتبر 3×2 (۱ بایت فیلتر صفر برای هر ردیف) */
const PNG_3x2 = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // signature
  Buffer.from([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]), // IHDR len+type
  Buffer.from([0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00, 0x02]), // 3×2
  Buffer.from([0x08, 0x06, 0x00, 0x00, 0x00]), // bitdepth/color/compression/filter/interlace
  Buffer.from([0x6c, 0x92, 0x8c, 0x31]), // CRC (اینجا اعتبارسنجی نمی‌شود)
  Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]), // IEND
]);

/** JPEG حداقلی 16×8 با SOF0 واقعی */
function jpeg16x8(): Buffer {
  const seg = (marker: number, body: Buffer) => {
    const len = Buffer.from([0, body.length + 2]);
    return Buffer.concat([Buffer.from([0xff, marker]), len, body]);
  };
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]), // SOI
    // APP0 JFIF
    seg(0xe0, Buffer.from([0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00])),
    // DQT
    seg(0xdb, Buffer.concat([Buffer.from([0x00]), Buffer.alloc(64, 0x10)])),
    // SOF0: precision 8، ارتفاع 8، عرض 16، 1 مؤلفه
    seg(0xc0, Buffer.from([0x08, 0x00, 0x08, 0x00, 0x10, 0x01, 0x01, 0x11, 0x00])),
    // DHT + بایت‌های دادهٔ حداقلی + EOI
    seg(0xc4, Buffer.alloc(20, 0x33)),
    Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x00, 0x00, 0x3f, 0x00]),
    Buffer.from([0x00]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

describe("Phase 14 media gaps — readImageSize (تابع خالص)", () => {
  it("PNG: ابعاد را از IHDR می‌خواند", () => {
    expect(readImageSize(PNG_3x2)).toEqual({ w: 3, h: 2 });
  });

  it("JPEG: SOF0 را می‌یابد و ابعاد را می‌خواند (16×8)", () => {
    expect(readImageSize(jpeg16x8())).toEqual({ w: 16, h: 8 });
  });

  it("PDF/بایت‌های نامعتبر → null (بدون حدس)", () => {
    expect(readImageSize(Buffer.from("%PDF-1.4 fake"))).toBeNull();
    expect(readImageSize(Buffer.alloc(0))).toBeNull();
  });
});

describe("Phase 14 media gaps — endpointهای دانلود/لینک/آپلود با ابعاد", () => {
  let prisma: PrismaService;
  let ctl: CapabilitiesController;
  const created: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const sms = new SmsProvidersService(prisma);
    const dispatcher = new NotificationDispatcherService(prisma, sms);
    ctl = new CapabilitiesController(prisma, dispatcher, sms);
  });

  afterAll(async () => {
    // پاکسازی ردیف‌های ساخته‌شده در همین تست
    for (const id of created) {
      await prisma.media.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  const fakeRes = () => {
    const headers: Record<string, string> = {};
    return {
      headers,
      setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = v; },
      send: (b: Buffer) => { (headers as unknown as { body?: Buffer }).body = b; },
    };
  };

  it("آپلود PNG ابعاد 3×2 را در ردیف ذخیره می‌کند", async () => {
    const r = (await ctl.upload({
      filename: "t3x2.png",
      mime: "image/png",
      dataBase64: PNG_3x2.toString("base64"),
      alt: "phase14-gap-test",
    })) as { id: string };
    created.push(r.id);
    const row = await prisma.media.findUnique({ where: { id: r.id } });
    expect(row?.width).toBe(3);
    expect(row?.height).toBe(2);
  });

  it("mediaDownload هدر attachment + همان بایت‌ها را می‌دهد", async () => {
    const row = await prisma.media.findFirstOrThrow({ where: { alt: "phase14-gap-test" } });
    const res = fakeRes();
    await ctl.mediaDownload(row.id, res as never);
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect((res.headers as unknown as { body?: Buffer }).body?.length).toBe(Number(row.sizeBytes));
  });

  it("mediaLink آدرس مطلق برمی‌گرداند", async () => {
    const row = await prisma.media.findFirstOrThrow({ where: { alt: "phase14-gap-test" } });
    const req = { protocol: "http", headers: { host: "127.0.0.1:4000" } };
    const r = (await ctl.mediaLink(row.id, req as never)) as { absolute: string; url: string };
    expect(r.absolute).toContain("/api/media/");
    expect(r.absolute.startsWith("http://127.0.0.1:4000/")).toBe(true);
  });

  it("mediaDownload برای فایل غایب روی دیسک → FILE_MISSING", async () => {
    const ghost = await prisma.media.create({
      data: { kind: "image", storageKey: "ghost-key.png", mime: "image/png", sizeBytes: 1n },
    });
    created.push(ghost.id);
    const res = fakeRes();
    await expect(ctl.mediaDownload(ghost.id, res as never)).rejects.toMatchObject({
      response: { code: "FILE_MISSING" },
    });
  });
});
