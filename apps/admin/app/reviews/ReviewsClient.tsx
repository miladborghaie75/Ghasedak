"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdminApi } from "@/components/useAdminApi";

/**
 * صف مدیریت نظرات (گام ۱۱ — بند ۴۱):
 *  - تب‌ها بر اساس وضعیت با شمارندهٔ هر وضعیت
 *  - اقدام‌ها: تأیید / رد / پنهان / پاسخ ادمین — هر اقدام در API سمت سرور AuditLog می‌گیرد
 *  - شمارهٔ موبایل فقط همین‌جا (پنل مجاز) دیده می‌شود؛ در نمایش عمومی هرگز برنمی‌گردد
 */

type ReviewStatus = "PENDING" | "APPROVED" | "REJECTED" | "HIDDEN";

interface ReviewRow {
  id: string;
  rating: number;
  body: string;
  status: ReviewStatus;
  name: string | null;
  mobile: string | null;
  isVerifiedPurchase: boolean;
  adminReply: string | null;
  createdAt: string;
  product: { id: string; name: string; slug: string } | null;
}

interface QueueResponse {
  status: ReviewStatus;
  page: number;
  items: ReviewRow[];
  counts: Record<string, number>;
}

const STATUS_FA: Record<ReviewStatus, string> = {
  PENDING: "در انتظار تأیید",
  APPROVED: "منتشرشده",
  REJECTED: "ردشده",
  HIDDEN: "پنهان",
};

const TABS: ReviewStatus[] = ["PENDING", "APPROVED", "REJECTED", "HIDDEN"];

