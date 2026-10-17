"use client";

import { useState } from "react";

/**
 * انتخابگر کانال بازیابی + فیلد شناسه.
 *
 * چرا client component: کانال با رادیو انتخاب می‌شود و برچسب/نوع ورودی فیلد
 * باید **همان لحظه** عوض شود؛ اگر سرور رندر کند، کاربر «ایمیل» را می‌زند ولی
 * فیلد همچنان «موبایل» و کیبورد عددی می‌ماند — همان سردرگمی‌ای که می‌خواستیم
 * رفع کنیم. ارسال فرم همان server action صفحه است (بدون fetch موازی).
 */
export function ChannelField({ initial }: { initial: "sms" | "email" }) {
  const [channel, setChannel] = useState<"sms" | "email">(initial);
  const isEmail = channel === "email";

  const option = (value: "sms" | "email") =>
    `flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[13px] font-bold transition-colors ${
      channel === value ? "border-primary-strong bg-primary-tint text-ink" : "border-line bg-bg text-muted"
    }`;

  return (
    <>
      <fieldset className="mt-5">
        <legend className="mb-2 text-[13px] text-ink">راه دریافت کد</legend>
        <div className="flex gap-2">
          <label className={option("sms")}>
            <input
              type="radio"
              name="channel"
              value="sms"
              checked={channel === "sms"}
              onChange={() => setChannel("sms")}
              className="accent-primary"
            />
            پیامک
          </label>
          <label className={option("email")}>
            <input
              type="radio"
              name="channel"
              value="email"
              checked={isEmail}
              onChange={() => setChannel("email")}
              className="accent-primary"
            />
            ایمیل
          </label>
        </div>
      </fieldset>

      <label className="mt-5 mb-1 block text-[13px] text-ink" htmlFor="identifier">
        {isEmail ? "ایمیلی که روی حسابت ثبت شده" : "موبایل"}
      </label>
      <input
        key={channel}
        id="identifier"
        name="identifier"
        required
        dir="ltr"
        inputMode={isEmail ? "email" : "numeric"}
        placeholder={isEmail ? "name@example.com" : "0912…"}
        className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm outline-none focus:border-primary-strong"
      />
      {/* key={channel} ورودی را بین دو حالت بازنشانی می‌کند تا مقدار موبایل
          اشتباهی در فیلد ایمیل نماند (و برعکس). */}
    </>
  );
}
