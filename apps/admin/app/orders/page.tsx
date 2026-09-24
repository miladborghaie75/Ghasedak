import PageShell from "@/components/PageShell";
import OrdersClient from "./OrdersClient";

export const dynamic = "force-dynamic";

export default function OrdersPage() {
  return (
    <PageShell permission="orders.view" title="سفارش‌ها">
      <OrdersClient />
    </PageShell>
  );
}