export default function ReviewsClient() {
  const { call, loading } = useAdminApi();
  const [status, setStatus] = useState<ReviewStatus>("PENDING");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<QueueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  const load = useCallback(async () => {
    setError(null);
    const r = await call<QueueResponse>(`/reviews/admin/queue?status=${status}&page=${page}`);
    if (r.ok && r.data) setData(r.data);
    else setError(r.error?.message ?? "خطا در دریافت صف نظرات");
  }, [call, status, page]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, page]);

  async function act(id: string, action: "approve" | "reject" | "hide", label: string) {
    setBusyId(id);
    setNotice(null);
    const r = await call(`/reviews/admin/${id}/${action}`, { method: "POST" });
    setBusyId(null);
    if (r.ok) {
      setNotice(label);
      void load();
    } else {
      setError(r.error?.message ?? "اقدام ناموفق بود");
    }
  }

  async function sendReply(id: string) {
    if (replyText.trim().length < 2) return;
    setBusyId(id);
    const r = await call(`/reviews/admin/${id}/reply`, {
      method: "POST",
      body: JSON.stringify({ reply: replyText.trim() }),
    });
    setBusyId(null);
    if (r.ok) {
      setReplyFor(null);
      setReplyText("");
      setNotice("پاسخ ثبت شد");
      void load();
    } else {
      setError(r.error?.message ?? "ثبت پاسخ ناموفق بود");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <p className="rounded-xl bg-app-primary-soft px-4 py-2 text-xs font-bold text-app-err">{error}</p> : null}
      {notice ? <p className="rounded-xl bg-app-primary-soft px-4 py-2 text-xs font-bold text-app-ok">{notice}</p> : null}

      {/* تب‌ها + شمارنده */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((s) => (
          <button
            key={s}
            onClick={() => { setStatus(s); setPage(1); }}
            className={`rounded-full px-4 py-1.5 text-xs font-bold transition ${
              status === s ? "bg-ink text-surface" : "border border-line text-muted hover:text-ink"
            }`}
          >
            {STATUS_FA[s]}
            {data?.counts?.[s] ? ` (${data.counts[s]})` : ""}
          </button>
        ))}
      </div>

      {/* لیست */}
      <div className="flex flex-col gap-3">
        {loading && !data ? <p className="text-xs text-muted">در حال دریافت…</p> : null}
        {data && data.items.length === 0 ? (
          <p className="rounded-card border border-line bg-surface px-4 py-8 text-center text-sm text-ink/50">
            نظری با وضعیت «{STATUS_FA[status]}» وجود ندارد.
          </p>
        ) : null}
        {data?.items.map((rv) => (
          <article key={rv.id} className="rounded-card border border-line bg-surface p-4 shadow-clay-1">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-black text-amber-500" aria-label={`امتیاز ${rv.rating} از ۵`}>
                {"★".repeat(rv.rating)}{"☆".repeat(5 - rv.rating)}
              </span>
              <span className="font-bold text-ink">{rv.name?.trim() || "مهمان"}</span>
              {rv.isVerifiedPurchase ? (
                <span className="rounded-full bg-app-ok/10 px-2 py-0.5 font-bold text-app-ok">خریدار واقعی</span>
              ) : (
                <span className="rounded-full border border-line px-2 py-0.5 text-muted">بدون خرید</span>
              )}
              <span className="text-ink/50" dir="ltr">{rv.mobile ?? "—"}</span>
              <span className="text-ink/40">{new Date(rv.createdAt).toLocaleDateString("fa-IR")}</span>
              <span className="ms-auto rounded-full border border-line px-2 py-0.5 text-ink/60">{STATUS_FA[rv.status]}</span>
            </div>
            {rv.product ? (
              <p className="mt-1.5 text-[11px] text-muted">
                محصول: <span className="font-bold text-ink">{rv.product.name}</span>
              </p>
            ) : null}
            <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-ink">{rv.body}</p>
            {rv.adminReply ? (
              <p className="mt-2 rounded-xl bg-app-primary-soft px-3 py-2 text-xs leading-6 text-ink">
                <span className="font-bold">پاسخ تو: </span>{rv.adminReply}
              </p>
            ) : null}

            {replyFor === rv.id ? (
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  rows={2}
                  maxLength={1000}
                  placeholder="پاسخ عمومی فروشگاه (زیر نظر منتشر می‌شود)"
                  className="flex-1 rounded-xl border border-line bg-white px-3 py-2 text-xs leading-6 outline-none focus:border-ink"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => void sendReply(rv.id)}
                    disabled={busyId === rv.id || replyText.trim().length < 2}
                    className="rounded-xl bg-ink px-4 py-2 text-xs font-bold text-surface disabled:opacity-50"
                  >
                    ثبت پاسخ
                  </button>
                  <button onClick={() => { setReplyFor(null); setReplyText(""); }} className="rounded-xl border border-line px-3 py-2 text-xs text-muted">
                    انصراف
                  </button>
                </div>
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2">
              {rv.status !== "APPROVED" ? (
                <button onClick={() => void act(rv.id, "approve", "نظر منتشر شد")} disabled={busyId === rv.id}
                  className="rounded-xl bg-app-ok/10 px-3 py-1.5 text-xs font-bold text-app-ok disabled:opacity-50">
                  تأیید و انتشار
                </button>
              ) : null}
              {rv.status !== "REJECTED" ? (
                <button onClick={() => void act(rv.id, "reject", "نظر رد شد")} disabled={busyId === rv.id}
                  className="rounded-xl bg-app-err/10 px-3 py-1.5 text-xs font-bold text-app-err disabled:opacity-50">
                  رد
                </button>
              ) : null}
              {rv.status !== "HIDDEN" ? (
                <button onClick={() => void act(rv.id, "hide", "نظر پنهان شد")} disabled={busyId === rv.id}
                  className="rounded-xl border border-line px-3 py-1.5 text-xs font-bold text-muted disabled:opacity-50">
                  پنهان
                </button>
              ) : null}
              <button onClick={() => { setReplyFor(replyFor === rv.id ? null : rv.id); setReplyText(rv.adminReply ?? ""); }}
                className="rounded-xl border border-line px-3 py-1.5 text-xs font-bold text-ink">
                {rv.adminReply ? "ویرایش پاسخ" : "پاسخ"}
              </button>
            </div>
          </article>
        ))}
      </div>

      {/* صفحه‌بندی */}
      {data && data.items.length === 20 ? (
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
            className="rounded-xl border border-line px-4 py-1.5 text-xs text-muted disabled:opacity-40">
            قبلی
          </button>
          <span className="text-xs text-ink/60">صفحه {page.toLocaleString("fa-IR")}</span>
          <button onClick={() => setPage((p) => p + 1)}
            className="rounded-xl border border-line px-4 py-1.5 text-xs text-muted">
            بعدی
          </button>
        </div>
      ) : null}
    </div>
  );
}
