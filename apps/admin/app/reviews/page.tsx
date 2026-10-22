import PageShell from "@/components/PageShell";
import ReviewsClient from "./ReviewsClient";

export const dynamic = "force-dynamic";

export default function ReviewsPage() {
  return (
    <PageShell
      permission="reviews.moderate"
      title="نظرات مشتریان"
      subtitle="صف تأیید/رد/پاسخ — نظرات مهمان با OTP موبایل؛ بج «خریدار واقعی» از سفارش پرداخت‌شده"
    >
      <ReviewsClient />
    </PageShell>
  );
}
