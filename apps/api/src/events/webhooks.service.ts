import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { backgroundWorkersEnabled } from "../common/background-workers";

/**
 * وبهوک خروجی — گام ۱۸.
 *
 * مشترکین رویدادهای دامنه: endpoint با URL + secret (HMAC-SHA256). هر رویدادِ
 * dispatchشده برای هر endpoint منطبق یک ردیف WebhookDelivery می‌سازد و بلافاصله
 * تلاش می‌شود؛ شکست با backoff نمایی (تا ۵ تلاش) دوباره تلاش می‌شود — همان
 * الگوی retry خودِ EventBus (بند ۴۳/۱۱۶). شکستِ وبهوک هرگز رویداد دامنه را
 * fail نمی‌کند (dispatchEvent از بیرون catch می‌شود).
 *
 * امضا: `X-Ghasedak-Signature: t=<unix>,v1=<hex>` روی رشتهٔ `${t}.${rawBody}`
 * — گیرنده با همان secret و مقایسهٔ زمان (۵ دقیقه) ضد replay بررسی می‌کند.
 */

export const WEBHOOK_TIMEOUT_MS = 10_000;
export const WEBHOOK_MAX_ATTEMPTS = 5;
/** بازهٔ مجاز اختلاف timestamp برای گیرنده (ضد replay) */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export function webhookSignature(secret: string, timestamp: number, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

/** بررسی سمت گیرنده — برای تست و مستندات؛ خود API فقط می‌سازد */
export function verifyWebhookSignature(secret: string, header: string, rawBody: string, now = Date.now()): boolean {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header ?? "");
  if (!m) return false;
  const t = Number(m[1]);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > WEBHOOK_TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(webhookSignature(secret, t, rawBody), "hex");
  const got = Buffer.from(m[2], "hex");
  return expected.length === got.length && timingSafeEqual(expected, got);
}

function isLoopbackHttp(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
}

