"use client";

/**
 * تابلوی برنامهٔ عکاسی محصول (گام ۲۰).
 *
 * چرا این صفحه شکلِ «شات‌لیست» دارد و نه یک جدول: عکاس باید بداند برای هر دسته
 * چه کادرهایی لازم است و کدام‌ها هنوز مانده. پس راستِ صفحه مشخصاتِ کادرهای
 * دستهٔ انتخاب‌شده می‌آید (همان چیزی که عکاس می‌خواند) و چپش محصول‌ها با
 * قاب‌های کوچک — هر قاب یک کادر، هر کادر یک وضعیت.
 *
 * نوارِ بالای صفحه هم یک «نوار تماس» است: هر مربعِ کوچک یک کادر در کلِ برنامه.
 * با یک نگاه می‌شود فهمید کجا گیر کرده — بدون خواندن هیچ عددی.
 *
 * چرخهٔ هر کادر: عکس در همان کادر می‌نشیند (کشیدن‌ورهاکردن یا انتخاب فایل) →
 * «عکس گرفته شد» → «تأیید» (برای «نمای صافِ جلو» یعنی عکسِ اصلیِ محصول و آرتِ
 * جانشین کنار می‌رود) یا «عکسِ دوباره».
 *
 * چرا آپلود همین‌جا و نه در کتابخانهٔ رسانه: عکاس یک پوشه عکس دارد و کارش
 * «گذاشتنِ عکس در کادر» است. فرستادنش به صفحهٔ دیگری برای آپلود، وسطِ کار
 * قطعِ رشته است؛ کادر خودش فایل را می‌گیرد و همان لحظه به محصول می‌چسباند.
 * کتابخانه سرِ جایش می‌ماند — برای انتخابِ عکسی که از قبل هست.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PHOTO_SETUP,
  PHOTO_STATUS_LABELS,
  type PhotoBulkApproveResult,
  type PhotoProgramBoard,
  type PhotoProgramCategory,
  type PhotoProgramProduct,
  type PhotoProgramShot,
  type PhotoShotKind,
  type PhotoTaskStatus,
} from "@ghasedak/contracts";
import { approvableShots, bulkApproveMessage, pruneSelection, toggleAll, toggleTask } from "@/lib/photo-approve";
import { uploadMedia, useAdminApi } from "@/components/useAdminApi";
import MediaLibraryDialog, { type PickedMedia } from "@/components/MediaLibraryDialog";
import {
  PHOTO_IMAGE_TYPES,
  checkPhotoFile,
  firstPhotoFile,
  isPhotoDrag,
} from "@/lib/photo-upload";

type Call = <T,>(
  path: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; status: number; data?: T; error?: { message?: string } }>;

const FALLBACK_MSG = "انجام نشد؛ کمی بعد دوباره تلاش کن.";

/** رنگ و برچسب هر وضعیت — یک‌جا تا رنگِ وضعیت‌ها در کلِ صفحه یکی بماند */
const STATUS_STYLE: Record<PhotoTaskStatus, { chip: string; dot: string; square: string }> = {
  PENDING: {
    chip: "bg-app-bg text-app-muted",
    dot: "bg-app-line",
    square: "border-app-line bg-app-bg",
  },
  SHOT: {
    chip: "bg-app-info/10 text-app-info",
    dot: "bg-app-info",
    square: "bg-app-info",
  },
  NEEDS_RETAKE: {
    chip: "bg-app-err/10 text-app-err",
    dot: "bg-app-err",
    square: "bg-app-err",
  },
  APPROVED: {
    chip: "bg-app-ok/10 text-app-ok",
    dot: "bg-app-ok",
    square: "bg-app-ok",
  },
};

