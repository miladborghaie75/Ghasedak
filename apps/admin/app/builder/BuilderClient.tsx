"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CMS_BLOCK_DEFS,
  CMS_BLOCK_GROUPS,
  CMS_SUGGESTED_PAGES,
  CmsBlockView,
  makeBlock,
  type CmsBlock,
  type CmsBlockType,
  type CmsData,
  type CmsPageData,
  type CmsPageSummary,
} from "@ghasedak/blocks";
import { useAdminApi } from "@/components/useAdminApi";
import FieldEditor from "./FieldEditor";
import { loadBuilderPreviewData } from "./preview-data";

/**
 * صفحه‌ساز زنده — سه ستون:
 *   راست: پالت بلوک‌های آماده (کشیدنی)
 *   میانه: بوم — پیش‌نمایش واقعی همان کامپوننتی که در فروشگاه رندر می‌شود
 *   چپ: تنظیمات بلوک انتخاب‌شده + تنظیمات صفحه (سئو)
 *
 * نکتهٔ کلیدی «زنده» بودن: بوم، خودِ `CmsBlockView` را رندر می‌کند — همان
 * تابعی که `CmsRenderer` فروشگاه صدا می‌زند. پس پیش‌نمایش دقیقاً همان
 * است؛ نه یک شبیه‌سازی تقریبی. لایهٔ رویی فقط برای انتخاب/کشیدن است و
 * رویدادهای خودِ بلوک را نمی‌گیرد.
 *
 * کشیدن و رها کردن عمداً با HTML5 بومی انجام می‌شود — بدون وابستگی
 * اضافه — و دکمه‌های جابه‌جایی/تکثیر همان کار را با کلید و صفحه‌کلید هم
 * در دسترس می‌گذارند.
 */

const DND_NEW = "application/x-ghasedak-new";
const DND_MOVE = "application/x-ghasedak-move";

type Device = "mobile" | "tablet" | "desktop";
const DEVICE_WIDTH: Record<Device, number> = { mobile: 390, tablet: 768, desktop: 1280 };