@Injectable()
export class WebhooksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhooksService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    // صف retry تحویل‌ها — با GHASEDAK_WORKERS=off خاموش (همان قاعدهٔ EventBus)
    if (!backgroundWorkersEnabled()) {
      this.logger.log("Background workers disabled (GHASEDAK_WORKERS=off) — Webhook retry timer not started");
      return;
    }
    // catch اجباری: رد شدنِ Promise بدون گیرنده (DB قطع/restart) روی Node 26
    // فرایند کل API را می‌کشد؛ تیک بعدی خودش دوباره تلاش می‌کند.
    this.timer = setInterval(
      () => void this.drain().catch((e) => this.logger.warn(`webhook drain failed: ${e instanceof Error ? e.message : e}`)),
      30_000,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------------- مدیریت endpoint ----------------

  async createEndpoint(input: { url: string; events: string[]; description?: string }) {
    const url = this.validateUrl(input.url);
    const events = this.validateEvents(input.events);
    const secret = `whsec_${randomBytes(24).toString("hex")}`;
    const ep = await this.prisma.webhookEndpoint.create({
      data: { url, events, description: input.description ?? null, secret },
    });
    await this.audit("admin.webhook.create", ep.id, { url, events });
    // secret فقط یک‌بار کامل برمی‌گردد — بعد از این فقط ۴ کاراکتر آخر
    return { ...ep, secret };
  }

  async listEndpoints() {
    const rows = await this.prisma.webhookEndpoint.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { deliveries: true } } },
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        url: r.url,
        events: r.events,
        description: r.description,
        active: r.active,
        secretHint: r.secret ? `••••${r.secret.slice(-4)}` : null,
        deliveryCount: r._count.deliveries,
        createdAt: r.createdAt,
      })),
    };
  }

  async updateEndpoint(id: string, input: { url?: string; events?: string[]; description?: string | null; active?: boolean }) {
    const ep = await this.prisma.webhookEndpoint.findUnique({ where: { id } });
    if (!ep) throw new NotFoundException({ code: "NOT_FOUND", message: "وبهوک یافت نشد." });
    const data: Record<string, unknown> = {};
    if (input.url !== undefined) data.url = this.validateUrl(input.url);
    if (input.events !== undefined) data.events = this.validateEvents(input.events);
    if (input.description !== undefined) data.description = input.description;
    if (input.active !== undefined) data.active = input.active;
    const updated = await this.prisma.webhookEndpoint.update({ where: { id }, data: data as never });
    await this.audit("admin.webhook.update", id, data);
    return this.mask(updated);
  }

  async deleteEndpoint(id: string) {
    const ep = await this.prisma.webhookEndpoint.findUnique({ where: { id } });
    if (!ep) throw new NotFoundException({ code: "NOT_FOUND", message: "وبهوک یافت نشد." });
    await this.prisma.webhookEndpoint.delete({ where: { id } });
    await this.audit("admin.webhook.delete", id, { url: ep.url });
    return { ok: true };
  }

  /** چرخش secret — مقدار قبلی باطل و مقدار جدید فقط همین‌جا نمایش داده می‌شود */
  async rotateSecret(id: string) {
    const ep = await this.prisma.webhookEndpoint.findUnique({ where: { id } });
    if (!ep) throw new NotFoundException({ code: "NOT_FOUND", message: "وبهوک یافت نشد." });
    const secret = `whsec_${randomBytes(24).toString("hex")}`;
    await this.prisma.webhookEndpoint.update({ where: { id }, data: { secret } });
    await this.audit("admin.webhook.rotate_secret", id, {});
    return { id, secret };
  }

  // ---------------- ارسال ----------------

  /**
   * فن‌اوت یک رویداد به همهٔ endpointهای منطبق — از EventBus بعد از هندل موفق
   * صدا زده می‌شود. خطای هر ارسال جذب همان delivery می‌شود؛ این متد فقط در
   * صورتی throw می‌کند که خودِ نوشتن ردیف شکست بخورد.
   */
  async dispatchEvent(name: string, payload: Record<string, unknown>): Promise<void> {
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: { active: true, OR: [{ events: { has: name } }, { events: { has: "*" } }] },
    });
    for (const ep of endpoints) {
      const delivery = await this.prisma.webhookDelivery.create({
        data: { endpointId: ep.id, eventName: name, payload: payload as object },
      });
      try {
        await this.attempt(delivery.id, ep);
      } catch (e) {
        this.logger.warn(`dispatch ${name} → ${ep.url}: ${e instanceof Error ? e.message : "unknown"}`);
      }
    }
  }

  /** پینگ آزمایشی — endpoint را با رویداد ping چک می‌کند (پذیرش گام ۱۸) */
  async testPing(id: string) {
    const ep = await this.prisma.webhookEndpoint.findUnique({ where: { id } });
    if (!ep) throw new NotFoundException({ code: "NOT_FOUND", message: "وبهوک یافت نشد." });
    const delivery = await this.prisma.webhookDelivery.create({
      data: { endpointId: ep.id, eventName: "ping", payload: { note: "تست وبهوک — از پنل ادمین" } as object },
    });
    await this.attempt(delivery.id, ep);
    return this.prisma.webhookDelivery.findUnique({ where: { id: delivery.id } });
  }

  /** retry دستی ادمین — ردیف FAILED/PENDING را دوباره در صف می‌گذارد */
  async retryDelivery(id: string) {
    const d = await this.prisma.webhookDelivery.findUnique({ where: { id }, include: { endpoint: true } });
    if (!d) throw new NotFoundException({ code: "NOT_FOUND", message: "تحویل یافت نشد." });
    if (d.state === "OK") throw new BadRequestException({ code: "INVALID_STATE", message: "این تحویل قبلاً موفق شده است." });
    await this.prisma.webhookDelivery.update({
      where: { id },
      data: { state: "PENDING", nextAttemptAt: new Date(), lastError: null },
    });
    await this.attempt(id, d.endpoint);
    return this.prisma.webhookDelivery.findUnique({ where: { id } });
  }

  async listDeliveries(endpointId: string, q: { page?: string }) {
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = 20;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.webhookDelivery.findMany({
        where: { endpointId },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.webhookDelivery.count({ where: { endpointId } }),
    ]);
    return { items, total, page, limit };
  }

  /** صف retry پس‌زمینه — PENDINGهای سررسید‌شده با backoff نمایی */
  async drain(): Promise<void> {
    const pending = await this.prisma.webhookDelivery.findMany({
      where: { state: "PENDING", nextAttemptAt: { lte: new Date() }, attempts: { lt: WEBHOOK_MAX_ATTEMPTS } },
      orderBy: { createdAt: "asc" },
      take: 20,
      include: { endpoint: true },
    });
    for (const d of pending) {
      if (!d.endpoint.active) continue;
      await this.attempt(d.id, d.endpoint).catch(() => undefined);
    }
  }

  /** یک تلاش ارسال — نتیجه روی ردیف delivery ثبت می‌شود؛ throw نمی‌کند */
  private async attempt(deliveryId: string, endpoint: { id: string; url: string; secret: string }): Promise<void> {
    const d = await this.prisma.webhookDelivery.findUnique({ where: { id: deliveryId } });
    if (!d) return;
    const rawBody = JSON.stringify({ event: d.eventName, deliveryId: d.id, payload: d.payload });
    const ts = Math.floor(Date.now() / 1000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    try {
      const res = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "Ghasedak-Webhook/1.0",
          "x-ghasedak-event": d.eventName,
          "x-ghasedak-delivery": d.id,
          "x-ghasedak-timestamp": String(ts),
          "x-ghasedak-signature": `t=${ts},v1=${webhookSignature(endpoint.secret, ts, rawBody)}`,
        },
        body: rawBody,
        signal: controller.signal,
      });
      const ok = res.status >= 200 && res.status < 300;
      const attempts = d.attempts + 1;
      await this.prisma.webhookDelivery.update({
        where: { id: d.id },
        data: ok
          ? { state: "OK", attempts, responseCode: res.status, deliveredAt: new Date(), lastError: null }
          : attempts >= WEBHOOK_MAX_ATTEMPTS
            ? { state: "FAILED", attempts, responseCode: res.status, lastError: `HTTP ${res.status}` }
            : { attempts, responseCode: res.status, lastError: `HTTP ${res.status}`, nextAttemptAt: this.backoff(attempts) },
      });
      if (ok) this.logger.log(`webhook OK: ${d.eventName} → ${endpoint.url} (${res.status})`);
      else this.logger.warn(`webhook attempt ${attempts} failed: ${d.eventName} → ${endpoint.url}: HTTP ${res.status}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      const attempts = d.attempts + 1;
      await this.prisma.webhookDelivery.update({
        where: { id: d.id },
        data:
          attempts >= WEBHOOK_MAX_ATTEMPTS
            ? { state: "FAILED", attempts, lastError: msg }
            : { attempts, lastError: msg, nextAttemptAt: this.backoff(attempts) },
      });
      this.logger.warn(`webhook attempt ${attempts} failed: ${d.eventName} → ${endpoint.url}: ${msg}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private backoff(attempts: number): Date {
    // ۳۰s → ۱m → ۲m → ۴m … سقف ۱۵ دقیقه
    return new Date(Date.now() + Math.min(15 * 60_000, 2 ** (attempts - 1) * 30_000));
  }

  private validateUrl(url: string): string {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "URL نامعتبر است." });
    }
    if (u.protocol !== "https:" && !(u.protocol === "http:" && isLoopbackHttp(u))) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "فقط https مجاز است (http فقط برای localhost)." });
    }
    return u.toString();
  }

  private validateEvents(events: string[]): string[] {
    if (!Array.isArray(events) || events.length === 0 || events.some((e) => typeof e !== "string" || !e.trim())) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "حداقل یک رویداد لازم است." });
    }
    return [...new Set(events.map((e) => e.trim()))];
  }

  private mask(ep: { id: string; url: string; events: string[]; description: string | null; active: boolean; secret: string; createdAt: Date }) {
    return { id: ep.id, url: ep.url, events: ep.events, description: ep.description, active: ep.active, secretHint: `••••${ep.secret.slice(-4)}`, createdAt: ep.createdAt };
  }

  private async audit(action: string, entityId: string, meta: Record<string, unknown>): Promise<void> {
    await this.prisma.auditLog
      .create({ data: { action, entity: "WebhookEndpoint", entityId, newValues: meta as object } })
      .catch(() => undefined);
  }
}
