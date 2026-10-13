"use client";

/**
 * سبد خرید — منبع حقیقت: سرور (فاز ۱ — گام ۶).
 * تعامل‌ها با API سبد سروری همگام می‌شوند (پراکسی /api/cart)؛ وضعیت محلی فقط برای
 * پاسخ‌دهی فوری UI است و بلافاصله با پاسخ سرور (authoritative) جور می‌شود.
 * علاقه‌مندی‌ها همچنان محلی (localStorage) است — سمت سرورِ علاقه‌مندی در فاز بعد.
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

  /** خواندن سبد از سرور — منبع حقیقت */
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/cart", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json().catch(() => null)) as { lines?: CartLine[]; count?: number } | null;
      if (!body) return;
      const next = sanitize(body.lines ?? []);
      setLines(next);
      saveLocal(next, wishlist);
    } catch {
      // خطای شبکه — وضعیت محلی حفظ می‌شود (fallback)
    }
  }, [wishlist]);

  // hydrate اولیه: محلی را سریع نشان بده، بعد سرور را بخوان
  useEffect(() => {
    const local = readLocal();
    setWishlist(local.wishlist);
    void refresh().finally(() => setHydrated(true));
  }, [refresh]);

  // هم‌خوانی بین تب‌ها: بازگشت به صفحه (focus/visibility) سبد را دوباره می‌خواند
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
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
        saveLocal(optimistic, wishlist);
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
          saveLocal(nextLines, wishlist);
        }
      } catch {
        // خطای شبکه — وضعیت خوش‌بینانه باقی می‌ماند و دفعه بعد sync می‌شود
      } finally {
        inFlight.current = false;
      }
    },
    [wishlist],
  );

  const addLine = useCallback(
    (variantId: string, qty = 1) => {
      const next = sanitize([...lines.filter((l) => l.variantId !== variantId), { variantId, qty: (lines.find((l) => l.variantId === variantId)?.qty ?? 0) + qty }]);
      void mutate("POST", "/api/cart/items", { variantId, qty: next.find((l) => l.variantId === variantId)?.qty ?? qty }, next);
    },
    [lines, mutate, wishlist],
  );

  const setQty = useCallback(
    (variantId: string, qty: number) => {
      const next = sanitize(qty <= 0 ? lines.filter((l) => l.variantId !== variantId) : lines.map((l) => (l.variantId === variantId ? { ...l, qty } : l)));
      void mutate("POST", "/api/cart/items", { variantId, qty }, next);
    },
    [lines, mutate, wishlist],
  );

  const removeLine = useCallback(
    (variantId: string) => {
      const next = sanitize(lines.filter((l) => l.variantId !== variantId));
      void mutate("DELETE", `/api/cart/items/${encodeURIComponent(variantId)}`, undefined, next);
    },
    [lines, mutate, wishlist],
  );

  const clearCart = useCallback(() => {
    void mutate("DELETE", "/api/cart", undefined, []);
  }, [mutate, wishlist]);

  const toggleWishlist = useCallback((productId: string) => {
    setWishlist((prev) =>
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId],
    );
  }, []);

  // نگهداری wishlist در localStorage (سمت سرور در فاز بعد)
  useEffect(() => {
    if (!hydrated) return;
    const local = readLocal();
    if (JSON.stringify(local.wishlist) !== JSON.stringify(wishlist)) saveLocal(lines, wishlist);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
