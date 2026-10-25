"use client";

/**
 * لایهٔ رویداد آنالیتیکس — گام ۱۵-۲.
 *
 * قاعدهٔ سخت (بند پذیرش گام ۱۵): بدون رضایت هیچ چیز لود یا ارسال نمی‌شود —
 * نه اسکریپت GA4، نه رویداد؛ `track` قبل از رضایت no-op است (نه «پنهان»، «خاموش»).
 *
 * گارد رضایت با localStorage تصمیم کاربر را می‌خواند (بدون کوکی ترکر)؛
 * تصمیم تازه از طریق ConsentGate ثبت و به ConsentRecord سرور هم می‌رود.
 *
 * رویداد `purchase` اینجا نیست — سمت سرور و idempotent شلیک می‌شود
 * (تصمیم D-3؛ MeasurementService در apps/api). این لایه فقط چهار رویداد
 * سمت مشتری را می‌فرستد: view_item, add_to_cart, begin_checkout, search.
 */

import { csrfHeaders as csrfHeader } from "./csrf";

const CONSENT_KEY = "ghasedak.consent.v1";
const UTM_KEY = "ghasedak.utm.v1";
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;

export type ConsentDecision = "granted" | "denied";

/** تصمیم ذخیره‌شدهٔ کاربر — null یعنی هنوز انتخاب نکرده (بنر می‌آید) */
export function getConsentDecision(): ConsentDecision | null {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === "granted" || v === "denied" ? v : null;
  } catch {
    return null;
  }
}

/** ثبت تصمیم محلی + ارسال به ConsentRecord سرور (fire-and-forget) */
export function saveConsentDecision(d: ConsentDecision): void {
  try {
    localStorage.setItem(CONSENT_KEY, d);
  } catch {}
  void fetch("/api/analytics/consent", {
    method: "POST",
    headers: { "content-type": "application/json", ...csrfHeader() },
    body: JSON.stringify({ kind: "ANALYTICS", granted: d === "granted", source: "banner" }),
  }).catch(() => undefined);
}

type QueuedEvent = [name: string, params: Record<string, unknown>];
const queue: QueuedEvent[] = [];
let flushing = false;

/** گشتن در صف بعد از آماده‌شدن gtag — از ConsentGate و خود track صدا زده می‌شود */
export function flushTrackQueue(): void {
  if (flushing || queue.length === 0) return;
  const w = window as unknown as { gtag?: (...args: unknown[]) => void };
  if (typeof w.gtag !== "function") return;
  flushing = true;
  try {
    while (queue.length > 0) {
      const [name, params] = queue.shift()!;
      try {
        w.gtag("event", name, params);
      } catch {}
    }
  } finally {
    flushing = false;
  }
}

/**
 * شلیک رویداد — بدون رضایت کاملاً خاموش است؛ با رضایت اگر gtag هنوز
 * لود نشده باشد صف می‌رود و با آماده‌شدن flush می‌شود (رویداد گم نمی‌شود).
 */
export function track(name: string, params: Record<string, unknown> = {}): void {
  if (getConsentDecision() !== "granted") return;
  const w = window as unknown as { gtag?: (...args: unknown[]) => void };
  if (typeof w.gtag === "function") {
    try {
      w.gtag("event", name, params);
      return;
    } catch {}
  }
  queue.push([name, params]);
  // شاید gtag همین حالا آماده شده باشد
  flushTrackQueue();
}

/**
 * شمارش بازدید first-party (گام ۱۵-۶) — همیشه‌روشن (تصمیم تازهٔ D-5):
 * شمارش تجمیعیِ سرور خودمان به رضایت وصل نیست؛ رضایت فقط دروازهٔ GA4
 * است (بنر ConsentGate) و رویدادهای track() همچنان پس از رضایت شلیک می‌شوند.
 *
 * مقاوم‌سازی (D-6): همین مسیر تا ۳۰ دقیقه یک‌بار پینگ می‌شود — F5 و
 * برگشت سریع به همان صفحه بی‌اثرند (sessionStorage از refresh جا می‌ماند).
 * سرور همین پنجره را با جدول DailyVisitPath دوباره چک می‌کند — مرز حقیقت
 * سرور است؛ این فقط صرفه‌جویی درخواست است، نه لایهٔ امنیتی.
 */
const VISIT_SEEN_KEY = "ghasedak.visit-seen.v1";
const VISIT_WINDOW_MS = 30 * 60 * 1000; // هم‌ارز VIEW_WINDOW_MS در VisitsService

export function trackVisit(path: string): void {
  try {
    const now = Date.now();
    const seen: Record<string, number> = JSON.parse(sessionStorage.getItem(VISIT_SEEN_KEY) ?? "{}");
    for (const k of Object.keys(seen)) {
      if (now - seen[k] > VISIT_WINDOW_MS) delete seen[k]; // پاک‌سازی پنجره‌های مُرده
    }
    if (seen[path] && now - seen[path] < VISIT_WINDOW_MS) return; // همین پنجره، همین مسیر
    seen[path] = now;
    sessionStorage.setItem(VISIT_SEEN_KEY, JSON.stringify(seen));
  } catch {
    // بدون sessionStorage هم شمارش درست است — سرور dedupe می‌کند؛ فقط پینگ می‌رود
  }
  void fetch("/api/analytics/visit", {
    method: "POST",
    headers: { "content-type": "application/json", ...csrfHeader() },
    body: JSON.stringify({ path: path.slice(0, 200) }),
  }).catch(() => undefined);
}

// ——— UTM first-touch (گام ۱۵-۳، تصمیم D-4) ———

/** جذب UTM ورود اول — فقط بار اول ذخیره می‌شود (first-touch، نه آخرین برخورد) */
export function captureUtmFirstTouch(): void {
  try {
    if (localStorage.getItem(UTM_KEY)) return; // اولین برخورد از قبل ثبت شده
    const sp = new URLSearchParams(window.location.search);
    const out: Record<string, string> = {};
    for (const k of UTM_KEYS) {
      const v = sp.get(k);
      if (v && v.trim()) out[k] = v.trim().slice(0, 200);
    }
    if (Object.keys(out).length > 0) localStorage.setItem(UTM_KEY, JSON.stringify(out));
  } catch {}
}

/** UTM ذخیره‌شده — با checkout به سفارش وصل می‌شود */
export function getStoredUtm(): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(UTM_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const k of UTM_KEYS) {
      const v = parsed[k];
      if (typeof v === "string" && v) out[k] = v;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}
