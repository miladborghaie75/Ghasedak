"use client";

import { CartProvider } from "./CartProvider";

/** ریشه همه Providerهای سمت کلاینت — بعداً QueryProvider و … اینجا اضافه می‌شود */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return <CartProvider>{children}</CartProvider>;
}
