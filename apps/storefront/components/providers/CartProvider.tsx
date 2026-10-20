"use client";

/**
 * سبد خرید — منبع حقیقت: سرور (فاز ۱ — گام ۶).
 * تعامل‌ها با API سبد سروری همگام می‌شوند (پراکسی /api/cart)؛ وضعیت محلی فقط برای
 * پاسخ‌دهی فوری UI است و بلافاصله با پاسخ سرور (authoritative) جور می‌شود.
 * علاقه‌مندی‌ها هم سروری است (گام ۱۱ — بند ۴۲): هویت ناشناس همان توکن سبد؛
 * localStorage فقط fallback آفلاین است — دفعه بعد که سرور جواب بدهد جایگزین می‌شود.
 * fallback: اگر سرور در دسترس نباشد، آخرین وضعیت localStorage استفاده می‌شود تا خرید نشکند.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ensureCatalogClient } from "@/lib/catalog-repo";
import { track } from "@/lib/analytics";
/** خط سبد: شناسه واریانت (SKU) + تعداد */
export interface CartLine {
  variantId: string;
  qty: number;
}

const LOCAL_KEY = "ghasedak.cart.v1";

interface CartStore {
  lines: CartLine[];
  wishlist: string[];
  hydrated: boolean;
  /** شناسه محصولی که QuickAdd برایش باز است (null = بسته) */
  quickAddKey: string | null;
  /** باز کردن انتخابگر سریع برای یک محصول */
  openQuickAdd: (productId: string) => void;
  closeQuickAdd: () => void;
  addLine: (variantId: string, qty?: number) => void;
  setQty: (variantId: string, qty: number) => void;
  removeLine: (variantId: string) => void;
  clearCart: () => void;
  toggleWishlist: (productId: string) => void;
  count: number;
  /** گارد: جلوگیری از فلاش UI قبل از hydrate شدن سبد سرور */
  ready: boolean;
}

const CartContext = createContext<CartStore | null>(null);

function readLocal(): { lines: CartLine[]; wishlist: string[] } {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return { lines: [], wishlist: [] };
    const parsed = JSON.parse(raw) as { lines?: CartLine[]; wishlist?: string[] };
    return {
      lines: (Array.isArray(parsed.lines) ? parsed.lines : [])
        .filter(
          (l): l is CartLine =>
            !!l && typeof l.variantId === "string" && l.variantId.length > 0 && Number.isFinite(Number(l.qty)),
        )
        .map((l) => ({ variantId: l.variantId, qty: Math.max(0, Math.floor(Number(l.qty))) })),
      wishlist: Array.isArray(parsed.wishlist) ? parsed.wishlist : [],
    };
  } catch {
    return { lines: [], wishlist: [] };
  }
}

function saveLocal(lines: CartLine[], wishlist: string[]) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ lines, wishlist }));
  } catch {}
}

/** مقایسهٔ محتوایی خط‌ها — state بی‌دلیل نباید رفرنس تازه بگیرد (ریشهٔ حلقهٔ F0-1) */
function linesEqual(a: CartLine[], b: CartLine[]): boolean {
  return a.length === b.length && a.every((l, i) => l.variantId === b[i].variantId && l.qty === b[i].qty);
}