export default function PhotographyClient() {
  const { call, permissions } = useAdminApi();
  const [board, setBoard] = useState<PhotoProgramBoard | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState<{ productId: string; kind: PhotoShotKind; label: string } | null>(null);
  /** کادری که همین حالا در حال آپلود است — کلید: «productId:kind» */
  const [uploading, setUploading] = useState<string | null>(null);
  /** شناسهٔ کارهای انتخاب‌شده برای تأییدِ گروهی (نه slugِ دسته) */
  const [picked, setPicked] = useState<string[]>([]);

  const canUpdate = permissions.includes("products.update");
  /** آپلود به مجوزِ رسانه نیاز دارد — بدون آن، فقط انتخاب از کتابخانه می‌ماند */
  const canUpload = canUpdate && permissions.includes("media.manage");

  const load = useCallback(async () => {
    const r = await call<PhotoProgramBoard>("/admin/photography/board");
    if (r.ok && r.data) {
      setBoard(r.data);
      setSelected((prev) =>
        prev && r.data!.categories.some((c) => c.slug === prev) ? prev : r.data!.categories[0]?.slug ?? null,
      );
    }
  }, [call]);

  useEffect(() => {
    void load();
  }, [load]);

  const say = (text: string, ok = true) => setMsg({ text, ok });

  /** اجرای یک کنش + تازه‌سازیِ تابلو — پیام خطا از خودِ سرور می‌آید */
  const run = async (fn: () => Promise<{ ok: boolean; error?: { message?: string } }>, okText: string) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r.ok) {
        say(okText);
        await load();
      } else {
        say(r.error?.message ?? FALLBACK_MSG, false);
      }
    } catch {
      say(FALLBACK_MSG, false);
    } finally {
      setBusy(false);
    }
  };

  const attach = (productId: string, kind: PhotoShotKind, mediaId: string) =>
    run(
      () =>
        call(`/admin/photography/products/${productId}/shots/${kind}`, {
          method: "POST",
          body: JSON.stringify({ mediaId }),
        }),
      "عکس ثبت شد؛ برای نمایش در سایت تأییدش کن.",
    );

  /**
   * آپلودِ مستقیم در همان کادر: فایل → رسانه → پیوست به کادر.
   *
   * چرا دو فراخوانی: API دو مسئولیتِ جدا دارد (رسانه ≠ کارِ عکاسی). اگر پیوست
   * شکست بخورد، فایل در کتابخانه مانده و از دست نرفته — پیام هم همین را می‌گوید
   * تا عکاس فکر نکند کارش پریده و دوباره آپلود نکند.
   */
  const uploadInto = async (product: PhotoProgramProduct, shot: PhotoProgramShot, file: File) => {
    const problem = checkPhotoFile(file);
    if (problem) {
      say(problem.message, false);
      return;
    }

    setUploading(`${product.id}:${shot.kind}`);
    setBusy(true);
    try {
      const up = await uploadMedia(file, call, {
        // متن جایگزین از خودِ کادر ساخته می‌شود، نه از نام فایل — «IMG_2043»
        // برای صفحه‌خوان و موتور جست‌وجو هیچ نمی‌گوید.
        alt: `${product.name} — ${shot.label}`,
      });
      if (!up.ok || !up.id) {
        say(up.error ?? "آپلود عکس انجام نشد؛ چند لحظه بعد دوباره تلاش کن.", false);
        return;
      }

      const r = await call(`/admin/photography/products/${product.id}/shots/${shot.kind}`, {
        method: "POST",
        body: JSON.stringify({ mediaId: up.id }),
      });
      if (!r.ok) {
        say(
          `عکس در کتابخانه ذخیره شد ولی به این کادر نچسبید: ${r.error?.message ?? FALLBACK_MSG}`,
          false,
        );
        return;
      }

      say("عکس آپلود شد؛ برای نمایش در سایت تأییدش کن.");
      await load();
    } catch {
      say(FALLBACK_MSG, false);
    } finally {
      setUploading(null);
      setBusy(false);
    }
  };

  const approve = (taskId: string) =>
    run(
      () => call(`/admin/photography/tasks/${taskId}/approve`, { method: "POST" }),
      "عکس تأیید شد.",
    );

  const retake = (taskId: string) =>
    run(
      () => call(`/admin/photography/tasks/${taskId}/retake`, { method: "POST", body: JSON.stringify({}) }),
      "عکس کنار گذاشته شد؛ دوباره بگیر.",
    );

  /** همهٔ کادرهای آمادهٔ تأیید — همهٔ دسته‌ها، نه فقط دستهٔ باز */
  const ready = useMemo(() => approvableShots(board), [board]);
  const readyIds = useMemo(() => ready.map((r) => r.taskId), [ready]);
  /** از میان انتخاب‌شده‌ها، چند تا کادرِ اصلی‌اند (تأییدشان سایت را عوض می‌کند) */
  const pickedPrimary = ready.filter((r) => r.primary && picked.includes(r.taskId)).length;

  /**
   * بعد از هر تازه‌سازی، انتخاب با واقعیت هم‌خوان می‌شود.
   *
   * اگر شناسه‌ای که دیگر «آماده» نیست در انتخاب بماند، دکمهٔ تأییدِ گروهی
   * درخواستی می‌فرستد که فقط خطا برمی‌گرداند — و مدیر فکر می‌کند کار خراب است.
   */
  useEffect(() => {
    setPicked((cur) => {
      const next = pruneSelection(cur, board);
      return next.length === cur.length ? cur : next;
    });
  }, [board]);

  const toggleSelect = (taskId: string) => setPicked((cur) => toggleTask(cur, taskId));
  const selectAllReady = () => setPicked((cur) => toggleAll(cur, readyIds));

  /**
   * تأییدِ گروهی — یک درخواست، نتیجهٔ هر کار جدا.
   *
   * چرا تأیید می‌پرسیم: تأییدِ «نمای صافِ جلو» همان لحظه عکسِ زندهٔ سایت را
   * عوض می‌کند؛ این تنها جای این صفحه است که یک کلیک روی چند محصول اثرِ
   * عمومی دارد. سؤال فقط وقتی می‌آید که واقعاً کادرِ اصلی در انتخاب باشد.
   */
  const approvePicked = async () => {
    if (picked.length === 0) return;
    const question =
      pickedPrimary > 0
        ? `${fa(picked.length)} کادر تأیید شود؟ ${fa(pickedPrimary)} «نمای صافِ جلو» همان لحظه عکسِ اصلیِ محصول در سایت می‌شود.`
        : `${fa(picked.length)} کادر تأیید شود؟`;
    if (!window.confirm(question)) return;

    setBusy(true);
    try {
      const r = await call<PhotoBulkApproveResult>("/admin/photography/tasks/approve", {
        method: "POST",
        body: JSON.stringify({ taskIds: picked }),
      });
      if (!r.ok || !r.data) {
        say(r.error?.message ?? FALLBACK_MSG, false);
        return;
      }
      say(bulkApproveMessage(r.data), r.data.failed.length === 0);
      // فقط ناموفق‌ها در انتخاب می‌مانند تا بشود دوباره تلاش کرد
      setPicked(r.data.failed.map((f) => f.taskId));
      await load();
    } catch {
      say(FALLBACK_MSG, false);
    } finally {
      setBusy(false);
    }
  };

  const category = useMemo<PhotoProgramCategory | null>(
    () => board?.categories.find((c) => c.slug === selected) ?? null,
    [board, selected],
  );

  if (!board) {
    return <p className="text-xs text-app-muted">در حال خواندن تابلو…</p>;
  }

  return (
    <div
      className="space-y-4"
      // رهاکردنِ فایل بیرونِ کادرها نباید مرورگر را به نمایشِ خودِ فایل ببرد
      onDragOver={(e) => {
        if (isPhotoDrag([...e.dataTransfer.types], e.dataTransfer.types.includes("Files"))) e.preventDefault();
      }}
    >
      {msg && (
        <div
          role="status"
          className={`rounded-card border px-4 py-2 text-xs font-bold ${
            msg.ok ? "border-app-line bg-app-surface text-app-ink" : "border-app-err/40 bg-app-err/5 text-app-err"
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* ── نوار تماس: کلِ برنامه در یک نگاه ───────────────────────── */}
      <section className="rounded-card border border-app-line bg-app-surface p-4">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <div>
            <p className="text-[11px] font-bold text-app-muted">پیشرفت برنامه</p>
            <p className="mt-0.5 text-3xl font-black tabular-nums text-app-ink">
              {fa(board.overall.percent)}٪
            </p>
          </div>
          <p className="text-[12px] text-app-muted">
            {fa(board.overall.done)} کادر از {fa(board.overall.total)} عکاسی شده
          </p>
          <p className="text-[12px] text-app-muted">
            {fa(board.overall.productsWithArt)} محصول از {fa(board.overall.productsTotal)} هنوز آرتِ جانشین دارد
          </p>
          <div className="ms-auto flex flex-wrap gap-1.5">
            {(Object.keys(PHOTO_STATUS_LABELS) as PhotoTaskStatus[]).map((s) => (
              <span
                key={s}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${STATUS_STYLE[s].chip}`}
              >
                <span className={`size-1.5 rounded-full ${STATUS_STYLE[s].dot}`} aria-hidden />
                {PHOTO_STATUS_LABELS[s]} {fa(board.overall.byStatus[s])}
              </span>
            ))}
          </div>
        </div>

        {/* نوارِ مربع‌ها — هر مربع یک کادر در کلِ برنامه */}
        <div className="mt-3 flex flex-wrap gap-1" aria-hidden>
          {board.categories.flatMap((c) =>
            c.products.flatMap((p) =>
              p.shots.map((s) => (
                <span
                  key={`${p.id}:${s.kind}`}
                  className={`size-2.5 rounded-[3px] ${STATUS_STYLE[s.status].square}`}
                  title={`${p.name} — ${s.label} — ${PHOTO_STATUS_LABELS[s.status]}`}
                />
              )),
            ),
          )}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
        {/* ── دسته‌ها ─────────────────────────────────────────────── */}
        <aside className="rounded-card border border-app-line bg-app-surface p-4">
          <h2 className="mb-3 text-sm font-black text-app-ink">دسته‌ها</h2>
          <ul className="space-y-1.5">
            {board.categories.map((c) => (
              <li key={c.slug}>
                <button
                  type="button"
                  onClick={() => setSelected(c.slug)}
                  className={`w-full rounded-xl border p-2.5 text-start transition-colors ${
                    c.slug === selected
                      ? "border-app-primary bg-app-primary-tint"
                      : "border-app-line bg-app-bg hover:border-app-primary-soft"
                  }`}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-bold text-app-ink">{c.label}</span>
                    <span className="text-[11px] font-bold tabular-nums text-app-muted">
                      {fa(c.percent)}٪
                    </span>
                  </span>
                  <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-app-line">
                    <span
                      className="block h-full rounded-full bg-app-primary"
                      style={{ width: `${c.percent}%` }}
                    />
                  </span>
                  <span className="mt-1 block text-[10px] text-app-muted">
                    {fa(c.products.length)} محصول · {fa(c.done)} از {fa(c.total)} کادر
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {board.categories.length === 0 && (
            <p className="text-[12px] text-app-muted">هنوز محصولی در کاتالوگ نیست.</p>
          )}
        </aside>

        {/* ── شات‌لیستِ دسته + محصول‌ها ───────────────────────────── */}
        <section className="space-y-4">
          {/* نوارِ تأییدِ گروهی — فقط وقتی چیزی انتخاب شده؛ چسبان تا در لیستِ بلند گم نشود */}
          {picked.length > 0 && (
            <div
              role="region"
              aria-label="تأیید گروهی"
              className="sticky top-2 z-20 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-app-primary-soft bg-app-surface px-3 py-2 shadow-app-shadow-1"
            >
              <span className="text-[12px] font-black text-app-ink">
                {fa(picked.length)} کادر انتخاب شده
              </span>
              {pickedPrimary > 0 && (
                <span className="rounded-full bg-app-primary-tint px-2 py-0.5 text-[10px] font-bold text-app-primary-strong">
                  {fa(pickedPrimary)} نمای صافِ جلو — سایت عوض می‌شود
                </span>
              )}
              <div className="ms-auto flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPicked([])}
                  disabled={busy}
                  className="rounded-full border border-app-line px-2.5 py-1 text-[10px] font-bold text-app-muted disabled:opacity-50"
                >
                  لغو انتخاب
                </button>
                <button
                  type="button"
                  onClick={() => void approvePicked()}
                  disabled={busy}
                  className="rounded-full bg-app-ok px-3 py-1 text-[11px] font-black text-white disabled:opacity-50"
                >
                  {busy ? "در حال تأیید…" : "تأیید گروهی"}
                </button>
              </div>
            </div>
          )}

          {category ? (
            <>
              <div className="rounded-card border border-app-line bg-app-surface p-4">
                <h2 className="text-sm font-black text-app-ink">
                  شات‌لیستِ {category.label}
                </h2>
                <p className="mt-1 text-[11px] leading-5 text-app-muted">
                  این کادرها را برای هر محصولِ این دسته بگیر. عکسِ «نمای صافِ جلو» همان
                  عکسِ اصلیِ محصول است — با تأییدش، آرتِ جانشین از سایت کنار می‌رود.
                </p>

                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {category.shots.map((s) => (
                    <li key={s.kind} className="rounded-xl border border-app-line bg-app-bg p-2.5">
                      <p className="flex items-center gap-2 text-[12px] font-bold text-app-ink">
                        {s.label}
                        <span
                          className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
                            s.required ? "bg-app-primary-tint text-app-primary-strong" : "bg-app-bg text-app-muted"
                          }`}
                        >
                          {s.required ? "اجباری" : "اختیاری"}
                        </span>
                      </p>
                      <p className="mt-1 text-[11px] leading-5 text-app-muted">{s.spec}</p>
                    </li>
                  ))}
                </ul>

                {category.notes.length > 0 && (
                  <div className="mt-3 rounded-xl border border-app-line bg-app-bg p-2.5">
                    <p className="text-[11px] font-black text-app-ink">نکته‌های همین دسته</p>
                    <ul className="mt-1 list-inside list-disc text-[11px] leading-5 text-app-muted">
                      {category.notes.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <details className="mt-3">
                  <summary className="cursor-pointer text-[11px] font-bold text-app-muted">
                    راه‌اندازیِ مشترکِ همهٔ دسته‌ها
                  </summary>
                  <dl className="mt-2 grid gap-1.5 text-[11px] leading-5 sm:grid-cols-2">
                    <SetupRow label="پس‌زمینه" value={PHOTO_SETUP.background} />
                    <SetupRow label="نور" value={PHOTO_SETUP.light} />
                    <SetupRow label="دوربین" value={PHOTO_SETUP.camera} />
                    <SetupRow label="خروجی" value={PHOTO_SETUP.output} />
                    <SetupRow label="نامِ فایل" value={PHOTO_SETUP.naming} />
                    <SetupRow label="قانون برند" value={PHOTO_SETUP.rule} />
                  </dl>
                </details>
              </div>

              {/* راهِ انتخاب — فقط وقتی کادری واقعاً آمادهٔ تأیید هست ظاهر می‌شود */}
              {ready.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-card border border-app-line bg-app-surface px-3 py-2">
                  <p className="text-[11px] text-app-muted">
                    {fa(ready.length)} کادر آمادهٔ تأیید است — می‌توانی همه را یک‌جا تأیید کنی.
                  </p>
                  <button
                    type="button"
                    onClick={selectAllReady}
                    className="ms-auto rounded-full border border-app-primary-soft px-2.5 py-1 text-[10px] font-bold text-app-primary-strong transition-colors hover:bg-app-primary-tint"
                  >
                    {readyIds.every((id) => picked.includes(id)) ? "برداشتنِ همه" : "انتخاب همه"}
                  </button>
                </div>
              )}

              <ul className="space-y-3">
                {category.products.map((p) => (
                  <li key={p.id}>
                    <ProductCard
                      product={p}
                      canUpdate={canUpdate}
                      canUpload={canUpload}
                      busy={busy}
                      uploadingKind={
                        uploading && uploading.startsWith(`${p.id}:`)
                          ? (uploading.slice(p.id.length + 1) as PhotoShotKind)
                          : null
                      }
                      picked={picked}
                      onToggleSelect={toggleSelect}
                      onPick={(kind, label) => setPicker({ productId: p.id, kind, label })}
                      onUpload={(shot, file) => void uploadInto(p, shot, file)}
                      onApprove={approve}
                      onRetake={retake}
                    />
                  </li>
                ))}
              </ul>

              {category.products.length === 0 && (
                <p className="rounded-card border border-dashed border-app-line bg-app-surface p-6 text-center text-[12px] text-app-muted">
                  محصولی در این دسته نیست.
                </p>
              )}
            </>
          ) : (
            <p className="rounded-card border border-dashed border-app-line bg-app-surface p-6 text-center text-[12px] text-app-muted">
              از ستونِ کنار یک دسته را انتخاب کن.
            </p>
          )}
        </section>
      </div>

      <MediaLibraryDialog
        open={picker != null}
        onClose={() => setPicker(null)}
        onPick={(m: PickedMedia) => {
          if (picker) void attach(picker.productId, picker.kind, m.id);
        }}
        title={picker ? `انتخاب عکس — ${picker.label}` : "انتخاب تصویر"}
      />
    </div>
  );
}

/* ── کارتِ یک محصول: قابِ هر کادر ───────────────────────────────── */

function ProductCard({
  product,
  canUpdate,
  canUpload,
  busy,
  uploadingKind,
  picked,
  onToggleSelect,
  onPick,
  onUpload,
  onApprove,
  onRetake,
}: {
  product: PhotoProgramProduct;
  canUpdate: boolean;
  canUpload: boolean;
  busy: boolean;
  /** کادری از همین محصول که در حال آپلود است */
  uploadingKind: PhotoShotKind | null;
  /** شناسهٔ کارهای انتخاب‌شده برای تأییدِ گروهی */
  picked: string[];
  onToggleSelect: (taskId: string) => void;
  onPick: (kind: PhotoShotKind, label: string) => void;
  onUpload: (shot: PhotoProgramShot, file: File) => void;
  onApprove: (taskId: string) => void;
  onRetake: (taskId: string) => void;
}) {
  return (
    <div className="rounded-card border border-app-line bg-app-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[13px] font-black text-app-ink">{product.name}</h3>
        {product.status !== "PUBLISHED" && (
          <span className="rounded-full bg-app-warning/15 px-2 py-0.5 text-[10px] font-bold text-app-warning">
            {product.status === "DRAFT" ? "پیش‌نویس" : "بایگانی"}
          </span>
        )}
        <span className="text-[11px] text-app-muted" dir="ltr">
          {product.slug}
        </span>
        <span className="ms-auto text-[11px] font-bold tabular-nums text-app-muted">
          {fa(product.done)} از {fa(product.total)} کادر · {fa(product.percent)}٪
        </span>
      </div>

      {product.primaryImage ? (
        <p className="mt-1 text-[10px] text-app-muted">
          عکسِ اصلیِ محصول:{" "}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={product.primaryImage}
            alt=""
            className="inline-block size-6 rounded object-cover align-middle"
          />
        </p>
      ) : (
        <p className="mt-1 text-[10px] font-bold text-app-warning">
          هنوز آرتِ جانشین دارد — تا تأییدِ «نمای صافِ جلو» همین آرت در سایت می‌ماند.
        </p>
      )}

      <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {product.shots.map((s) => (
          <li key={s.kind}>
            <ShotTile
              shot={s}
              canUpdate={canUpdate}
              canUpload={canUpload}
              busy={busy}
              uploading={uploadingKind === s.kind}
              selected={!!s.taskId && picked.includes(s.taskId)}
              onToggleSelect={() => s.taskId && onToggleSelect(s.taskId)}
              onPick={() => onPick(s.kind, s.label)}
              onUpload={(file) => onUpload(s, file)}
              onApprove={() => s.taskId && onApprove(s.taskId)}
              onRetake={() => s.taskId && onRetake(s.taskId)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── یک کادر: عکس، وضعیت و کنش‌ها ───────────────────────────────── */

function ShotTile({
  shot,
  canUpdate,
  canUpload,
  busy,
  uploading,
  selected,
  onToggleSelect,
  onPick,
  onUpload,
  onApprove,
  onRetake,
}: {
  shot: PhotoProgramShot;
  canUpdate: boolean;
  /** آپلودِ مستقیم در همین کادر (نیازمندِ دسترسیِ رسانه) */
  canUpload: boolean;
  busy: boolean;
  /** همین کادر الان در حال آپلود است */
  uploading: boolean;
  /** در انتخابِ تأییدِ گروهی هست */
  selected: boolean;
  onToggleSelect: () => void;
  onPick: () => void;
  onUpload: (file: File) => void;
  onApprove: () => void;
  onRetake: () => void;
}) {
  const style = STATUS_STYLE[shot.status];
  const fileRef = useRef<HTMLInputElement>(null);
  /** فایلی که همین حالا روی کادر نگه داشته شده — فقط برای هایلایت */
  const [over, setOver] = useState(false);

  /** هر چیزی که آپلود را قفل کند: بدون مجوز، وسطِ کار، یا آپلودِ همین کادر */
  const dropReady = canUpload && !busy;
  /** فقط «عکس گرفته شد» چیزی برای تأیید دارد */
  const selectable = canUpdate && shot.status === "SHOT" && !!shot.taskId;

  const takeFile = (file: File | null | undefined) => {
    if (file) onUpload(file);
  };

  return (
    <div
      aria-busy={uploading || undefined}
      onDragOver={(e) => {
        if (!dropReady) return;
        if (!isPhotoDrag([...e.dataTransfer.types], e.dataTransfer.types.includes("Files"))) return;
        // بدون preventDefault، مرورگر فایل را باز می‌کند و کادر هرگز drop نمی‌بیند
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (!over) setOver(true);
      }}
      onDragLeave={(e) => {
        // جابه‌جایی بین فرزندانِ همین کادر، «خروج» نیست
        const next = e.relatedTarget as Node | null;
        if (next && e.currentTarget.contains(next)) return;
        setOver(false);
      }}
      onDrop={(e) => {
        if (!dropReady) return;
        e.preventDefault();
        setOver(false);
        // اولی عکسِ مجاز را می‌گیریم؛ اگر هیچ عکسی نبود، فایل را می‌فرستیم تا
        // همان پیامِ روشنِ «فرمت پذیرفته نمی‌شود» را ببیند، نه سکوت.
        const dropped = firstPhotoFile(e.dataTransfer.files) ?? e.dataTransfer.files?.[0] ?? null;
        takeFile(dropped);
      }}
      className={`rounded-xl border p-2 transition-colors ${
        over
          ? "border-app-primary bg-app-primary-tint/40"
          : selected
            ? "border-app-primary-soft bg-app-primary-tint/30"
            : "border-app-line bg-app-bg"
      }`}
    >
      {/* قابِ خالی، خطِ چین‌دار دارد — نشانهٔ «اینجا جای گذاشتن است» */}
      <div
        className={`relative aspect-square overflow-hidden rounded-lg border bg-app-surface ${
          !shot.mediaUrl && canUpload ? "border-dashed border-app-line" : "border-app-line"
        }`}
      >
        {shot.mediaUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shot.mediaUrl} alt={shot.label} className="size-full object-cover" />
        ) : (
          <button
            type="button"
            onClick={canUpload ? () => fileRef.current?.click() : canUpdate ? onPick : undefined}
            disabled={!canUpdate}
            className="flex size-full flex-col items-center justify-center gap-1 px-2 text-app-muted disabled:opacity-60"
          >
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
              <path d="M4 8h3l1.5-2h7L17 8h3v11H4V8z" strokeLinejoin="round" />
              <circle cx="12" cy="13" r="3.2" />
            </svg>
            <span className="text-[10px] font-bold">
              {!canUpdate ? "عکسی ثبت نشده" : canUpload ? "انتخاب عکس از فایل" : "انتخاب از کتابخانه"}
            </span>
            {canUpload && <span className="text-[9px] font-normal text-app-muted">یا عکس را اینجا رها کن</span>}
          </button>
        )}

        <span
          className={`absolute start-1.5 top-1.5 rounded-full px-2 py-0.5 text-[9px] font-bold ${style.chip}`}
        >
          {PHOTO_STATUS_LABELS[shot.status]}
        </span>

        {shot.live && (
          <span className="absolute end-1.5 top-1.5 rounded-full bg-app-ok px-2 py-0.5 text-[9px] font-bold text-white">
            عکسِ اصلیِ محصول
          </span>
        )}

        {/* کشیدن روی کادر — فقط وقتی فایل در دست است */}
        {over && (
          <span className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-lg border-2 border-dashed border-app-primary bg-app-primary-tint/85 px-2 text-center">
            <span className="text-[10px] font-black leading-4 text-app-primary-strong">
              رها کن تا در همین کادر بنشیند
            </span>
          </span>
        )}

        {uploading && (
          <span className="absolute inset-0 z-10 grid place-items-center gap-1 bg-app-surface/85">
            <span className="size-4 animate-spin rounded-full border-2 border-app-primary-soft border-t-app-primary" aria-hidden />
            <span className="text-[10px] font-bold text-app-primary-strong">در حال آپلود…</span>
          </span>
        )}

        {/* تیکِ انتخابِ گروهی — فقط روی کادرِ آمادهٔ تأیید */}
        {selectable && (
          <label
            className={`absolute bottom-1.5 start-1.5 z-10 inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-bold shadow-app-shadow-1 transition-colors ${
              selected
                ? "border-app-primary bg-app-primary text-white"
                : "border-app-line bg-app-surface/95 text-app-ink hover:border-app-primary-soft"
            }`}
          >
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              aria-label={`انتخاب «${shot.label}» برای تأیید گروهی`}
              className="size-3 accent-current"
            />
            انتخاب
          </label>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={PHOTO_IMAGE_TYPES.join(",")}
        aria-label={`آپلود عکس — ${shot.label}`}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          // خالی‌کردن، تا انتخابِ دوبارهٔ همان فایل هم رویداد بدهد
          e.target.value = "";
          takeFile(f);
        }}
      />

      <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-bold text-app-ink">
        {shot.label}
        {shot.required && (
          <span className="rounded-full bg-app-primary-tint px-1.5 py-0.5 text-[9px] text-app-primary-strong">
            اجباری
          </span>
        )}
      </p>
      {shot.note && <p className="mt-0.5 text-[10px] leading-4 text-app-muted">{shot.note}</p>}

      {canUpdate && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {canUpload && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="rounded-full border border-app-primary-soft bg-app-surface px-2.5 py-1 text-[10px] font-bold text-app-primary-strong transition-colors hover:bg-app-primary-tint disabled:opacity-50"
            >
              {shot.mediaUrl ? "آپلود عکسِ تازه" : "آپلود عکس"}
            </button>
          )}
          <button
            type="button"
            onClick={onPick}
            disabled={busy}
            className="rounded-full border border-app-line px-2.5 py-1 text-[10px] font-bold text-app-ink disabled:opacity-50"
          >
            {shot.mediaUrl ? "تعویض از کتابخانه" : "کتابخانه"}
          </button>
          {shot.status === "SHOT" && (
            <button
              type="button"
              onClick={onApprove}
              disabled={busy}
              className="rounded-full bg-app-ok px-2.5 py-1 text-[10px] font-bold text-white disabled:opacity-50"
            >
              تأیید
            </button>
          )}
          {(shot.status === "APPROVED" || shot.status === "NEEDS_RETAKE") && (
            <button
              type="button"
              onClick={onRetake}
              disabled={busy}
              className="rounded-full border border-app-err/50 px-2.5 py-1 text-[10px] font-bold text-app-err disabled:opacity-50"
            >
              عکسِ دوباره
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ── ردیفِ راه‌اندازی ───────────────────────────────────────────── */

function SetupRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-app-line bg-app-surface p-2">
      <dt className="text-[10px] font-bold text-app-muted">{label}</dt>
      <dd className="mt-0.5 text-[11px] leading-5 text-app-ink">{value}</dd>
    </div>
  );
}

function fa(n: number | string | null | undefined): string {
  if (n == null) return "—";
  return Number(n).toLocaleString("fa-IR");
}
