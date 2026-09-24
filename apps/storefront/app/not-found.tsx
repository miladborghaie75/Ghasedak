import Link from "next/link";
import { CATEGORIES } from "@/lib/categories";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-3 py-16 text-center sm:px-4">
      <p className="font-display text-7xl text-primary">۴۰۴</p>
      <h1 className="mt-3 font-display text-2xl text-plum">صفحه‌ای که دنبالش بودید پیدا نشد</h1>
      <p className="mx-auto mt-2 max-w-sm text-[13px] leading-7 text-muted">
        ممکن است محصول حذف شده یا آدرس اشتباه باشد. از این‌جا ادامه دهید:
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {CATEGORIES.map((c) => (
          <Link key={c.id} href={`/c/${c.slug}`} className="inline-flex h-10 items-center rounded-full border border-line bg-surface px-4 text-[13px] font-bold text-primary-strong hover:bg-primary-tint">
            {c.name}
          </Link>
        ))}
      </div>
      <Link href="/" className="mt-5 inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-bold text-white shadow-clay-1 hover:bg-primary-press">
        صفحه اصلی
      </Link>
    </div>
  );
}
