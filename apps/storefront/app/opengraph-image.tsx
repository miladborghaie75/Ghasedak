import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * OG/سوشال-کارت (بند F1-13) — ۱۲۰۰×۶۳۰ با همان هویت برند:
 * پالت خاک‌رس بنفش، بلاب‌های نرم، لاله‌زار برای عنوان و وزیرمتن برای متن.
 * فونتها لوکال خوانده می‌شوند (بدون شبکه).
 * نکته ۱: satori فقط فرمت sfnt (TTF) می‌فهمد؛ woff/woff2 (wOF/wOF2)
 * توسط fontsource رد می‌شوند. به همین دلیل نسخه‌های TTF استاتیک از
 * همان فایلهای fontsource در app/og-fonts تولید و کامیتمی‌شوند (اسکریپت
 * تولید: wawoff2.decompress — یکبار برای همیشه).
 * نکته ۲: satori برای هر زیرمجموعهٔ گلیف نام خانوادهٔ جدا می‌خواهد؛
 * به همین دلیل سه خانوادهٔ VazirFa/LalezarFa/VazirLatin ثبت شده است.
 */

export const alt = "لباس زیر قاصدک — خرید آنلاین لباس زیر زنانه";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

async function loadFont(rel: string): Promise<ArrayBuffer> {
  const data = await readFile(path.join(process.cwd(), "app", "og-fonts", rel));
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

export default async function OpengraphImage() {
  const [lalezarFa, vazirFa, vazirLatin] = await Promise.all([
    loadFont("lalezar-arabic-400.ttf"),
    loadFont("vazirmatn-arabic-700.ttf"),
    loadFont("vazirmatn-latin-700.ttf"),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          backgroundColor: "#fbf8fe",
        }}
      >
        {/* بلاب‌های نرم زمینه — همان زبان clay، بی‌قرینه‌گیری مکانیکی */}
        <div
          style={{
            position: "absolute",
            width: 420,
            height: 420,
            borderRadius: 210,
            backgroundColor: "#f6f1fc",
            top: -160,
            right: -120,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            width: 300,
            height: 300,
            borderRadius: 150,
            backgroundColor: "#eee6f8",
            bottom: -110,
            left: -80,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            width: 120,
            height: 120,
            borderRadius: 60,
            border: "3px solid #d9c8f2",
            top: 90,
            left: 180,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: "#c9829d",
            opacity: 0.5,
            bottom: 120,
            right: 210,
            display: "flex",
          }}
        />

        {/* پنل مرکزی — سفید با سایهٔ جانشین از لایهٔ پشتی نرم */}
        <div
          style={{
            position: "absolute",
            width: 780,
            height: 430,
            top: 118,
            right: 190,
            borderRadius: 48,
            backgroundColor: "#d9c8f2",
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            width: 780,
            height: 430,
            top: 100,
            right: 210,
            borderRadius: 48,
            border: "2px solid #e3dce8",
            backgroundColor: "#ffffff",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 18,
          }}
        >
          {/* نشان قاصدک — همان SVG آیکون اپ */}
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: 26,
              backgroundColor: "#8a5bc9",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="56" height="56" viewBox="0 0 64 64">
              <g stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" fill="none">
                <line x1="32" y1="32" x2="32" y2="15" />
                <line x1="32" y1="32" x2="18" y2="21" />
                <line x1="32" y1="32" x2="46" y2="21" />
                <line x1="32" y1="32" x2="15" y2="34" />
                <line x1="32" y1="32" x2="49" y2="34" />
                <line x1="32" y1="32" x2="21" y2="44" />
                <line x1="32" y1="32" x2="43" y2="44" />
                <path d="M32 40 C32 47 33 51 32 56" />
              </g>
              <g fill="#FFFFFF">
                <circle cx="32" cy="13" r="3" />
                <circle cx="16" cy="19" r="3" />
                <circle cx="48" cy="19" r="3" />
                <circle cx="12" cy="35" r="3" />
                <circle cx="52" cy="35" r="3" />
                <circle cx="19" cy="46" r="3" />
                <circle cx="45" cy="46" r="3" />
              </g>
            </svg>
          </div>

          <div
            style={{
              direction: "rtl",
              fontFamily: "LalezarFa",
              fontSize: 96,
              color: "#3b2948",
              lineHeight: 1.15,
              display: "flex",
            }}
          >
            لباس زیر قاصدک
          </div>
          <div
            style={{
              direction: "rtl",
              fontFamily: "VazirFa",
              fontWeight: 700,
              fontSize: 38,
              color: "#756a7b",
              display: "flex",
            }}
          >
            زیرپوش، ساده و مطمئن
          </div>
          <div
            style={{
              fontFamily: "VazirLatin",
              fontWeight: 700,
              fontSize: 26,
              color: "#ffffff",
              backgroundColor: "#8a5bc9",
              padding: "10px 34px",
              borderRadius: 999,
              display: "flex",
            }}
          >
            lebaszirghasedak.ir
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "LalezarFa", data: lalezarFa, weight: 400, style: "normal" },
        { name: "VazirFa", data: vazirFa, weight: 700, style: "normal" },
        { name: "VazirLatin", data: vazirLatin, weight: 700, style: "normal" },
      ],
    },
  );
}
