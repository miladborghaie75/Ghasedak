"use client";

/**
 * سبد خرید و علاقه‌مندی — کلاینت‌ساید با localStorage.
 * ASSUMPTION: در فاز ۶ (Checkout واقعی) با سبد سروریِ کوکی‌محور جایگزین
 * می‌شود؛ API این استور عمداً شبیه API سرور طراحی شده تا تعویضش ارزان باشد.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
/** خط سبد: شناسه واریانت + تعداد */
export interface CartLine {
  variantId: string;
  qty: number;
}

const KEY = "ghasedak.cart.v1";

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
  /** گارد: جلوگیری از فلاش UI قبل از hydrate شدن localStorage */
  ready: boolean;
}

const CartContext = createContext<CartStore | null>(null);

function load(): { lines: CartLine[]; wishlist: string[] } {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { lines: [], wishlist: [] };
    const parsed = JSON.parse(raw) as {
      lines?: CartLine[];
      wishlist?: string[];
    };
    return {
      lines: Array.isArray(parsed.lines) ? parsed.lines : [],
      wishlist: Array.isArray(parsed.wishlist) ? parsed.wishlist : [],
    };
  } catch {
    return { lines: [], wishlist: [] };
  }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [quickAddKey, setQuickAddKey] = useState<string | null>(null);

  useEffect(() => {
    const data = load();
    setLines(data.lines);
    setWishlist(data.wishlist);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(KEY, JSON.stringify({ lines, wishlist }));
  }, [lines, wishlist, hydrated]);

  const addLine = useCallback((variantId: string, qty = 1) => {
    setLines((prev) => {
      const found = prev.find((l) => l.variantId === variantId);
      if (found) {
        return prev.map((l) =>
          l.variantId === variantId ? { ...l, qty: l.qty + qty } : l,
        );
      }
      return [...prev, { variantId, qty }];
    });
  }, []);

  const setQty = useCallback((variantId: string, qty: number) => {
    setLines((prev) =>
      qty <= 0
        ? prev.filter((l) => l.variantId !== variantId)
        : prev.map((l) => (l.variantId === variantId ? { ...l, qty } : l)),
    );
  }, []);

  const removeLine = useCallback((variantId: string) => {
    setLines((prev) => prev.filter((l) => l.variantId !== variantId));
  }, []);

  const clearCart = useCallback(() => setLines([]), []);

  const toggleWishlist = useCallback((productId: string) => {
    setWishlist((prev) =>
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId],
    );
  }, []);

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
