import type { Metadata } from "next";
import Link from "next/link";
import { CartClient } from "@/components/commerce/CartClient";

export const metadata: Metadata = { title: "سبد خرید" };

export default function CartPage() {
  return (
    <div className="mx-auto max-w-3xl px-3 py-6 sm:px-4">
      <h1 className="mb-5 font-display text-3xl text-plum">سبد خرید</h1>
      <CartClient />
    </div>
  );
}
