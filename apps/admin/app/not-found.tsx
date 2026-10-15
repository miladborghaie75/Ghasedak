import Link from "next/link";

/**
 * ۴۰۴ پنل (گام ۱۰) — صفحهٔ نظامی و کوتاه در زبان بصری ادمین.
 * آدرس غلط در پنل هیچ‌وقت بحران نیست؛ فقط راه برگشت به خانهٔ امن لازم است.
 */
export default function AdminNotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="font-mono text-5xl font-black text-primary/30" dir="ltr">
        404
      </p>
      <h2 className="mt-3 text-xl font-bold">چنین صفحه‌ای در پنل نیست</h2>
      <p className="mt-2 text-sm text-fg/70">
        آدرس اشتباه است یا این بخش جابه‌جا شده. از فهرست کنار ادامه بده.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-fg transition hover:opacity-90"
      >
        برگشت به داشبورد
      </Link>
    </div>
  );
}
