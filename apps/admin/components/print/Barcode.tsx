"use client";

/**
 * رندر بارکد سمت کلاینت — فقط SVG، بدون کتابخانه بیرونی (بند ۷۲: بدون وابستگی بی‌مورد).
 * - Code39: برای شماره سندها (PINV-…/GRN-…) — الفبای محدود، چاپ اسکنر-پسند.
 * - EAN-13: بارکد استاندارد کالا (داخلی قاصدک = EAN-13 بند ۱۱۶).
 * خروجی vector است — در چاپ و PDF بدون افت کیفیت. نسبت پهن ۲.۵:۱ (Code39 spec).
 */

const CODE39_PATTERNS: Record<string, string> = {
  "0": "101001101101", "1": "110100101011", "2": "101100101011", "3": "110110010101",
  "4": "101001101011", "5": "110100110101", "6": "101100110101", "7": "101001011011",
  "8": "110100101101", "9": "101100101101", "A": "110101001011", "B": "101101001011",
  "C": "110110100101", "D": "101011001011", "E": "110101100101", "F": "101101100101",
  "G": "101010011011", "H": "110101001101", "I": "101101001101", "J": "101011001101",
  "K": "110101010011", "L": "101101010011", "M": "110110101001", "N": "101011010011",
  "O": "110101101001", "P": "101101101001", "Q": "101010110011", "R": "110101011001",
  "S": "101101011001", "T": "101011011001", "U": "110010101011", "V": "100110101011",
  "W": "110011010101", "X": "100101101011", "Y": "110010110101", "Z": "100110110101",
  "-": "100101011011", ".": "110010101101", " ": "100110101101", "$": "100100100101",
  "/": "100100101001", "+": "100101001001", "%": "101001001001", "*": "100101101101",
};

const EAN_L: Record<string, string> = {
  "0": "0001101", "1": "0011001", "2": "0010011", "3": "0111101", "4": "0100011",
  "5": "0110001", "6": "0101111", "7": "0111011", "8": "0110111", "9": "0001011",
};
const EAN_G: Record<string, string> = {
  "0": "0100111", "1": "0110011", "2": "0011011", "3": "0100001", "4": "0011101",
  "5": "0111001", "6": "0000101", "7": "0010001", "8": "0001001", "9": "0010111",
};
const EAN_R: Record<string, string> = {
  "0": "1110010", "1": "1100110", "2": "1101100", "3": "1000010", "4": "1011100",
  "5": "1001110", "6": "1010000", "7": "1000100", "8": "1001000", "9": "1110100",
};
/** پاریتی سمت چپ بر اساس رقم اول (G/L ترکیب) */
const EAN_PARITY: string[] = [
  "LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLLG", "LGGLLG", "LGGGLL", "LGLGLL", "LGLGGL", "LGGLGL",
];

/** عنصر بارکد: تیره/روشن + پهنای واحد */
interface Elem { dark: boolean; w: number }

function code39Elems(text: string): Elem[] | null {
  const t = text.toUpperCase();
  for (const ch of t) if (!CODE39_PATTERNS[ch]) return null;
  const elems: Elem[] = [];
  for (const ch of `*${t}*`) {
    const p = CODE39_PATTERNS[ch];
    for (let i = 0; i < p.length; i++) {
      // بیت‌ها یکی‌درمیان تیره/روشن‌اند؛ ۱=پهن (۲.۵ واحد)، ۰=باریک (۱ واحد)
      elems.push({ dark: i % 2 === 0, w: p[i] === "1" ? 2.5 : 1 });
    }
    elems.push({ dark: false, w: 1 }); // inter-character gap
  }
  return elems;
}

function ean13Elems(digits13: string): { elems: Elem[]; ok: boolean } {
  if (!/^\d{13}$/.test(digits13)) return { elems: [], ok: false };
  const d = digits13;
  // رقم کنترل از بدنه بازمحاسبه می‌شود تا اسکنر همیشه درست بخواند (رقم ۱۳ ورودی نادیده)
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(d[i]) * (i % 2 === 0 ? 1 : 3);
  const check = String((10 - (sum % 10)) % 10);
  const body = d.slice(0, 12) + check;

  const parity = EAN_PARITY[Number(body[0])];
  const elems: Elem[] = [];
  const pushBits = (bits: string) => {
    for (const c of bits) {
      const dark = c === "1";
      const last = elems[elems.length - 1];
      if (last && last.dark === dark) last.w += 1;
      else elems.push({ dark, w: 1 });
    }
  };
  pushBits("101"); // guard شروع
  for (let i = 1; i <= 6; i++) pushBits(parity[i - 1] === "L" ? EAN_L[body[i]] : EAN_G[body[i]]);
  pushBits("01010"); // guard میانی
  for (let i = 7; i <= 12; i++) pushBits(EAN_R[body[i]]);
  pushBits("101"); // guard پایان
  return { elems, ok: true };
}

function elemsToRects(elems: Elem[], unit: number): { rects: Array<{ x: number; w: number }>; width: number } {
  const rects: Array<{ x: number; w: number }> = [];
  let x = 0;
  for (const e of elems) {
    if (e.dark) rects.push({ x, w: e.w * unit });
    x += e.w * unit;
  }
  return { rects, width: x };
}

function BarcodeSvg({ elems, unit, height, value }: { elems: Elem[]; unit: number; height: number; value: string }) {
  const { rects, width } = elemsToRects(elems, unit);
  return (
    <figure className="print-barcode inline-flex flex-col items-center gap-0.5">
      <svg role="img" aria-label={`بارکد ${value}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {rects.map((r, i) => <rect key={i} x={r.x} y={0} width={r.w} height={height} fill="#000" />)}
      </svg>
      <figcaption dir="ltr" className="font-mono text-[10px] leading-none">{value}</figcaption>
    </figure>
  );
}

export function Code39Barcode({ value, height = 40, unit = 1.4 }: { value: string; height?: number; unit?: number }) {
  const elems = code39Elems(value);
  if (!elems) return <span dir="ltr" className="font-mono text-xs">{value}</span>;
  return <BarcodeSvg elems={elems} unit={unit} height={height} value={value} />;
}

export function Ean13Barcode({ value, height = 36, unit = 1.4 }: { value: string; height?: number; unit?: number }) {
  const { elems, ok } = ean13Elems(value);
  if (!ok) return <span dir="ltr" className="font-mono text-xs">{value}</span>;
  return <BarcodeSvg elems={elems} unit={unit} height={height} value={value} />;
}