export default function BuilderClient({ initialSlug }: { initialSlug?: string }) {
  const { call, loading } = useAdminApi();

  const [pages, setPages] = useState<CmsPageSummary[]>([]);
  const [slug, setSlug] = useState<string>(initialSlug ?? "home");
  const [status, setStatus] = useState<"DRAFT" | "PUBLISHED">("DRAFT");
  const [title, setTitle] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDesc, setSeoDesc] = useState("");
  const [blocks, setBlocks] = useState<CmsBlock[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [data, setData] = useState<CmsData>({ products: [], categories: [], brands: [], guides: [] });
  const [device, setDevice] = useState<Device>("desktop");
  const [query, setQuery] = useState("");
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loadingPage, setLoadingPage] = useState(false);

  /* ── تاریخچه: undo/redo ── */
  const past = useRef<CmsBlock[][]>([]);
  const future = useRef<CmsBlock[][]>([]);
  const [, bumpHistory] = useState(0);

  const commit = useCallback((next: CmsBlock[] | ((prev: CmsBlock[]) => CmsBlock[])) => {
    setBlocks((prev) => {
      past.current = [...past.current.slice(-49), prev];
      future.current = [];
      bumpHistory((n) => n + 1);
      return typeof next === "function" ? next(prev) : next;
    });
    setDirty(true);
  }, []);

  const undo = useCallback(() => {
    setBlocks((cur) => {
      const prev = past.current.pop();
      if (!prev) return cur;
      future.current = [...future.current, cur];
      bumpHistory((n) => n + 1);
      return prev;
    });
    setDirty(true);
  }, []);

  const redo = useCallback(() => {
    setBlocks((cur) => {
      const nxt = future.current.pop();
      if (!nxt) return cur;
      past.current = [...past.current, cur];
      bumpHistory((n) => n + 1);
      return nxt;
    });
    setDirty(true);
  }, []);

  /* ── بارگذاری ── */
  const loadPages = useCallback(async () => {
    const r = await call<{ items: CmsPageSummary[] }>("/admin/pages");
    return r.ok && r.data ? r.data.items : [];
  }, [call]);

  const loadPage = useCallback(
    async (s: string) => {
      setLoadingPage(true);
      const r = await call<{ slug: string; status: string; data: CmsPageData }>(`/admin/pages/${s}`);
      setLoadingPage(false);
      if (!r.ok || !r.data) {
        setBlocks([]);
        setStatus("DRAFT");
        setTitle("");
        setSeoTitle("");
        setSeoDesc("");
        setSelectedId(null);
        return false;
      }
      setBlocks(r.data.data.blocks);
      setStatus(r.data.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT");
      setTitle(r.data.data.title);
      setSeoTitle(r.data.data.seo?.title ?? "");
      setSeoDesc(r.data.data.seo?.description ?? "");
      setSelectedId(null);
      past.current = [];
      future.current = [];
      setDirty(false);
      return true;
    },
    [call],
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      const items = await loadPages();
      if (!alive) return;
      const target = initialSlug ?? items[0]?.slug ?? "home";
      setSlug(target);
      await loadPage(target);
    })();
    void loadBuilderPreviewData().then((d) => {
      if (alive) setData(d);
    });
    return () => {
      alive = false;
    };
  }, [loadPages, loadPage, initialSlug]);

  /* ── ذخیره / انتشار ── */
  const payload = useCallback(
    (): CmsPageData => ({
      version: 1,
      title: title || "بدون عنوان",
      seo: { title: seoTitle || undefined, description: seoDesc || undefined },
      blocks,
    }),
    [title, seoTitle, seoDesc, blocks],
  );

  const flash = useCallback((text: string, tone: "ok" | "err" = "ok") => {
    setMsg({ text, tone });
    setTimeout(() => setMsg(null), 3200);
  }, []);

  const save = useCallback(async () => {
    const r = await call(`/admin/pages/${slug}`, {
      method: "PUT",
      body: JSON.stringify({ payload: payload() }),
    });
    if (r.ok) {
      setDirty(false);
      flash("پیش‌نویس ذخیره شد");
      setPages(await loadPages());
    } else {
      flash(r.error?.message ?? "ذخیره ناموفق", "err");
    }
  }, [call, slug, payload, loadPages, flash]);

  const publish = useCallback(async () => {
    const s = await call(`/admin/pages/${slug}`, {
      method: "PUT",
      body: JSON.stringify({ payload: payload() }),
    });
    if (!s.ok) {
      flash(s.error?.message ?? "ذخیره ناموفق", "err");
      return;
    }
    const p = await call(`/admin/pages/${slug}/publish`, { method: "POST" });
    if (p.ok) {
      setStatus("PUBLISHED");
      setDirty(false);
      flash("منتشر شد — همین حالا در سایت دیده می‌شود");
      setPages(await loadPages());
    } else {
      flash(p.error?.message ?? "انتشار ناموفق", "err");
    }
  }, [call, slug, payload, loadPages, flash]);

  const unpublish = useCallback(async () => {
    const p = await call(`/admin/pages/${slug}/unpublish`, { method: "POST" });
    if (p.ok) {
      setStatus("DRAFT");
      flash("از انتشار خارج شد — سایت به چیدمان پیش‌فرض برگشت");
      setPages(await loadPages());
    }
  }, [call, slug, loadPages, flash]);

  const createPage = useCallback(async () => {
    const s = window.prompt("شناسهٔ صفحه (حروف انگلیسی کوچک، عدد و خط تیره):", "landing-1");
    if (!s) return;
    const t = window.prompt("عنوان صفحه:", "صفحهٔ تازه");
    const r = await call<{ slug: string }>("/admin/pages", {
      method: "POST",
      body: JSON.stringify({ slug: s.trim(), title: (t ?? "صفحهٔ تازه").trim(), starter: "landing" }),
    });
    if (r.ok && r.data) {
      setPages(await loadPages());
      setSlug(r.data.slug);
      await loadPage(r.data.slug);
      flash("صفحه ساخته شد و یک الگوی آماده برایش چیده شد");
    } else {
      flash(r.error?.message ?? "ساخت ناموفق", "err");
    }
  }, [call, loadPages, loadPage, flash]);

  /* ── عملیات بلوک ── */
  const insertBlock = useCallback(
    (type: CmsBlockType, at: number) => {
      const b = makeBlock(type);
      commit((prev) => {
        const next = [...prev];
        next.splice(Math.max(0, Math.min(at, next.length)), 0, b);
        return next;
      });
      setSelectedId(b.id);
    },
    [commit],
  );

  const moveBlock = useCallback(
    (id: string, to: number) => {
      commit((prev) => {
        const from = prev.findIndex((b) => b.id === id);
        if (from < 0) return prev;
        const next = [...prev];
        const [item] = next.splice(from, 1);
        next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
        return next;
      });
    },
    [commit],
  );

  const patchBlock = useCallback(
    (id: string, props: Record<string, unknown>) => {
      commit((prev) => prev.map((b) => (b.id === id ? { ...b, props: { ...b.props, ...props } } : b)));
    },
    [commit],
  );

  const removeBlock = useCallback(
    (id: string) => {
      commit((prev) => prev.filter((b) => b.id !== id));
      setSelectedId((cur) => (cur === id ? null : cur));
    },
    [commit],
  );

  const duplicateBlock = useCallback(
    (id: string) => {
      commit((prev) => {
        const i = prev.findIndex((b) => b.id === id);
        if (i < 0) return prev;
        const copy: CmsBlock = {
          ...prev[i],
          id: `${prev[i].id}_c${Math.random().toString(36).slice(2, 6)}`,
          props: JSON.parse(JSON.stringify(prev[i].props)) as Record<string, unknown>,
        };
        const next = [...prev];
        next.splice(i + 1, 0, copy);
        return next;
      });
    },
    [commit],
  );

  /* ── میان‌بر صفحه‌کلید ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (!typing && (e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        removeBlock(selectedId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, undo, redo, removeBlock, selectedId]);

  const selected = blocks.find((b) => b.id === selectedId) ?? null;
  const selectedDef = selected ? CMS_BLOCK_DEFS[selected.type] : null;

  const palette = useMemo(() => {
    const q = query.trim();
    return CMS_BLOCK_GROUPS.map((g) => ({
      ...g,
      items: Object.values(CMS_BLOCK_DEFS).filter(
        (d) => d.group === g.id && (q === "" || `${d.label} ${d.description}`.includes(q)),
      ),
    })).filter((g) => g.items.length > 0);
  }, [query]);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3111";
  const viewPath = slug === "home" ? "/" : `/${slug}`;
  const pageExists = pages.some((p) => p.slug === slug);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-app-bg" dir="rtl">
      {/* ───────── نوار بالا ───────── */}
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-app-line bg-app-surface px-3 py-2">
        <span className="text-[13px] font-black text-app-ink">صفحه‌ساز</span>

        <select
          value={slug}
          onChange={(e) => {
            const s = e.target.value;
            if (!s) return;
            setSlug(s);
            void loadPage(s);
          }}
          className="h-9 max-w-56 rounded-xl border border-app-line bg-app-bg px-2 text-[12px] text-app-ink"
        >
          {!pageExists && <option value={slug}>{slug}</option>}
          {pages.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.title} — {p.slug} ({p.blockCount})
            </option>
          ))}
        </select>

        <button
          onClick={() => void createPage()}
          className="h-9 rounded-xl border border-app-primary-soft px-3 text-[12px] font-bold text-app-primary-strong hover:bg-app-primary-tint"
          title="ساخت صفحهٔ تازه"
        >
          + صفحهٔ تازه
        </button>

        <span
          className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
            status === "PUBLISHED" ? "bg-app-primary-tint text-app-primary-strong" : "bg-app-bg text-app-muted"
          }`}
        >
          {status === "PUBLISHED" ? "منتشر شده" : "پیش‌نویس"}
        </span>
        {dirty && <span className="text-[10px] font-bold text-app-warning">ذخیره نشده</span>}

        <div className="ms-auto flex flex-wrap items-center gap-1.5">
          <div className="flex overflow-hidden rounded-xl border border-app-line">
            {(["mobile", "tablet", "desktop"] as Device[]).map((d) => (
              <button
                key={d}
                onClick={() => setDevice(d)}
                className={`px-2.5 py-1.5 text-[11px] font-bold ${
                  device === d ? "bg-app-primary text-app-on-accent" : "bg-app-surface text-app-muted"
                }`}
                title={`عرض ${DEVICE_WIDTH[d]}px`}
              >
                {d === "mobile" ? "موبایل" : d === "tablet" ? "تبلت" : "دسکتاپ"}
              </button>
            ))}
          </div>

          <button
            onClick={undo}
            disabled={past.current.length === 0}
            className="h-9 rounded-xl border border-app-line px-2.5 text-[12px] font-bold disabled:opacity-35"
            title="واگرد (Ctrl+Z)"
          >
            ↶
          </button>
          <button
            onClick={redo}
            disabled={future.current.length === 0}
            className="h-9 rounded-xl border border-app-line px-2.5 text-[12px] font-bold disabled:opacity-35"
            title="ازنو (Ctrl+Shift+Z)"
          >
            ↷
          </button>

          <a
            href={`${siteUrl}${viewPath}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-9 items-center rounded-xl border border-app-line px-3 text-[12px] font-bold text-app-primary-strong"
          >
            دیدن در سایت ↗
          </a>

          <button
            onClick={() => void save()}
            disabled={loading || loadingPage}
            className="h-9 rounded-xl border border-app-primary-soft px-3 text-[12px] font-bold text-app-primary-strong disabled:opacity-50"
            title="ذخیره (Ctrl+S)"
          >
            ذخیره
          </button>

          {status === "PUBLISHED" ? (
            <button
              onClick={() => void unpublish()}
              disabled={loading}
              className="h-9 rounded-xl border border-app-line px-3 text-[12px] font-bold text-app-muted disabled:opacity-50"
            >
              لغو انتشار
            </button>
          ) : (
            <button
              onClick={() => void publish()}
              disabled={loading || loadingPage}
              className="h-9 rounded-xl bg-app-primary px-4 text-[12px] font-bold text-app-on-accent disabled:opacity-50"
            >
              انتشار در سایت
            </button>
          )}
        </div>
      </header>

      {msg && (
        <div
          className={`shrink-0 px-4 py-2 text-[12px] font-bold ${
            msg.tone === "ok" ? "bg-app-primary-tint text-app-primary-strong" : "bg-app-bg text-app-error"
          }`}
          role="status"
        >
          {msg.text}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ───────── پالت ───────── */}
        <aside className="flex w-60 shrink-0 flex-col border-e border-app-line bg-app-surface">
          <div className="shrink-0 border-b border-app-line p-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="جست‌وجوی بلوک…"
              className="w-full rounded-xl border border-app-line bg-app-bg px-3 py-2 text-[12px] text-app-ink outline-none focus:border-app-primary-soft"
            />
            <p className="mt-2 text-[10px] leading-5 text-app-muted">
              بلوک را بکش و روی بوم رها کن — یا رویش بزن تا به انتها اضافه شود.
            </p>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
            {palette.map((g) => (
              <div key={g.id}>
                <p className="mb-1.5 text-[10px] font-black text-app-muted">{g.label}</p>
                <div className="space-y-1.5">
                  {g.items.map((d) => (
                    <div
                      key={d.type}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DND_NEW, d.type);
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      onClick={() => insertBlock(d.type, blocks.length)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          insertBlock(d.type, blocks.length);
                        }
                      }}
                      title={d.description}
                      className="flex cursor-grab items-center gap-2 rounded-xl border border-app-line bg-app-bg px-2.5 py-2 transition-colors hover:border-app-primary-soft hover:bg-app-primary-tint active:cursor-grabbing"
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-app-primary-tint text-[13px] text-app-primary-strong">
                        {d.glyph}
                      </span>
                      <span className="truncate text-[12px] font-bold text-app-ink">{d.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {palette.length === 0 && (
              <p className="py-6 text-center text-[12px] text-app-muted">بلوکی با این نام پیدا نشد.</p>
            )}
          </div>
        </aside>

        {/* ───────── بوم ───────── */}
        <main
          className="min-w-0 flex-1 overflow-y-auto bg-app-bg p-4"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(DND_NEW) || e.dataTransfer.types.includes(DND_MOVE)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = e.dataTransfer.types.includes(DND_NEW) ? "copy" : "move";
            }
          }}
          onDrop={(e) => {
            const newType = e.dataTransfer.getData(DND_NEW) as CmsBlockType;
            const moveId = e.dataTransfer.getData(DND_MOVE);
            if (newType && newType in CMS_BLOCK_DEFS) {
              e.preventDefault();
              insertBlock(newType, dropIndex(e.clientY));
            } else if (moveId) {
              e.preventDefault();
              moveBlock(moveId, dropIndex(e.clientY));
            }
          }}
        >
          {/* جایگاه رهاسازی — مرجع محاسبهٔ اندیس درج */}
          <div data-drop-index="0" className="mx-auto mb-3 h-1.5 rounded-full bg-app-line/40" style={{ width: DEVICE_WIDTH[device], maxWidth: "100%" }} />

          <div
            className="mx-auto rounded-2xl border border-app-line bg-app-surface p-3"
            style={{ width: DEVICE_WIDTH[device], maxWidth: "100%" }}
          >
            <label className="block text-[10px] font-bold text-app-muted">عنوان صفحه</label>
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
              }}
              placeholder="عنوان صفحه"
              className="mt-1 w-full rounded-xl border border-app-line bg-app-bg px-3 py-2 text-[13px] font-bold text-app-ink outline-none focus:border-app-primary-soft"
            />
          </div>

          {blocks.length === 0 ? (
            <div
              className="mx-auto mt-3 rounded-2xl border-2 border-dashed border-app-line bg-app-surface/50 p-10 text-center"
              style={{ width: DEVICE_WIDTH[device], maxWidth: "100%" }}
            >
              <p className="text-[13px] font-bold text-app-ink">این صفحه هنوز بلوکی ندارد</p>
              <p className="mx-auto mt-1 max-w-sm text-[12px] leading-6 text-app-muted">
                از ستون راست یک بلوک را بکش و اینجا رها کن، یا روی آن بزن.
              </p>
            </div>
          ) : (
            <div className="mx-auto" style={{ width: DEVICE_WIDTH[device], maxWidth: "100%" }}>
              {blocks.map((b, i) => (
                <div key={b.id}>
                  <BlockCard
                    block={b}
                    index={i}
                    total={blocks.length}
                    selected={selectedId === b.id}
                    data={data}
                    onSelect={() => setSelectedId(b.id)}
                    onRemove={() => removeBlock(b.id)}
                    onDuplicate={() => duplicateBlock(b.id)}
                    onToggleHidden={() =>
                      commit((prev) => prev.map((x) => (x.id === b.id ? { ...x, hidden: !x.hidden } : x)))
                    }
                    onMove={(dir) => moveBlock(b.id, i + dir)}
                  />
                  <div
                    data-drop-index={i + 1}
                    className="h-2 rounded-full bg-transparent transition-colors hover:bg-app-primary-soft"
                  />
                </div>
              ))}
            </div>
          )}

          {data.products.length === 0 && (
            <p className="mx-auto mt-4 max-w-lg rounded-xl border border-app-line bg-app-surface p-3 text-center text-[11px] text-app-muted">
              دادهٔ کاتالوگ در دسترس نیست؛ بلوک‌های فروشگاهی خالی نمایش داده می‌شوند. اگر API بالاست صفحه را تازه کن.
            </p>
          )}
        </main>

        {/* ───────── تنظیمات ───────── */}
        <aside className="w-80 shrink-0 overflow-y-auto border-s border-app-line bg-app-surface">
          {selected && selectedDef ? (
            <div className="p-4">
              <div className="mb-4 flex items-start justify-between gap-2 border-b border-app-line pb-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-[13px] font-black text-app-ink">
                    <span className="text-app-primary-strong">{selectedDef.glyph}</span>
                    {selectedDef.label}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-5 text-app-muted">{selectedDef.description}</p>
                </div>
                <button
                  onClick={() => setSelectedId(null)}
                  className="shrink-0 rounded-lg border border-app-line px-2 py-1 text-[11px] text-app-muted"
                >
                  بستن
                </button>
              </div>

              <FieldEditor
                fields={selectedDef.fields}
                props={selected.props}
                blockType={selected.type}
                onChange={(k, v) => patchBlock(selected.id, { [k]: v })}
              />
            </div>
          ) : (
            <div className="p-4">
              <p className="text-[13px] font-black text-app-ink">تنظیمات صفحه</p>
              <p className="mt-1 text-[11px] leading-6 text-app-muted">
                روی هر بلوک در بوم بزن تا تنظیمات همان بلوک اینجا باز شود.
              </p>

              <div className="mt-4 space-y-4 border-t border-app-line pt-4">
                <div>
                  <label className="block text-[11px] font-bold text-app-muted">عنوان سئو</label>
                  <input
                    value={seoTitle}
                    onChange={(e) => {
                      setSeoTitle(e.target.value);
                      setDirty(true);
                    }}
                    placeholder={title || "عنوان صفحه"}
                    className="mt-1 w-full rounded-xl border border-app-line bg-app-bg px-3 py-2 text-[13px] text-app-ink outline-none focus:border-app-primary-soft"
                  />
                  <p className="mt-1 text-[10px] text-app-muted">اگر خالی بماند، عنوان بالا استفاده می‌شود.</p>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-app-muted">توضیح سئو</label>
                  <textarea
                    rows={3}
                    value={seoDesc}
                    onChange={(e) => {
                      setSeoDesc(e.target.value);
                      setDirty(true);
                    }}
                    placeholder="خلاصه‌ای که در نتایج جست‌وجو نمایش داده می‌شود"
                    className="mt-1 w-full rounded-xl border border-app-line bg-app-bg px-3 py-2 text-[13px] text-app-ink outline-none focus:border-app-primary-soft"
                  />
                </div>

                <div className="rounded-xl border border-app-line bg-app-bg p-3">
                  <p className="text-[11px] font-bold text-app-ink">صفحات پیشنهادی</p>
                  <ul className="mt-2 space-y-1">
                    {CMS_SUGGESTED_PAGES.map((p) => (
                      <li key={p.slug}>
                        <button
                          onClick={() => {
                            setSlug(p.slug);
                            void loadPage(p.slug);
                          }}
                          className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-start text-[11px] ${
                            slug === p.slug
                              ? "bg-app-primary-tint font-bold text-app-primary-strong"
                              : "text-app-muted hover:bg-app-surface"
                          }`}
                        >
                          <span className="truncate">{p.title}</span>
                          <span dir="ltr" className="shrink-0 text-[10px] opacity-70">
                            {p.route}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[10px] leading-5 text-app-muted">
                    صفحه‌ای که اینجا انتخاب کنی اگر ساخته نشده باشد، با «+ صفحهٔ تازه» بساز.
                  </p>
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

/** کارت یک بلوک در بوم: پیش‌نمایش واقعی + لایهٔ تعامل */
function BlockCard({
  block,
  index,
  total,
  selected,
  data,
  onSelect,
  onRemove,
  onDuplicate,
  onToggleHidden,
  onMove,
}: {
  block: CmsBlock;
  index: number;
  total: number;
  selected: boolean;
  data: CmsData;
  onSelect: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onToggleHidden: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const def = CMS_BLOCK_DEFS[block.type];

  return (
    <div
      className={`group relative mt-2 rounded-2xl border-2 transition-colors ${
        selected ? "border-app-primary" : "border-transparent hover:border-app-primary-soft"
      } ${block.hidden ? "opacity-45" : ""}`}
      onClick={onSelect}
    >
      {/* پیش‌نمایش واقعی — دقیقاً همان رندرِ سایت */}
      <div className="pointer-events-none select-none overflow-hidden rounded-2xl" aria-hidden>
        <CmsBlockView block={block} data={data} />
      </div>

      {/* لایهٔ تعامل */}
      <div
        className="absolute inset-0 cursor-pointer rounded-2xl"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DND_MOVE, block.id);
          e.dataTransfer.effectAllowed = "move";
        }}
      />

      {/* برچسب و ابزارها */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start gap-2 p-2">
        <span className="pointer-events-auto inline-flex items-center gap-1.5 rounded-lg bg-app-ink/90 px-2 py-1 text-[10px] font-bold text-app-on-accent shadow-app-shadow-1">
          <span aria-hidden>⠿</span>
          {def.label}
          <span className="opacity-60">#{index + 1}</span>
        </span>

        <div className="pointer-events-auto ms-auto flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <CardBtn onClick={() => onMove(-1)} disabled={index === 0} title="بالا">↑</CardBtn>
          <CardBtn onClick={() => onMove(1)} disabled={index === total - 1} title="پایین">↓</CardBtn>
          <CardBtn onClick={onDuplicate} title="تکثیر">⧉</CardBtn>
          <CardBtn onClick={onToggleHidden} title={block.hidden ? "نمایش در سایت" : "پنهان کردن از سایت"}>
            {block.hidden ? "◌" : "◍"}
          </CardBtn>
          <CardBtn onClick={onRemove} title="حذف (Delete)" danger>✕</CardBtn>
        </div>
      </div>

      {block.hidden && (
        <span className="absolute bottom-2 end-2 rounded-lg bg-app-ink/90 px-2 py-1 text-[10px] font-bold text-app-on-accent">
          پنهان
        </span>
      )}
    </div>
  );
}

function CardBtn({
  children,
  onClick,
  disabled,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      title={title}
      className={`flex size-7 items-center justify-center rounded-lg border border-app-line bg-app-surface text-[12px] text-app-ink shadow-app-shadow-1 disabled:opacity-30 ${
        danger ? "text-app-error" : ""
      }`}
    >
      {children}
    </button>
  );
}

/**
 * از روی موقعیت موس، اندیس رهاسازی را حساب می‌کند.
 * چون بوم اسکرول می‌شود، از مختصات viewport و `getBoundingClientRect`
 * استفاده می‌شود نه از offsetTop.
 */
function dropIndex(clientY: number): number {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-drop-index]"));
  for (const node of nodes) {
    const r = node.getBoundingClientRect();
    if (clientY < r.top + r.height / 2) return Number(node.dataset.dropIndex ?? 0);
  }
  return nodes.length;
}