/** مقایسهٔ شناسه‌ها — wishlist بدون تغییر محتوایی نباید رفرنس تازه بگیرد */
function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** تمیزکردن خط‌ها — qty نامعتبر نباید شمارنده را خراب کند */
function sanitize(lines: CartLine[]): CartLine[] {
  return (Array.isArray(lines) ? lines : [])
    .filter((l): l is CartLine => !!l && typeof l.variantId === "string" && l.variantId.length > 0 && Number.isFinite(Number(l.qty)))
    .map((l) => ({ variantId: l.variantId, qty: Math.max(0, Math.floor(Number(l.qty))) }))
    .filter((l) => l.qty > 0);
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [quickAddKey, setQuickAddKey] = useState<string | null>(null);
  const inFlight = useRef(false);

  /**
   * ریشهٔ باگ F0-1: `refresh` به `[wishlist]` وابسته بود و افکت hydrate به
   * `[refresh]`؛ hydrate هر بار `setWishlist(local.wishlist)` با آرایهٔ تازه
   * می‌زد → وابستگی تازه → افکت دوباره → حلقهٔ بی‌پایان + سیل `/api/cart`.
   *
   * حالا fetchها (refresh/mutate) هویت پایدار دارند و wishlist/lines را از
   * ref می‌خوانند؛ رفرنس‌های state فقط وقتی محتوا واقعاً عوض شود تغییر می‌کند.
   */
  const wishlistRef = useRef<string[]>([]);
  const linesRef = useRef<CartLine[]>([]);

  // آینهٔ state در ref — خواندن تازه داخل fetchها بدون وابستگی چرخه‌ای
  useEffect(() => {
    wishlistRef.current = wishlist;
  }, [wishlist]);
  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  /** خواندن سبد از سرور — منبع حقیقت (هویت پایدار: یک‌بار ساخته میشود) */
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/cart", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json().catch(() => null)) as { lines?: CartLine[]; count?: number } | null;
      if (!body) return;
      const next = sanitize(body.lines ?? []);
      saveLocal(next, wishlistRef.current);
      // بدون تفاوت واقعی همان آرایهٔ قبلی برمی‌گردد — رندر و افکت بی‌دلیل حذف می‌شود
      setLines((prev) => (linesEqual(prev, next) ? prev : next));
    } catch {
      // خطای شبکه — وضعیت محلی حفظ می‌شود (fallback)
    }
  }, []);

  /**
   * خواندن علاقه‌مندی از سرور (بند ۴۲) — هویت ناشناس همان توکن سبد است.
   * آفلاین/خطا: وضعیت محلی دست‌نخورده می‌ماند (fallback)؛ سرور جواب بدهد جایگزین می‌شود.
   */
  const refreshWishlist = useCallback(async () => {
    try {
      const res = await fetch("/api/wishlist", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json().catch(() => null)) as { productIds?: unknown } | null;
      if (!body || !Array.isArray(body.productIds)) return;
      const next = body.productIds.filter((x): x is string => typeof x === "string" && x.length > 0);
      setWishlist((prev) => (sameIds(prev, next) ? prev : next));
    } catch {
      // خطای شبکه — علاقه‌مندی محلی حفظ می‌شود (fallback)
    }
  }, []);

  // hydrate اولیه: محلی را سریع نشان بده، بعد سرور را بخوان
  // (refresh/refreshWishlist هویت پایدار دارند؛ این افکت فقط یک‌بار اجرا می‌شود)
  useEffect(() => {
    const local = readLocal();
    // fallback آفلاین (همان تعهد سرصفحهٔ این فایل): آخرین وضعیت محلی را نشان بده تا
    // با سرورِ در دسترس‌نبودن، خرید نشکند. سبد/علاقه‌مندی سرور authoritative است و اگر جواب بدهد،
    // refresh دقیقاً همان را جایگزین می‌کند (با گارد مقایسهٔ محتوایی → بی‌حلقه).
    setLines((prev) => (linesEqual(prev, local.lines) ? prev : local.lines));
    setWishlist((prev) => (sameIds(prev, local.wishlist) ? prev : local.wishlist));
    void refresh().finally(() => setHydrated(true));
    void refreshWishlist();
  }, [refresh, refreshWishlist]);

  // هم‌خوانی بین تب‌ها: بازگشت به صفحه (focus/visibility) سبد و علاقه‌مندی را دوباره می‌خواند
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refresh();
        void refreshWishlist();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refresh]);

  /** اعمال یک تغییر روی سرور؛ خروجی سرور (authoritative) جایگزین وضعیت می‌شود */
  const mutate = useCallback(
    async (method: "POST" | "DELETE", path: string, body?: unknown, optimistic?: CartLine[]) => {
      if (optimistic) {
        setLines(optimistic);
        saveLocal(optimistic, wishlistRef.current);
      }
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const res = await fetch(path, {
          method,
          headers: { "content-type": "application/json" },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        if (!res.ok) return;
        const next = (await res.json().catch(() => null)) as { lines?: CartLine[] } | null;
        if (next) {
          const nextLines = sanitize(next.lines ?? []);
          setLines(nextLines);
          saveLocal(nextLines, wishlistRef.current);
        }
      } catch {
        // خطای شبکه — وضعیت خوش‌بینانه باقی می‌ماند و دفعه بعد sync می‌شود
      } finally {
        inFlight.current = false;
      }
    },
    [],
  );

  const addLine = useCallback(
    (variantId: string, qty = 1) => {
      const next = sanitize([...lines.filter((l) => l.variantId !== variantId), { variantId, qty: (lines.find((l) => l.variantId === variantId)?.qty ?? 0) + qty }]);
      // گام ۱۵ — تنگای واحد همهٔ دکمه‌های افزودن (گارد رضایت داخل track)
      track("add_to_cart", { item_id: variantId, quantity: qty });
      void mutate("POST", "/api/cart/items", { variantId, qty: next.find((l) => l.variantId === variantId)?.qty ?? qty }, next);
    },
    [lines, mutate],
  );

  const setQty = useCallback(
    (variantId: string, qty: number) => {
      const next = sanitize(qty <= 0 ? lines.filter((l) => l.variantId !== variantId) : lines.map((l) => (l.variantId === variantId ? { ...l, qty } : l)));
      void mutate("POST", "/api/cart/items", { variantId, qty }, next);
    },
    [lines, mutate],
  );

  const removeLine = useCallback(
    (variantId: string) => {
      const next = sanitize(lines.filter((l) => l.variantId !== variantId));
      void mutate("DELETE", `/api/cart/items/${encodeURIComponent(variantId)}`, undefined, next);
    },
    [lines, mutate],
  );

  const clearCart = useCallback(() => {
    void mutate("DELETE", "/api/cart", undefined, []);
  }, [mutate]);

  /**
   * تغییر علاقه‌مندی (بند ۴۲) — خوش‌بینانهٔ محلی برای پاسخ فوری UI، سپس sync سرور؛
   * پاسخ سرور (فهرست کامل) جایگزین می‌شود. آفلاین: تغییر محلی می‌ماند و بعداً sync می‌شود.
   */
  const toggleWishlist = useCallback((productId: string) => {
    const prev = wishlistRef.current;
    const active = prev.includes(productId);
    const next = active ? prev.filter((id) => id !== productId) : [...prev, productId];
    setWishlist(next);
    void (async () => {
      try {
        const res = active
          ? await fetch(`/api/wishlist/items/${encodeURIComponent(productId)}`, { method: "DELETE" })
          : await fetch("/api/wishlist/items", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ productId }),
            });
        if (!res.ok) return;
        const body = (await res.json().catch(() => null)) as { productIds?: unknown } | null;
        if (!body || !Array.isArray(body.productIds)) return;
        const srv = body.productIds.filter((x): x is string => typeof x === "string" && x.length > 0);
        setWishlist((cur) => (sameIds(cur, srv) ? cur : srv));
      } catch {
        // آفلاین — تغییر خوش‌بینانهٔ محلی می‌ماند (fallback)
      }
    })();
  }, []);

  // نگهداری wishlist در localStorage (fallback آفلاین) — خط‌ها از ref می‌آیند
  // تا نسخهٔ تازهٔ state روی دیسک بنشیند، نه مقدار قدیمی محبوس در closure
  useEffect(() => {
    if (!hydrated) return;
    saveLocal(linesRef.current, wishlist);
  }, [wishlist, hydrated]);

  /**
   * پاک‌سازی سبد از واریانت‌های ناموجود — فقط وقتی کاتالوگ واقعاً بارگذاری شده؛
   * خطای شبکه نباید سبد کاربر را پاک کند.
   */
  useEffect(() => {
    if (!hydrated) return;
    let alive = true;
    void (async () => {
      const products = await ensureCatalogClient();
      if (!alive || products.length === 0) return;
      const valid = new Set<string>();
      for (const p of products) for (const v of p.variants) valid.add(v.id);
      setLines((prev) => {
        const kept = prev.filter((l) => l.qty > 0 && valid.has(l.variantId));
        return kept.length === prev.length ? prev : kept;
      });
    })();
    return () => {
      alive = false;
    };
  }, [hydrated]);

  const openQuickAdd = useCallback((key: string) => setQuickAddKey(key), []);
  const closeQuickAdd = useCallback(() => setQuickAddKey(null), []);

  const count = useMemo(() => lines.reduce((s, l) => s + l.qty, 0), [lines]);

  const value: CartStore = {
    lines,
    wishlist,
    hydrated,
    quickAddKey,
    openQuickAdd,
    closeQuickAdd,
    addLine,
    setQty,
    removeLine,
    clearCart,
    toggleWishlist,
    count,
    ready: hydrated,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartStore {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart باید داخل <CartProvider> استفاده شود");
  return ctx;
}
