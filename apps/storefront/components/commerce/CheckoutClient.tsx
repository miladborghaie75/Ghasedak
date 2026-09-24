"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCart } from "@/components/providers/CartProvider";
import { Field, FaNumberInput } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Price } from "@/components/ui/Price";
import { cn } from "@/lib/cn";
import { faNum } from "@/lib/format";
import { getAllProductsV2 } from "@/lib/catalog-repo";
import type { VariantV2 } from "@/lib/catalog";

/**
 * Checkout مهمان — سه بلوک: اطلاعات تماس، آدرس (با پلاک/واحد — بند ۲۷)، ارسال.
 * اعتبارسنجی inline هنگام submit؛ خطا زیر فیلد.
 * کد تخفیف: آکاردیونی ثانویه (بند ۲۷) — در دمو فقط اعتبارسنجی ساختاری.
 * دکمه پرداخت: «پرداخت X تومان» — در نسخه واقعی مبلغ سمت سرور محاسبه می‌شود (بند ۵۱).
 */

/** کدهای تخفیف نمایشی — در نسخه واقعی از سرور اعتبارسنجی می‌شود */
const DEMO_COUPONS: Record<string, { percent: number }> = {
  GHASEDAK10: { percent: 10 },
};

export function CheckoutClient() {
  const { lines, clearCart, ready } = useCart();
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [couponOpen, setCouponOpen] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [coupon, setCoupon] = useState<{ code: string; percent: number } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);

  const subtotal = useMemo(() => {
    const byId = new Map(
      getAllProductsV2().flatMap((p) => p.variants.map((v) => [v.id, v] as const)),
    );
    return lines.reduce((sum, l) => {
      const v = byId.get(l.variantId) as VariantV2 | undefined;
      if (!v) return sum;
      return sum + (v.salePrice ?? v.price) * l.qty;
    }, 0);
  }, [lines]);

  const [shipping, setShipping] = useState<"post" | "express">("post");
  const shippingCost = shipping === "post" ? (subtotal >= 1_500_000 ? 0 : 49_000) : 120_000;
  const discount = coupon ? Math.round((subtotal * coupon.percent) / 100) : 0;
  const total = subtotal + shippingCost - discount;

  if (ready && lines.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-line bg-surface px-6 py-14 text-center">
        <p className="text-sm font-bold text-ink">سبد شما خالی است</p>
        <Link href="/" className="mt-3 inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-bold text-on-accent">
          رفتن به فروشگاه
        </Link>
      </div>
    );
  }

  const validate = (data: FormData): Record<string, string> => {
    const errs: Record<string, string> = {};
    const name = String(data.get("name") ?? "").trim();
    if (name.length < 3) errs.name = "نام و نام خانوادگی را کامل وارد کنید.";

    const phone = String(data.get("phone") ?? "").replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
    if (!/^09\d{9}$/.test(phone)) errs.phone = "شماره موبایل باید با ۰۹ شروع شود و ۱۱ رقم باشد.";

    const province = String(data.get("province") ?? "");
    if (!province) errs.province = "استان را انتخاب کنید.";

    const city = String(data.get("city") ?? "").trim();
    if (city.length < 2) errs.city = "نام شهر را وارد کنید.";

    const address = String(data.get("address") ?? "").trim();
    if (address.length < 8) errs.address = "خیابان را کامل بنویسید.";

    const plaque = String(data.get("plaque") ?? "").trim();
    if (!plaque) errs.plaque = "پلاک را وارد کنید.";

    const postal = String(data.get("postal") ?? "").replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
    if (!/^\d{10}$/.test(postal)) errs.postal = "کد پستی باید ۱۰ رقم باشد.";

    return errs;
  };

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const errs = validate(data);
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      const first = Object.keys(errs)[0];
      document.getElementById(first)?.focus();
      return;
    }

    setSubmitting(true);
    // فلو واقعی: ثبت سفارش سرور-محور (قیمت/موجودی/کد تخفیف همگی سمت سرور — بند ۵۱)
    const idem =
      (crypto.randomUUID?.() as string | undefined) ?? `co-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": idem },
        body: JSON.stringify({
          guestName: String(data.get("name") ?? ""),
          guestMobile: String(data.get("mobile") ?? "").replace(/\D/g, "").replace(/^98/, "0"),
          address: {
            province: String(data.get("province") ?? ""),
            city: String(data.get("city") ?? ""),
            address: String(data.get("address") ?? ""),
            plaque: String(data.get("plaque") ?? ""),
            unit: String(data.get("unit") ?? "") || undefined,
            postalCode: String(data.get("postal") ?? ""),
          },
          shippingMethodId: shipping === "post" ? "post" : "express",
          couponCode: coupon?.code ?? null,
          lines: lines.map((l) => ({ sku: l.variantId, qty: l.qty })),
          idempotencyKey: idem,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; redirectUrl?: string; error?: { message?: string } }
        | null;
      if (!res.ok || !body?.ok || !body.redirectUrl) {
        setCouponError(null);
        setErrors({
          form:
            body?.error?.message ??
            "ثبت سفارش ناموفق بود؛ لطفاً دوباره تلاش کنید یا با پشتیبانی تماس بگیرید.",
        });
        setSubmitting(false);
        return;
      }
      sessionStorage.setItem(
        "ghasedak.lastOrder",
        JSON.stringify({
          at: new Date().toISOString(),
        }),
      );
      // سبد فقط پس از پاسخ موفق سرور خالی می‌شود؛ redirect به درگاه/صفحه پرداخت
      clearCart();
      window.location.href = body.redirectUrl;
    } catch {
      setErrors({ form: "خطای شبکه؛ اتصال اینترنت را بررسی کنید." });
      setSubmitting(false);
    }
  };

  const applyCoupon = () => {
    const code = couponCode.trim().toUpperCase();
    const hit = DEMO_COUPONS[code];
    if (hit) {
      setCoupon({ code, percent: hit.percent });
      setCouponError(null);
    } else {
      setCoupon(null);
      setCouponError("کد تخفیف معتبر نیست.");
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <fieldset className="rounded-card border border-line bg-surface p-4 shadow-clay-1">
        <legend className="px-1.5 text-sm font-extrabold text-ink">اطلاعات تماس</legend>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field id="name" name="name" label="نام و نام خانوادگی" autoComplete="name" error={errors.name} />
          <Field
            id="phone"
            name="phone"
            label="شماره موبایل"
            inputMode="numeric"
            dir="ltr"
            placeholder="09xxxxxxxxx"
            autoComplete="tel"
            hint="برای اطلاع از وضعیت سفارش پیامک می‌دهیم."
            error={errors.phone}
          />
        </div>
      </fieldset>

      <fieldset className="rounded-card border border-line bg-surface p-4 shadow-clay-1">
        <legend className="px-1.5 text-sm font-extrabold text-ink">آدرس تحویل</legend>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="province" className="text-sm font-bold text-ink">استان</label>
            <select
              id="province"
              name="province"
              defaultValue=""
              aria-invalid={errors.province ? true : undefined}
              aria-describedby={errors.province ? "province-err" : undefined}
              className={cn(
                "h-11 rounded-xl border bg-surface px-3 text-sm text-ink outline-none",
                errors.province ? "border-error" : "border-line focus:border-primary-strong",
              )}
            >
              <option value="" disabled>انتخاب استان…</option>
              {["تهران", "البرز", "اصفهان", "فارس", "خراسان رضوی", "آذربایجان شرقی", "گیلان", "مازندران"].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            {errors.province && <p id="province-err" role="alert" className="text-xs text-error">{errors.province}</p>}
          </div>
          <Field id="city" name="city" label="شهر" error={errors.city} />
          <div className="sm:col-span-2">
            <label htmlFor="address" className="mb-1.5 block text-sm font-bold text-ink">خیابان</label>
            <textarea
              id="address"
              name="address"
              rows={2}
              aria-invalid={errors.address ? true : undefined}
              aria-describedby={errors.address ? "address-err" : undefined}
              className={cn(
                "w-full rounded-xl border bg-surface px-3.5 py-2.5 text-sm text-ink outline-none",
                errors.address ? "border-error" : "border-line focus:border-primary-strong",
              )}
            />
            {errors.address && <p id="address-err" role="alert" className="mt-1 text-xs text-error">{errors.address}</p>}
          </div>
          <Field id="plaque" name="plaque" label="پلاک" error={errors.plaque} />
          <Field id="unit" name="unit" label="واحد (اختیاری)" />
          <Field
            id="postal"
            name="postal"
            label="کد پستی"
            inputMode="numeric"
            dir="ltr"
            placeholder="##########"
            error={errors.postal}
          />
        </div>
      </fieldset>

      <div className="rounded-card border border-line bg-surface p-4 shadow-clay-1">
        <p className="mb-2.5 text-sm font-extrabold text-ink">روش ارسال</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <ShippingOption
            id="post"
            title="پست پیشتاز"
            desc="۳ تا ۵ روز کاری"
            price={subtotal >= 1_500_000 ? 0 : 49_000}
            checked={shipping === "post"}
            onChange={() => setShipping("post")}
          />
          <ShippingOption
            id="express"
            title="ارسال اکسپرس"
            desc="تهران: همان روز؛ شهرستان: ۲۴ ساعت"
            price={120_000}
            checked={shipping === "express"}
            onChange={() => setShipping("express")}
          />
        </div>
      </div>

      {/* کد تخفیف — آکاردیونی ثانویه (بند ۲۷) */}
      <div className="rounded-card border border-line bg-surface shadow-clay-1">
        <button
          type="button"
          onClick={() => setCouponOpen((v) => !v)}
          aria-expanded={couponOpen}
          className="flex w-full items-center justify-between px-4 py-3.5 text-[13px] font-bold text-ink"
        >
          کد تخفیف دارید؟
          <span aria-hidden className={cn("transition-transform", couponOpen && "rotate-180")}>⌄</span>
        </button>
        {couponOpen && (
          <div className="border-t border-line px-4 pb-4 pt-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value)}
                placeholder="مثلاً GHASEDAK10"
                aria-label="کد تخفیف"
                aria-invalid={couponError ? true : undefined}
                className={cn(
                  "h-11 flex-1 rounded-xl border bg-surface px-3.5 text-sm text-ink outline-none",
                  couponError ? "border-error" : "border-line focus:border-primary-strong",
                )}
              />
              <Button type="button" variant="secondary" onClick={applyCoupon}>
                اعمال
              </Button>
            </div>
            {couponError && <p role="alert" className="mt-2 text-xs text-error">{couponError}</p>}
            {coupon && (
              <p className="mt-2 text-xs font-bold text-success">
                کد «{coupon.code}» اعمال شد — {faNum(coupon.percent)}٪ تخفیف.
              </p>
            )}
          </div>
        )}
      </div>

      {/* جمع نهایی */}
      <div className="rounded-card border border-line bg-surface p-4 shadow-clay-1">
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-muted">جمع کالاها</span>
          <span className="font-bold text-ink tnum">{faNum(subtotal)} تومان</span>
        </div>
        <div className="mt-2 flex items-center justify-between text-[13px]">
          <span className="text-muted">هزینه ارسال</span>
          <span className={cn("font-bold tnum", shippingCost === 0 ? "text-success" : "text-ink")}>
            {shippingCost === 0 ? "رایگان" : `${faNum(shippingCost)} تومان`}
          </span>
        </div>
        {discount > 0 && (
          <div className="mt-2 flex items-center justify-between text-[13px]">
            <span className="text-muted">تخفیف ({coupon?.code})</span>
            <span className="font-bold text-success tnum">−{faNum(discount)} تومان</span>
          </div>
        )}
        <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
          <span className="text-sm font-extrabold text-ink">مبلغ قابل پرداخت</span>
          <Price price={total} size="md" />
        </div>
        <Button type="submit" size="lg" loading={submitting} className="mt-4 w-full">
          {submitting ? "در حال انتقال به پرداخت…" : `پرداخت ${faNum(total)} تومان`}
        </Button>
        <p className="mt-2.5 text-center text-[11px] leading-5 text-muted">
          نسخه نمایشی: پرداخت واقعی انجام نمی‌شود و سفارش نمونه ثبت می‌گردد.
        </p>
      </div>
    </form>
  );
}

function ShippingOption({
  id,
  title,
  desc,
  price,
  checked,
  onChange,
}: {
  id: string;
  title: string;
  desc: string;
  price: number;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      htmlFor={`ship-${id}`}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors",
        checked ? "border-primary-strong bg-primary-tint" : "border-line bg-surface hover:border-primary",
      )}
    >
      <input
        type="radio"
        id={`ship-${id}`}
        name="shipping"
        value={id}
        checked={checked}
        onChange={onChange}
        className="mt-1 size-4 accent-[#6E46B8]"
      />
      <span className="flex-1">
        <span className="block text-[13px] font-bold text-ink">{title}</span>
        <span className="mt-0.5 block text-[11px] text-muted">{desc}</span>
      </span>
      <span className="text-[13px] font-bold text-ink tnum">
        {price === 0 ? "رایگان" : faNum(price)}
      </span>
    </label>
  );
}
