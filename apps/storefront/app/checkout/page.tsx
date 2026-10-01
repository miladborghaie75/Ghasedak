import type { Metadata } from "next";
import { CheckoutClient, type ShippingMethodDTO } from "@/components/commerce/CheckoutClient";

export const metadata: Metadata = {
  title: "تکمیل خرید",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/** روش‌های ارسال از API اصلی — idهای واقعی DB (ثبت سفارش با id تقلبی 400 می‌خورد) */
async function loadMethods(): Promise<ShippingMethodDTO[]> {
  const api = process.env.API_ORIGIN ?? "http://localhost:4000";
  try {
    const res = await fetch(`${api}/api/v1/shipping/methods`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as ShippingMethodDTO[];
    return Array.isArray(body) ? body : [];
  } catch {
    return [];
  }
}

export default async function CheckoutPage() {
  const methods = await loadMethods();
  return (
    <div className="mx-auto max-w-3xl px-3 py-6 sm:px-4">
      <h1 className="mb-1 font-display text-3xl text-plum">تکمیل خرید</h1>
      <p className="mb-5 text-[13px] text-muted">
        نیازی به ثبت‌نام نیست — فقط اطلاعات ارسال.
      </p>
      <CheckoutClient methods={methods} />
    </div>
  );
}
