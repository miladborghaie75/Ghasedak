"use client";

/**
 * مرز خطای ریشه‌ای پنل (گام ۱۰) — آخرین شبکهٔ ایمنی؛ layout از کار افتاده،
 * پس این فایل <html>/<body> را خودش می‌سازد، بدون هیچ import اعتباری.
 * متن inline و فارسی ساده با همان لحن ادمین؛ reset = بارگذاری دوبارهٔ کامل.
 */
export default function AdminGlobalError({
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
          background: "#f7f7f9",
          color: "#222",
          fontFamily: "system-ui, sans-serif",
          padding: "1.5rem",
        }}
      >
        <div style={{ maxWidth: "26rem", textAlign: "center" }}>
          <p style={{ fontSize: "2.25rem", margin: 0 }} aria-hidden>
            🗂️
          </p>
          <h1 style={{ fontSize: "1.3rem", fontWeight: 800, marginTop: "1rem" }}>
            پنل از دسترس خارج شد
          </h1>
          <p style={{ color: "#555", lineHeight: 1.9, marginTop: "0.75rem" }}>
            صفحه را رفرش کن؛ اگر درست نشد، چند دقیقه بعد دوباره بیا.
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
              padding: "0.55rem 1.4rem",
              borderRadius: "9999px",
              border: "none",
              background: "#5b4dca",
              color: "white",
              fontSize: "0.95rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            رفرش صفحه
          </button>
        </div>
      </body>
    </html>
  );
}
