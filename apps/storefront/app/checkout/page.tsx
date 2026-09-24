import type { Metadata } from "next";
import { CheckoutClient } from "@/components/commerce/CheckoutClient";

export const metadata: Metadata = {
  title: "تکمیل خرید",
  robots: { index: false },
};

export default function CheckoutPage() {
  return (
    <div className="mx-auto max-w-3xl px-3 py-6 sm:px-4">
      <h1 className="mb-1 font-display text-3xl text-plum">تکمیل خرید</h1>
      <p className="mb-5 text-[13px] text-muted">
        نیازی به ثبت‌نام نیست — فقط اطلاعات ارسال.
      </p>
      <CheckoutClient />
    </div>
  );
}
