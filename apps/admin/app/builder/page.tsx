import { redirect } from "next/navigation";
import { can } from "@/lib/session";
import { getIdentity } from "@/lib/session.server";
import BuilderClient from "./BuilderClient";

/**
 * صفحه‌ساز — تمام‌صفحه، بدون پوستهٔ معمول ادمین.
 * سشن و مجوز سمت سرور چک می‌شود (بند ۷): رندر به هیچوجه به کاربر
 * بدون دسترسی نشان داده نمی‌شود.
 */
export const metadata = { title: "صفحه‌ساز — قاصدک" };
export const dynamic = "force-dynamic";

export default async function BuilderPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const me = await getIdentity();
  if (!me) redirect("/login");
  if (!can(me.permissions, "marketing.view")) redirect("/");

  const sp = await searchParams;
  const slug = typeof sp.page === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(sp.page) ? sp.page : undefined;

  return <BuilderClient initialSlug={slug} />;
}