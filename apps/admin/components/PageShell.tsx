import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { getIdentity, can } from "@/lib/session";

/** Wrapper سرورِ صفحات ادمین — سشن + مجوز سپس کلاینت (بند ۷) */
export default async function PageShell({
  permission,
  title,
  subtitle,
  children,
}: {
  permission: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const me = await getIdentity();
  if (!me) redirect("/login");
  if (!can(me.permissions, permission)) redirect("/");
  return (
    <Shell me={me}>
      <h1 className="mb-1 text-lg font-black text-ink">{title}</h1>
      {subtitle && <p className="mb-6 text-xs text-muted">{subtitle}</p>}
      {!subtitle && <div className="mb-6" />}
      {children}
    </Shell>
  );
}
