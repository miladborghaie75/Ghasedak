import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { getIdentity, can } from "@/lib/session";
import ProductsClient from "./ProductsClient";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const me = await getIdentity();
  if (!me) redirect("/login");
  if (!can(me.permissions, "products.view")) redirect("/");
  return (
    <Shell me={me}>
      <h1 className="mb-6 text-lg font-black text-ink">محصولات</h1>
      <ProductsClient />
    </Shell>
  );
}
