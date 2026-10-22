"use client";

/**
 * مرز خطای ریشه‌ای فروشگاه (گام ۱۰) — وقتی خود layout می‌شکند؛ پس این صفحه
 * <html> و <body> را خودش می‌سازد و به فریم‌ورک/کانتکست وابسته نیست.
 * متن‌ها عمداً inline و فارسی ساده‌اند (این فایل در بدترین حالت لود می‌شود؛
 * هیچ import اعتباری نباید شکست بخورد)، اما همان لحن مرز را دارند.
 * reset در این سطح یعنی بارگذاری دوبارهٔ کامل صفحه.
 */
export default function StorefrontGlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="fa" dir="rtl">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#faf9f6",
          color: "#2b2b33",
          fontFamily: "system-ui, sans-serif",
          padding: "1.5rem",
        }}
      >
        <div style={{ maxWidth: "28rem", textAlign: "center" }}>
          <p style={{ fontSize: "2.5rem", margin: 0 }} aria-hidden>
            🪡
          </p>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 800, marginTop: "1rem" }}>
            چیزی در صفحه از کار افتاد
          </h1>
          <p style={{ color: "#555", lineHeight: 1.9, marginTop: "0.75rem" }}>
            فروشگاه برای یک لحظه اذیت شد. صفحه را دوباره باز کن؛ اگر درست نشد،
            چند دقیقه بعد سر بزن.
          </p>
          {error?.digest ? (
            <p style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#999", direction: "ltr" }}>
              {error.digest}
            </p>
          ) : null}
          <button
            onClick={() => reset()}
            style={{
              marginTop: "1.5rem",
              padding: "0.6rem 1.5rem",
              borderRadius: "9999px",
              border: "none",
              background: "#5b4dca",
              color: "white",
              fontSize: "0.95rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            بارگذاری دوباره
          </button>
        </div>
      </body>
    </html>
  );
}
