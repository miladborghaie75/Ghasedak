/**
 * پوشش‌دهندهٔ موشن ورود لندینگ — سبک و بدون JS.
 *
 * (این تنها بخش باقی‌مانده از رندرر قدیمی `HomeSection` است؛ خود رندرر
 * حذف شد و چیدمان صفحهٔ اصلی از صفحه‌ساز زنده می‌آید.)
 */
export function SectionReveal({ children, className }: { children: React.ReactNode; className?: string }) {
  // موشن سبک با CSS — بدون JS سنگین؛ کلاس روی هر بلوک لندینگ
  return (
    <div data-motion="reveal" className={className}>
      {children}
    </div>
  );
}