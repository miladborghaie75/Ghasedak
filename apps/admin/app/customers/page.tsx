import PageShell from "@/components/PageShell";
import CustomersClient from "./clients/CustomersClient";

export default function CustomersPage() {
  return (
    <PageShell
      permission="customers.view"
      title="مشتریان و سبد رهاشده"
      subtitle="پروفایل مشتریان از سفارش‌های واقعی + تشخیص سبد رهاشده از سبد سروری"
    >
      <CustomersClient />
    </PageShell>
  );
}
