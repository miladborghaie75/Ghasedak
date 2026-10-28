"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CMS_BLOCK_DEFS,
  CMS_BLOCK_GROUPS,
  makeBlock,
  type CmsBlock,
  type CmsBlockType,
  type CmsPageData,
} from "@ghasedak/blocks";
import { useAdminApi } from "@/components/useAdminApi";
import { editBodyLine } from "@/lib/content-sections";
import { moveItem } from "@/lib/reorder";
import { CONTENT_PAGE_NAV, type ContentNavRow } from "@ghasedak/contracts";
import FieldEditor from "./FieldEditor";

/**
 * صفحه‌ساز زنده — بوم، خودِ صفحهٔ واقعی سایت است.
 *
 * تفاوت بنیادی با نسخهٔ قبل: بوم دیگر «فهرستی از پیش‌نمایش بلوک‌ها» نیست،
 * بلکه **همان صفحهٔ سایت** داخل یک iframe است (با `?cmsPreview=1`).
 * یعنی:
 *  ۱) هر چیزی که مدیر می‌چیند، در همان بوم زنده دیده می‌شود — با هدر و
 *     فوتر و دادهٔ واقعی کاتالوگ؛
 *  ۲) متن‌ها را می‌شود **درجا روی خود صفحه** ویرایش کرد (کلیک روی متن →
 *     فیلد در پنل تنظیمات باز می‌شود و تایپ در خود صفحه، زنده ثبت می‌شود)؛
 *  ۳) کلیک روی هر بخش، همان بلوک را در پنل تنظیمات انتخاب می‌کند.
 *
 * پل ارتباطی `postMessage` است (پیام‌های `cms:*`).
 */

type Device = "mobile" | "tablet" | "desktop";
const DEVICE_WIDTH: Record<Device, number> = { mobile: 390, tablet: 768, desktop: 1280 };

/** یک ردیف از «صفحات سایت» که API برمی‌گرداند */
interface SitePageRow {
  path: string;
  slug: string | null;
  title: string;
  kind: string;
  editable: boolean;
  note?: string;
  cms: {
    status: "DRAFT" | "PUBLISHED";
    blockCount: number;
    updatedAt: string;
    publishedAt: string | null;
    /** پیش‌نویس با نسخهٔ منتشرشده فرق دارد → هنوز منتشر نشده */
    hasUnpublishedChanges: boolean;
    /** صفحهٔ محتوایی با مدل قدیمی (هیرو + متن) — نیاز به بازسازی دارد */
    legacyModel?: boolean;
  } | null;
}

type PanelIncoming =
  | { type: "cms:ready" }
  | { type: "cms:block-select"; id: string; field?: string }
  | { type: "cms:block-hover"; id: string | null }
  | { type: "cms:field-input"; blockId: string; key: string; value: string }
  /** ویرایشِ درجای یک خط از «صفحهٔ محتوایی» — فقط متنِ خالصِ همان خط */
  | { type: "cms:line-input"; blockId: string; sectionIndex: number; lineIndex: number; text: string };

type RightTab = "structure" | "blocks" | "pages";

/**
 * در پنجره‌های باریک، سه ستون جا نمی‌شوند: دو پنل ۲۵۶ + ۳۲۰ پیکسل‌اند و
 * ۵۷۶ پیکسل از عرض را می‌گیرند — یعنی یک پنجرهٔ ۵۷۶ پیکسلی بومِ صفر
 * دارد. پس زیرِ `lg` فقط یک پنل نشان داده می‌شود و این نوع می‌گوید کدام؛
 * `lg` همان نقطه‌ای است که پنلِ مدیریت هم چیدمانِ جمع‌وجورش را عوض می‌کند
 * و آن‌جا بوم حداقل ~۴۴۸ پیکسل جا می‌گیرد.
 */
type MobilePane = "canvas" | "blocks" | "settings";

/** صفحهٔ خالی — برای مسیری که هنوز در صفحه‌ساز ساخته نشده */
const EMPTY_PAGE: CmsPageData = { version: 1, title: "", blocks: [] };

export default function BuilderClient({ initialSlug }: { initialSlug?: string }) {
  const { call, loading } = useAdminApi();

  const [sitePages, setSitePages] = useState<SitePageRow[]>([]);
  const [slug, setSlug] = useState<string>(initialSlug ?? "home");
  const [status, setStatus] = useState<"DRAFT" | "PUBLISHED">("DRAFT");
  /** پیش‌نویس ذخیره‌شده با نسخهٔ منتشرشده فرق دارد (سایت هنوز نسخهٔ قبلی را نشان می‌دهد) */
  const [pendingChanges, setPendingChanges] = useState(false);
  const [title, setTitle] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDesc, setSeoDesc] = useState("");
  const [blocks, setBlocks] = useState<CmsBlock[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightField, setHighlightField] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>("desktop");
  const [query, setQuery] = useState("");
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loadingPage, setLoadingPage] = useState(false);
  const [tab, setTab] = useState<RightTab>("structure");
  /** پنلِ فعال در چیدمانِ تک‌پنلی — از `lg` به بالا بی‌اثر است */
  const [mobilePane, setMobilePane] = useState<MobilePane>("canvas");
  const [revisions, setRevisions] = useState<Array<{ id: string; createdAt: string; actorId: string | null }>>([]);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  /**
   * ناوبریِ صفحه‌های محتوایی — **سراسری** است: همان فهرست در نوارِ زیرِ تیترِ هر
   * صفحهٔ محتوایی در سایت و در بوم دیده می‌شود. پس ذخیره‌اش ربطی به پیش‌نویسِ
   * صفحهٔ باز ندارد؛ به‌محض ذخیره، سایت (ظرف TTL کوتاه) و بوم (همان لحظه) عوض می‌شوند.
   */
  const [navItems, setNavItems] = useState<ContentNavRow[]>([]);
  const [navDirty, setNavDirty] = useState(false);
  const [navSaving, setNavSaving] = useState(false);
  const [frame, setFrame] = useState({ w: 1280, h: 800, scale: 1 });
  /**
   * وضعیت بوم: «در حال بالا آمدن» تا وقتی فروشگاه پیام «آماده» را نفرستاد،
   * «زنده» بعد از آن، و «stalled» اگر فروشگاه اصلاً بالا نیامد.
   */
  const [frameStatus, setFrameStatus] = useState<"waiting" | "ready" | "stalled">("waiting");
  /**
   * شمارهٔ بارگذاریِ دوبارهٔ سندِ بوم — وقتی ناوبریِ چیدمانِ ایستای مسیر عوض
   * می‌شود (پیام نمی‌گیرد، سمت سرور رندر شده) باید سند از نو خوانده شود.
   */
  const [frameEpoch, setFrameEpoch] = useState(0);

  const frameRef = useRef<HTMLIFrameElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const blocksRef = useRef<CmsBlock[]>([]);
  blocksRef.current = blocks;
  /** شمارهٔ ترتیبِ درخواستِ خواندنِ صفحه — پاسخِ کهنه نادیده گرفته شود */
  const loadSeq = useRef(0);
  /** مسیری که محتوای روی بوم مالِ آن است — تا محتوای مسیرِ قبلی روی مسیرِ تازه نیفتد */
  const loadedSlugRef = useRef<string | null>(null);
  const slugRef = useRef(slug);
  slugRef.current = slug;

  /* ── تاریخچه: undo/redo ── */
  const past = useRef<CmsBlock[][]>([]);
  const future = useRef<CmsBlock[][]>([]);
  const [, bumpHistory] = useState(0);
  /** پایهٔ ویرایش درجا — برای اینکه undo یک‌باره کل ویرایش متن برگرداند */
  const inlineBase = useRef<{ key: string; blocks: CmsBlock[] } | null>(null);

  /* ── دستگاهِ پیش‌نمایشِ پیش‌فرض ──
     در چیدمانِ تک‌پنلیِ زیر `lg` بوم تمام‌عرض است، اما قابِ ۱۲۸۰ پیکسلی
     آن‌قدر کوچک می‌شود که متن‌ها خوانا نیستند. پس همان‌جا از «موبایل»
     شروع می‌کنیم؛ سه دکمهٔ دستگاه سر جایشان می‌مانند و انتخابِ بعدیِ مدیر
     مقدم است. فقط یک‌بار در mount اجرا می‌شود — تغییرِ بعدیِ عرض، انتخابِ
     فعلی را عوض نمی‌کند. */
  useEffect(() => {
    if (window.matchMedia("(max-width: 1023.98px)").matches) setDevice("mobile");
  }, []);

  const payload = useCallback(
    (): CmsPageData => ({
      version: 1,
      title: title || "بدون عنوان",
      seo: { title: seoTitle || undefined, description: seoDesc || undefined },
      blocks,
    }),
    [title, seoTitle, seoDesc, blocks],
  );

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3111";
  const siteOrigin = useMemo(() => {
    try {
      return new URL(siteUrl).origin;
    } catch {
      return "*";
    }
  }, [siteUrl]);
  const viewPath = slug === "home" ? "/" : `/${slug}`;

  /* ── پل ارتباطی با بوم ── */
  const payloadRef = useRef<CmsPageData>({ version: 1, title: "", blocks: [] });
  payloadRef.current = payload();

  /**
   * فرستادنِ صفحه به بوم.
   *
   * `page` را می‌شود صریح داد: بعد از «خواندنِ صفحه از API» باید **همان**
   * صفحه‌ای که خواندیم به بوم برسد، نه این‌که به امیدِ به‌روز شدنِ یک ref
   * صبر کنیم. وگرنه بوم، چند ثانیه، چیدمانِ پیش‌فرضِ مسیر را نشان می‌دهد
   * (چون سندِ iframe از قبل رندر شده) و مدیر فکر می‌کند «ساخت صفحه» کار
   * نکرده.
   */
  const pushPage = useCallback(
    (page?: CmsPageData) => {
      const win = frameRef.current?.contentWindow;
      if (!win) return;
      // اگر صفحه‌ای که روی بوم است مالِ مسیرِ فعلی نیست، اصلاً نفرست:
      // وگرنه لحظه‌ای محتوای صفحهٔ قبلی روی مسیرِ جدید دیده می‌شود.
      if (!page && loadedSlugRef.current !== slugRef.current) return;
      try {
        win.postMessage({ type: "cms:set-page", page: page ?? payloadRef.current }, siteOrigin);
      } catch {
        // اگر هنوز بارگذاری نشده، پیام بعداً می‌رود
      }
    },
    [siteOrigin],
  );

  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedulePush = useCallback(
    (delay = 180, page?: CmsPageData) => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
      pushTimer.current = setTimeout(() => {
        pushTimer.current = null;
        pushPage(page);
      }, delay);
    },
    [pushPage],
  );

  const flash = useCallback((text: string, tone: "ok" | "err" = "ok") => {
    setMsg({ text, tone });
    setTimeout(() => setMsg(null), 3600);
  }, []);

  const commit = useCallback(
    (next: CmsBlock[] | ((prev: CmsBlock[]) => CmsBlock[])) => {
      // snapshot هم بیرون از updater — همان دلیلِ undo (StrictMode)
      const prev = blocksRef.current;
      const value = typeof next === "function" ? next(prev) : next;
      past.current = [...past.current.slice(-49), prev];
      future.current = [];
      bumpHistory((n) => n + 1);
      // صریح به‌روز می‌شود تا دو commitِ پشتِ‌سرهم در یک tick snapshotِ کهنه نگیرند
      blocksRef.current = value;
      setBlocks(value);
      inlineBase.current = null;
      setDirty(true);
      schedulePush();
    },
    [schedulePush],
  );

  /**
   * واگرد/ازنو — پشته‌ها **بیرون** از updater عوض می‌شوند.
   *
   * چرا؟ React در حالت StrictMode تابع updater را دوبار صدا می‌زند تا
   * ناخالصی را بگیرد؛ pop/push داخل آن یعنی یک واگرد، دو تاریخچه را
   * می‌خورد و عملاً هیچ برنمی‌گردد. `blocksRef` آخرین حالتِ کامیت‌شده است
   * و همین برای فرستادن به پشتهٔ مقابل کافی است.
   */
  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current = [...future.current, blocksRef.current];
    bumpHistory((n) => n + 1);
    blocksRef.current = prev;
    setBlocks(prev);
    inlineBase.current = null;
    setDirty(true);
    schedulePush();
  }, [schedulePush]);

  const redo = useCallback(() => {
    const nxt = future.current.pop();
    if (!nxt) return;
    past.current = [...past.current, blocksRef.current];
    bumpHistory((n) => n + 1);
    blocksRef.current = nxt;
    setBlocks(nxt);
    inlineBase.current = null;
    setDirty(true);
    schedulePush();
  }, [schedulePush]);

  /* ── بارگذاری فهرست مسیرهای سایت و صفحه ── */
  const loadSitePages = useCallback(async () => {
    const r = await call<{ items: SitePageRow[] }>("/admin/pages/site");
    if (r.ok && r.data) setSitePages(r.data.items);
    return r.ok && r.data ? r.data.items : [];
  }, [call]);

  const loadPage = useCallback(
    async (s: string, knownMissing?: boolean) => {
      // شمارهٔ درخواست — تا پاسخِ کهنه (مثلاً وقتی مدیر سریع بین مسیرها
      // می‌پرد) بلوک‌های صفحهٔ قبلی را روی صفحهٔ جدید ننویسد.
      const seq = ++loadSeq.current;
      setLoadingPage(true);
      loadedSlugRef.current = null;
      // صفحه هنوز ساخته نشده (در فهرست سایت `cms: null` است) — همان حالت خالی
      // را بگذار **بدون** درخواست بی‌نتیجه؛ وگرنه هر بازکردن بوم روی دیتابیس تازه
      // یک ۴۰۴ِ قابل‌انتظار به کنسول می‌دهد (API درست «صفحه نیست» را ۴۰۴ می‌کند).
      if (knownMissing) {
        setBlocks([]);
        setStatus("DRAFT");
        setPendingChanges(false);
        setTitle("");
        setSeoTitle("");
        setSeoDesc("");
        setSelectedId(null);
        schedulePush(0, EMPTY_PAGE);
        loadedSlugRef.current = s;
        setLoadingPage(false);
        return false;
      }
      const r = await call<{
        slug: string;
        status: string;
        data: CmsPageData;
        hasUnpublishedChanges?: boolean;
      }>(`/admin/pages/${s}`);
      if (seq !== loadSeq.current) return false; // پاسخِ کهنه — نادیده
      setLoadingPage(false);
      loadedSlugRef.current = s;
      if (!r.ok || !r.data) {
        setBlocks([]);
        setStatus("DRAFT");
        setPendingChanges(false);
        setTitle("");
        setSeoTitle("");
        setSeoDesc("");
        setSelectedId(null);
        // صفحه‌ای در صفحه‌ساز نیست → بوم باید همان چیدمانِ واقعیِ مسیر را
        // نشان بدهد (بوم خالی = مدیر نمی‌فهمد صفحه چه شکلی است).
        schedulePush(0, EMPTY_PAGE);
        return false;
      }
      const data = r.data.data;
      setBlocks(data.blocks);
      setStatus(r.data.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT");
      setPendingChanges(Boolean(r.data.hasUnpublishedChanges));
      setTitle(data.title);
      setSeoTitle(data.seo?.title ?? "");
      setSeoDesc(data.seo?.description ?? "");
      setSelectedId(null);
      setHighlightField(null);
      past.current = [];
      future.current = [];
      inlineBase.current = null;
      setDirty(false);
      // بوم باید همین حالا همین صفحه را نشان بدهد — نه چیدمانِ پیش‌فرضِ
      // مسیر را. بدون این، «ساخت صفحه از محتوای فعلی» از نظرِ بوم بی‌اثر
      // به نظر می‌رسد.
      schedulePush(
        0,
        {
          version: 1,
          title: data.title || "بدون عنوان",
          seo: { title: data.seo?.title ?? undefined, description: data.seo?.description ?? undefined },
          blocks: data.blocks,
        },
      );
      return true;
    },
    [call, schedulePush],
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      const items = await loadSitePages();
      if (!alive) return;
      const target =
        initialSlug ??
        items.find((p) => p.slug && p.cms)?.slug ??
        items.find((p) => p.slug)?.slug ??
        "home";
      setSlug(target);
      // فقط وقتی از فهرستِ سایت می‌دانیم صفحه هنوز ساخته نشده، از درخواستِ ۴۰۴ بپر
      const row = items.find((p) => p.slug === target);
      await loadPage(target, Boolean(row && !row.cms));
    })();
    return () => {
      alive = false;
    };
  }, [loadSitePages, loadPage, initialSlug]);

  /* ── پیام‌های بوم ── */
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== siteOrigin) return;
      if (e.source !== frameRef.current?.contentWindow) return;
      const m = e.data as PanelIncoming | undefined;
      if (!m || typeof m !== "object") return;

      if (m.type === "cms:ready") {
        // فروشگاه بالا است و سطح پیش‌نمایش mount شده — بوم زنده است
        setFrameStatus("ready");
        pushPage();
        return;
      }
      if (m.type === "cms:block-select") {
        // عمداً پنلِ موبایل را عوض نمی‌کنیم: کلیک روی متن در بوم، ویرایشِ
        // درجا را شروع می‌کند؛ پریدن به «تنظیمات» همان لحظه بوم را پنهان
        // می‌کرد و تایپ در صفحه قطع می‌شد.
        setSelectedId(m.id || null);
        setHighlightField(m.field ?? null);
        return;
      }
      if (m.type === "cms:block-hover") {
        return;
      }
      if (m.type === "cms:line-input") {
        // ویرایش درجای یک خط از بخش‌های صفحهٔ محتوایی. نشانه‌ها (پیوند/برجسته)
        // در پنل و با موقعیتشان نگه داشته می‌شوند؛ بوم فقط متنِ خالص را می‌فرستد.
        const si = Number(m.sectionIndex);
        const li = Number(m.lineIndex);
        if (!Number.isInteger(si) || si < 0 || !Number.isInteger(li) || li < 0) return;
        const fk = `${m.blockId}:line:${si}:${li}`;
        if (!inlineBase.current || inlineBase.current.key !== fk) {
          inlineBase.current = { key: fk, blocks: blocksRef.current };
          past.current = [...past.current.slice(-49), blocksRef.current];
          future.current = [];
          bumpHistory((n) => n + 1);
        }
        setSelectedId(m.blockId);
        setBlocks((prev) =>
          prev.map((b) =>
            b.id === m.blockId
              ? {
                  ...b,
                  props: { ...b.props, sections: editBodyLine(b.props.sections, si, li, m.text) },
                }
              : b,
          ),
        );
        setDirty(true);
        schedulePush(600);
        return;
      }
      if (m.type === "cms:field-input") {
        // ویرایش درجا روی خود صفحه — همان‌طور که تایپ می‌شود ثبت می‌شود
        const fk = `${m.blockId}:${m.key}`;
        if (!inlineBase.current || inlineBase.current.key !== fk) {
          inlineBase.current = { key: fk, blocks: blocksRef.current };
          past.current = [...past.current.slice(-49), blocksRef.current];
          future.current = [];
          bumpHistory((n) => n + 1);
        }
        setSelectedId(m.blockId);
        setBlocks((prev) =>
          prev.map((b) =>
            b.id === m.blockId ? { ...b, props: { ...b.props, [m.key]: m.value } } : b,
          ),
        );
        setDirty(true);
        schedulePush(600);
        return;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [siteOrigin, pushPage, schedulePush]);

  /* ── بوم: اگر فروشگاه بالا نیامد، بعد از ۸ ثانیه پیام روشن بده ──
     چرا لازم است؟ بوم روی یک iframe است؛ اگر فروشگاه خاموش باشد، مرورگر
     فقط یک صفحهٔ خطای خاکستری نشان می‌دهد و مدیر نمی‌فهمد مشکل از کجاست.
     پس به‌جای جعبهٔ سفیدِ بی‌پیام، علت را می‌گوییم و راه‌حل را هم. */
  useEffect(() => {
    setFrameStatus("waiting");
    const t = setTimeout(() => {
      setFrameStatus((s) => (s === "ready" ? s : "stalled"));
    }, 8000);
    return () => clearTimeout(t);
  }, [viewPath, frameEpoch]);

  /* ── اندازهٔ بوم ── */
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const measure = () => {
      // بوم در چیدمانِ تک‌پنلی با CSS پنهان می‌شود؛ اندازه‌گیریِ ۰ پیکسل
      // مقیاس را خراب می‌کرد و بازگشت به بوم یک لحظه ریز و پریده دیده می‌شد.
      if (el.clientWidth === 0) return;
      const availW = Math.max(240, el.clientWidth - 32);
      const availH = Math.max(320, el.clientHeight - 32);
      const scale = Math.min(1, availW / DEVICE_WIDTH[device]);
      const h = Math.min(1100, Math.max(560, Math.round(availH / scale)));
      setFrame({ w: DEVICE_WIDTH[device], h, scale });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [device]);

  /* ── ذخیره / انتشار ── */

  /** تازه‌سازی وضعیت «تغییرات منتشرنشده» بدون دست‌زدن به بوم و تاریخچهٔ واگرد */
  const refreshPending = useCallback(async () => {
    const r = await call<{ hasUnpublishedChanges?: boolean }>(`/admin/pages/${slug}`);
    if (r.ok && r.data) setPendingChanges(Boolean(r.data.hasUnpublishedChanges));
  }, [call, slug]);

  const save = useCallback(async () => {
    const r = await call(`/admin/pages/${slug}`, {
      method: "PUT",
      body: JSON.stringify({ payload: payload() }),
    });
    if (r.ok) {
      setDirty(false);
      // صفحهٔ منتشرشده: ذخیره فقط پیش‌نویس را عوض می‌کند، سایت دست‌نخورده می‌ماند
      void refreshPending();
      flash(
        status === "PUBLISHED"
          ? "پیش‌نویس ذخیره شد — برای دیدن روی سایت، «انتشار در سایت» را بزن"
          : "پیش‌نویس ذخیره شد",
      );
      void loadSitePages();
    } else {
      flash(r.error?.message ?? "ذخیره ناموفق", "err");
    }
  }, [call, slug, payload, loadSitePages, flash, refreshPending, status]);

  const publish = useCallback(async () => {
    if (blocks.length === 0) {
      flash("صفحهٔ خالی منتشر نمی‌شود — اول یک بلوک اضافه کن", "err");
      return;
    }
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
      setPendingChanges(false);
      flash("منتشر شد — همین حالا در سایت دیده می‌شود");
      void loadSitePages();
    } else {
      flash(p.error?.message ?? "انتشار ناموفق", "err");
    }
  }, [call, slug, payload, loadSitePages, flash]);

  const unpublish = useCallback(async () => {
    const p = await call(`/admin/pages/${slug}/unpublish`, { method: "POST" });
    if (p.ok) {
      setStatus("DRAFT");
      setPendingChanges(false);
      flash("از انتشار خارج شد — سایت به چیدمان پیش‌فرض برگشت");
      void loadSitePages();
    } else {
      flash(p.error?.message ?? "لغو انتشار ناموفق", "err");
    }
  }, [call, slug, loadSitePages, flash]);

  const createPage = useCallback(
    async (
      targetSlug: string,
      targetTitle: string,
      starter: "empty" | "landing" | "simple" | "site",
    ) => {
      const r = await call<{ slug: string }>("/admin/pages", {
        method: "POST",
        body: JSON.stringify({ slug: targetSlug, title: targetTitle, starter }),
      });
      if (r.ok && r.data) {
        setSlug(r.data.slug);
        await loadPage(r.data.slug);
        void loadSitePages();
        flash("صفحه ساخته شد");
        return true;
      }
      flash(r.error?.message ?? "ساخت ناموفق", "err");
      return false;
    },
    [call, loadPage, loadSitePages, flash],
  );

  /**
   * بازسازی صفحهٔ محتواییِ قدیمی از متنِ مشترک سایت.
   *
   * صفحه‌هایی که پیش از بلوک «صفحهٔ محتوایی» ساخته شده‌اند (هیرو + متن‌های
   * پراکنده) با چیدمان واقعی سایت نمی‌خوانند. این دکمه همان صفحه را از همان
   * متنی که سایت رندر می‌کند دوباره می‌سازد؛ payload قبلی در «نسخه‌های قبلی»
   * می‌ماند و تا وقتی مدیر «انتشار» نزند، سایت دست‌نخورده است.
   */
  const rebuildFromSite = useCallback(async () => {
    const r = await call<{ slug: string; data: CmsPageData }>(`/admin/pages/${slug}/rebuild-from-site`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    if (r.ok && r.data) {
      await loadPage(slug);
      void loadSitePages();
      flash("صفحه از محتوای فعلی سایت بازسازی شد — برای اعمال روی سایت «انتشار» بزن");
    } else {
      flash(r.error?.message ?? "بازسازی ناموفق", "err");
    }
  }, [call, slug, loadPage, loadSitePages, flash]);

  /* ── ناوبریِ صفحه‌های محتوایی ── */

  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await call<{ items: ContentNavRow[] }>("/admin/pages/content-nav");
      if (!alive) return;
      setNavItems(
        r.ok && r.data?.items?.length
          ? r.data.items
          : // خواندن نشد → با پیش‌فرضِ قرارداد ویرایش را شروع کن؛ ذخیره همان موقع تنظیم را می‌سازد
            CONTENT_PAGE_NAV.map((n) => ({ ...n, visible: true })),
      );
    })();
    return () => {
      alive = false;
    };
  }, [call]);

  /** جابه‌جاییِ یک گزینه در ناوبری — همان مغزِ `moveItem` که بقیهٔ پنل هم استفاده می‌کند */
  const moveNav = (from: number, to: number) => {
    setNavItems((prev) => moveItem(prev, from, to));
    setNavDirty(true);
  };

  /** پنهان/نمایان کردن یک گزینه — «حذف» یعنی همین: صفحه هست، فقط از نوار پیوندش نیست */
  const toggleNav = (index: number) => {
    setNavItems((prev) => prev.map((row, i) => (i === index ? { ...row, visible: !row.visible } : row)));
    setNavDirty(true);
  };

  /**
   * اعمالِ ناوبریِ تازه روی بوم، بی‌آنکه ویرایشِ ذخیره‌نشدهٔ روی صفحه پاک شود.
   * دو حالت: بلوک دارد → پیامِ `cms:set-nav` همان لحظه نوار را عوض می‌کند؛
   * چیدمانِ ایستای مسیر را نشان می‌دهد (هنوز صفحه‌ای ساخته نشده) → آن رندر
   * سمت سرور است و پیام نمی‌گیرد، پس سند از نو بار می‌شود.
   */
  const applyNavToCanvas = useCallback(
    (items: ContentNavRow[]) => {
      const links = items.filter((i) => i.visible).map(({ slug, href, title }) => ({ slug, href, title }));
      if (blocksRef.current.length === 0) {
        setFrameEpoch((n) => n + 1);
        return;
      }
      const win = frameRef.current?.contentWindow;
      if (!win) return;
      try {
        win.postMessage({ type: "cms:set-nav", items: links }, siteOrigin);
      } catch {
        // اگر هنوز بارگذاری نشده، سندِ تازه خودش ناوبری را از API می‌گیرد
      }
    },
    [siteOrigin],
  );

  const saveNav = useCallback(async () => {
    setNavSaving(true);
    const r = await call<{ items: ContentNavRow[] }>("/admin/pages/content-nav", {
      method: "PUT",
      body: JSON.stringify({ items: navItems }),
    });
    setNavSaving(false);
    if (!r.ok || !r.data) {
      flash(r.error?.message ?? "ذخیرهٔ ناوبری ناموفق", "err");
      return;
    }
    setNavItems(r.data.items);
    setNavDirty(false);
    applyNavToCanvas(r.data.items);
    flash("ناوبری ذخیره شد — روی سایت و بوم اعمال شد");
  }, [call, navItems, flash, applyNavToCanvas]);

  /* ── تاریخچهٔ نسخه‌ها ── */
  const loadRevisions = useCallback(async () => {
    const r = await call<{ items: Array<{ id: string; createdAt: string; actorId: string | null }> }>(
      `/admin/pages/${slug}/revisions`,
    );
    if (r.ok && r.data) setRevisions(r.data.items);
  }, [call, slug]);

  const restore = useCallback(
    async (revisionId: string) => {
      const r = await call<{ data: CmsPageData }>(`/admin/pages/${slug}/restore/${revisionId}`, {
        method: "POST",
      });
      if (r.ok && r.data) {
        setBlocks(r.data.data.blocks);
        setTitle(r.data.data.title);
        setSeoTitle(r.data.data.seo?.title ?? "");
        setSeoDesc(r.data.data.seo?.description ?? "");
        setDirty(true);
        schedulePush(0);
        flash("نسخهٔ انتخابی برگردانده شد — برای اعمال در سایت «ذخیره» کن");
      } else {
        flash(r.error?.message ?? "بازگردانی ناموفق", "err");
      }
    },
    [call, slug, flash, schedulePush],
  );

  /* ── عملیات بلوک ── */
  const insertBlock = useCallback(
    (type: CmsBlockType) => {
      const b = makeBlock(type);
      commit((prev) => [...prev, b]);
      setSelectedId(b.id);
      // بلوکِ تازه انتخاب شده؛ در عرض باریک مستقیم به فیلدهایش برو.
      setMobilePane("settings");
    },
    [commit],
  );

  const moveBlock = useCallback(
    (id: string, dir: -1 | 1) => {
      commit((prev) => {
        const from = prev.findIndex((b) => b.id === id);
        if (from < 0) return prev;
        const to = Math.max(0, Math.min(prev.length - 1, from + dir));
        if (to === from) return prev;
        const next = [...prev];
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item);
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

  const scrollToBlock = useCallback(
    (id: string) => {
      const win = frameRef.current?.contentWindow;
      if (!win) return;
      try {
        win.postMessage({ type: "cms:scroll-to", id }, siteOrigin);
      } catch {
        // بی‌خطر
      }
    },
    [siteOrigin],
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

  const current = sitePages.find((p) => p.slug === slug) ?? null;
  const editablePages = sitePages.filter((p) => p.editable);
  const readonlyPages = sitePages.filter((p) => !p.editable);
  const pageExists = Boolean(current?.cms);

  const statusBadge = (p: SitePageRow) => {
    if (!p.cms) return "در صفحه‌ساز ساخته نشده";
    if (p.cms.status !== "PUBLISHED") return "پیش‌نویس";
    return p.cms.hasUnpublishedChanges ? "منتشر · تغییر تازه" : "منتشر";
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-app-bg" dir="rtl">
      {/* ───────── نوار بالا ───────── */}
      {/* ───────── نوار بالا ─────────
          در عرض‌های باریک (زیر `lg`) هدر دقیقاً **دو ردیفِ** ثابت است:
          ردیفِ زمینه (انتخابِ پنل + صفحه + وضعیت) و ردیفِ کنش‌ها (دستگاه،
          واگرد/ازنو، دیدن، ذخیره، انتشار). جابه‌جاییِ بین پنل‌ها (بوم/
          بلوک‌ها/تنظیمات) هم داخلِ همین ردیفِ اول است — پیش‌تر یک نوارِ
          جدا زیر هدر یک ردیفِ دیگر (~۴۴px) از ارتفاعِ بوم را می‌خورد؛ عنوانِ
          ثابتِ «صفحه‌ساز» در عرض کم جایش را به آن داد (از منو معلوم است).
          پیش از این همه‌چیز در یک `flex-wrap` می‌افتاد و در ۳۹۰px چهار ردیف
          می‌شد. از `lg` به بالا همان چیدمانِ یک‌ردیفِ قبلی است (`lg:ms-auto`
          ردیفِ کنش‌ها را به انتهای همان سطر می‌برد). */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-app-line bg-app-surface px-2.5 py-1.5 lg:px-3 lg:py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 lg:flex-none">
          <span className="hidden shrink-0 text-[13px] font-black text-app-ink lg:inline">صفحه‌ساز</span>

          {/* جابه‌جاییِ بین پنل‌ها در چیدمانِ تک‌پنلی — سگمنتِ داخلِ هدر،
              جایِ نوارِ جداگانهٔ قبلی. از `lg` به بالا پنهان است. */}
          <nav
            aria-label="پنل فعال صفحه‌ساز"
            className="flex shrink-0 items-center gap-0.5 rounded-xl border border-app-line p-0.5 lg:hidden"
          >
            {(
              [
                ["canvas", "بوم"],
                ["blocks", "بلوک‌ها"],
                ["settings", "تنظیمات"],
              ] as Array<[MobilePane, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setMobilePane(id)}
                aria-pressed={mobilePane === id}
                className={`rounded-lg px-1 py-1 text-[11px] font-bold transition-colors sm:px-1.5 ${
                  mobilePane === id
                    ? "bg-app-primary text-app-on-accent"
                    : "text-app-muted hover:bg-app-bg"
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          <select
            value={slug}
            onChange={(e) => {
              const s = e.target.value;
              if (!s) return;
              setSlug(s);
              void loadPage(s);
            }}
            className="h-8 min-w-0 flex-1 truncate rounded-xl border border-app-line bg-app-bg px-2 text-[12px] text-app-ink lg:h-9 lg:flex-none lg:max-w-64"
          >
            {editablePages.map((p) => (
              <option key={p.path} value={p.slug ?? ""}>
                {p.path} — {p.title} ({statusBadge(p)})
              </option>
            ))}
            {editablePages.length === 0 && <option value={slug}>{slug}</option>}
          </select>

          <button
            onClick={() => {
              const s = window.prompt("شناسهٔ صفحه (حروف انگلیسی کوچک، عدد و خط تیره):", "landing-1");
              if (!s) return;
              const t = window.prompt("عنوان صفحه:", "صفحهٔ تازه");
              void createPage(s.trim(), (t ?? "صفحهٔ تازه").trim(), "landing");
            }}
            className="hidden h-8 shrink-0 rounded-xl border border-app-primary-soft px-2 text-[12px] font-bold text-app-primary-strong hover:bg-app-primary-tint lg:flex lg:h-9 lg:px-3"
            title="ساخت یک لندینگ سفارشی"
          >
            + لندینگ تازه
          </button>

          <span
            className={`shrink-0 rounded-full px-1.5 py-1 text-[10px] font-bold sm:px-2.5 ${
              status === "PUBLISHED" ? "bg-app-primary-tint text-app-primary-strong" : "bg-app-bg text-app-muted"
            }`}
          >
            {status === "PUBLISHED" ? "منتشر شده" : "پیش‌نویس"}
          </span>
          {status === "PUBLISHED" && pendingChanges && (
            <span
              className="shrink-0 rounded-full bg-app-warning/15 px-1.5 py-1 text-[10px] font-bold text-app-warning sm:px-2.5"
              title="پیش‌نویس ذخیره شده با نسخهٔ روی سایت فرق دارد"
            >
              <span className="hidden sm:inline">تغییرات منتشرنشده</span>
              <span className="sm:hidden">منتشرنشده</span>
            </span>
          )}
          {dirty && <span className="hidden shrink-0 text-[10px] font-bold text-app-warning sm:inline">ذخیره نشده</span>}
        </div>

        <div className="flex w-full items-center gap-1.5 lg:ms-auto lg:w-auto">
          <div className="flex overflow-hidden rounded-xl border border-app-line">
            {(["mobile", "tablet", "desktop"] as Device[]).map((d) => (
              <button
                key={d}
                onClick={() => setDevice(d)}
                className={`px-1.5 py-1 text-[11px] font-bold lg:px-2.5 lg:py-1.5 ${
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
            className="h-8 shrink-0 rounded-xl border border-app-line px-2 text-[12px] font-bold disabled:opacity-35 lg:h-9 lg:px-2.5"
            title="واگرد (Ctrl+Z)"
          >
            ↶
          </button>
          <button
            onClick={redo}
            disabled={future.current.length === 0}
            className="h-8 shrink-0 rounded-xl border border-app-line px-2 text-[12px] font-bold disabled:opacity-35 lg:h-9 lg:px-2.5"
            title="ازنو (Ctrl+Shift+Z)"
          >
            ↷
          </button>

          {/* در عرض کم، «دیدن در سایت» فقط ↗ می‌شود و ms-auto کنش‌های اصلی
              را به انتهای ردیف می‌برد؛ در `lg` همان دکمهٔ کاملِ قبلی است. */}
          <a
            href={`${siteUrl}${viewPath}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-8 shrink-0 items-center rounded-xl border border-app-line px-2 text-[12px] font-bold text-app-primary-strong max-lg:ms-auto lg:h-9 lg:px-3"
            title="دیدن در سایت"
          >
            <span className="hidden lg:inline">دیدن در سایت </span>↗
          </a>

          <button
            onClick={() => void save()}
            disabled={loading || loadingPage}
            className="h-8 shrink-0 rounded-xl border border-app-primary-soft px-2.5 text-[12px] font-bold text-app-primary-strong disabled:opacity-50 lg:h-9 lg:px-3"
            title="ذخیره (Ctrl+S)"
          >
            ذخیره
          </button>

          {status === "PUBLISHED" ? (
            <>
              {/* صفحهٔ منتشرشده‌ای که پیش‌نویس تازه‌تر دارد: تا زدن این دکمه،
                  سایت همان نسخهٔ قبلی را نشان می‌دهد. */}
              {pendingChanges && (
                <button
                  onClick={() => void publish()}
                  disabled={loading || loadingPage}
                  className="h-8 shrink-0 rounded-xl bg-app-primary px-2.5 text-[12px] font-bold text-app-on-accent disabled:opacity-50 lg:h-9 lg:px-4"
                  title="پیش‌نویس را روی سایت منتشر کن"
                >
                  <span className="hidden lg:inline">انتشار تغییرات</span>
                  <span className="lg:hidden">انتشار</span>
                </button>
              )}
              <button
                onClick={() => void unpublish()}
                disabled={loading}
                className="h-8 shrink-0 rounded-xl border border-app-line px-2.5 text-[12px] font-bold text-app-muted disabled:opacity-50 lg:h-9 lg:px-3"
                title="لغو انتشار"
              >
                <span className="hidden lg:inline">لغو انتشار</span>
                <span className="lg:hidden">لغو</span>
              </button>
            </>
          ) : (
            <button
              onClick={() => void publish()}
              disabled={loading || loadingPage}
              className="h-8 shrink-0 rounded-xl bg-app-primary px-2.5 text-[12px] font-bold text-app-on-accent disabled:opacity-50 lg:h-9 lg:px-4"
              title="انتشار در سایت"
            >
              <span className="hidden lg:inline">انتشار در سایت</span>
              <span className="lg:hidden">انتشار</span>
            </button>
          )}

          {/* در عرض‌های باریک، «+» (ساختِ لندینگ تازه) از ردیفِ بالا به اینجا
              آمده تا انتخابگرِ صفحه جایش را پس بگیرد — اینجا انتهایِ ردیف خالی است. */}
          <button
            onClick={() => {
              const s = window.prompt("شناسهٔ صفحه (حروف انگلیسی کوچک، عدد و خط تیره):", "landing-1");
              if (!s) return;
              const t = window.prompt("عنوان صفحه:", "صفحهٔ تازه");
              void createPage(s.trim(), (t ?? "صفحهٔ تازه").trim(), "landing");
            }}
            className="h-8 shrink-0 rounded-xl border border-app-primary-soft px-2 text-[12px] font-bold text-app-primary-strong hover:bg-app-primary-tint lg:hidden"
            title="ساخت یک لندینگ سفارشی"
          >
            +
          </button>
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
        {/* ───────── ستون راست: ساختار / بلوک‌ها / صفحات سایت ───────── */}
        <aside
          className={`flex w-64 shrink-0 flex-col border-e border-app-line bg-app-surface max-lg:w-full max-lg:border-e-0 ${
            mobilePane === "blocks" ? "" : "max-lg:hidden"
          }`}
        >
          <div className="flex shrink-0 border-b border-app-line">
            {(
              [
                ["structure", "ساختار"],
                ["blocks", "بلوک‌ها"],
                ["pages", "صفحات سایت"],
              ] as Array<[RightTab, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex-1 px-2 py-2.5 text-[11px] font-bold ${
                  tab === id ? "border-b-2 border-app-primary text-app-primary-strong" : "text-app-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "structure" && (
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
              <p className="text-[10px] leading-5 text-app-muted">
                ترتیب بلوک‌های همین صفحه. روی هر ردیف بزن تا در بوم انتخاب شود.
              </p>
              {blocks.length === 0 && (
                <p className="rounded-xl border border-dashed border-app-line p-4 text-center text-[11px] text-app-muted">
                  این صفحه هنوز بلوکی ندارد. از تب «بلوک‌ها» یکی اضافه کن.
                </p>
              )}
              {blocks.map((b, i) => {
                const def = CMS_BLOCK_DEFS[b.type];
                return (
                  <div
                    key={b.id}
                    onClick={() => {
                      setSelectedId(b.id);
                      scrollToBlock(b.id);
                      // در عرض باریک، ردیفِ بلوک همان فیلدهایش را باز کند.
                      setMobilePane("settings");
                    }}
                    className={`group cursor-pointer rounded-xl border p-2 transition-colors ${
                      selectedId === b.id
                        ? "border-app-primary bg-app-primary-tint"
                        : "border-app-line bg-app-bg hover:border-app-primary-soft"
                    } ${b.hidden ? "opacity-50" : ""}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-app-surface text-[12px] text-app-primary-strong">
                        {def?.glyph ?? "•"}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-app-ink">
                        {def?.label ?? b.type}
                      </span>
                      <span className="text-[10px] text-app-muted">#{i + 1}</span>
                    </div>
                    <div className="mt-1.5 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                      <IconBtn onClick={() => moveBlock(b.id, -1)} disabled={i === 0} title="بالا">↑</IconBtn>
                      <IconBtn onClick={() => moveBlock(b.id, 1)} disabled={i === blocks.length - 1} title="پایین">↓</IconBtn>
                      <IconBtn onClick={() => duplicateBlock(b.id)} title="تکثیر">⧉</IconBtn>
                      <IconBtn
                        onClick={() =>
                          commit((prev) => prev.map((x) => (x.id === b.id ? { ...x, hidden: !x.hidden } : x)))
                        }
                        title={b.hidden ? "نمایش در سایت" : "پنهان کردن از سایت"}
                      >
                        {b.hidden ? "◌" : "◍"}
                      </IconBtn>
                      <IconBtn onClick={() => removeBlock(b.id)} title="حذف (Delete)" danger>✕</IconBtn>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === "blocks" && (
            <>
              <div className="shrink-0 border-b border-app-line p-3">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="جست‌وجوی بلوک…"
                  className="w-full rounded-xl border border-app-line bg-app-bg px-3 py-2 text-[12px] text-app-ink outline-none focus:border-app-primary-soft"
                />
              </div>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
                {palette.map((g) => (
                  <div key={g.id}>
                    <p className="mb-1.5 text-[10px] font-black text-app-muted">{g.label}</p>
                    <div className="space-y-1.5">
                      {g.items.map((d) => (
                        <button
                          key={d.type}
                          onClick={() => insertBlock(d.type)}
                          title={d.description}
                          className="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-app-line bg-app-bg px-2.5 py-2 text-start transition-colors hover:border-app-primary-soft hover:bg-app-primary-tint"
                        >
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-app-primary-tint text-[13px] text-app-primary-strong">
                            {d.glyph}
                          </span>
                          <span className="truncate text-[12px] font-bold text-app-ink">{d.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {palette.length === 0 && (
                  <p className="py-6 text-center text-[12px] text-app-muted">بلوکی با این نام پیدا نشد.</p>
                )}
              </div>
            </>
          )}

          {tab === "pages" && (
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              <div>
                <p className="mb-1.5 text-[10px] font-black text-app-muted">قابل ویرایش با صفحه‌ساز</p>
                <div className="space-y-1">
                  {editablePages.map((p) => (
                    <button
                      key={p.path}
                      onClick={() => {
                        if (!p.slug) return;
                        setSlug(p.slug);
                        void loadPage(p.slug);
                      }}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-start text-[11px] ${
                        slug === p.slug
                          ? "bg-app-primary-tint font-bold text-app-primary-strong"
                          : "text-app-muted hover:bg-app-bg"
                      }`}
                    >
                      <span className="truncate">{p.title}</span>
                      <span dir="ltr" className="shrink-0 text-[10px] opacity-70">
                        {p.path}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-[10px] font-black text-app-muted">فقط‌خواندنی (خارج از صفحه‌ساز)</p>
                <div className="space-y-1">
                  {readonlyPages.map((p) => (
                    <div
                      key={p.path}
                      title={p.note}
                      className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[11px] text-app-muted/70"
                    >
                      <span className="truncate">{p.title}</span>
                      <span dir="ltr" className="shrink-0 text-[10px] opacity-70">
                        {p.path}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </aside>

        {/* ───────── بوم زنده ───────── */}
        {/* بوم همیشه رندر می‌شود — حتی برای مسیری که هنوز در صفحه‌ساز ساخته
            نشده. دلیلش این است که مدیر باید همان چیزی را ببیند که بازدیدکننده
            می‌بیند؛ آن‌وقت می‌تواند تصمیم بگیرد صفحه را بسازد یا نه. قبلاً
            اینجا کارتِ «هنوز ساخته نشده» می‌آمد و هیچ صفحه‌ای لود نمی‌شد. */}
        <main
          ref={canvasRef}
          className={`relative min-h-0 min-w-0 flex-1 overflow-hidden bg-app-bg p-4 max-lg:p-2 ${
            mobilePane === "canvas" ? "" : "max-lg:hidden"
          }`}
        >
          <div
            className="mx-auto overflow-hidden rounded-2xl border border-app-line bg-white shadow-app-shadow-2"
            style={{ width: frame.w * frame.scale, height: frame.h * frame.scale }}
          >
            <iframe
              // با عوض شدن مسیر، سندِ تازه باید بارگذاری شود؛ بدون این کلید،
              // سندِ مسیر قبلی روی مسیر تازه می‌ماند.
              key={`${viewPath}#${frameEpoch}`}
              ref={frameRef}
              title="پیش‌نمایش زندهٔ صفحه"
              src={`${siteUrl}${viewPath}?cmsPreview=1`}
              onLoad={() => pushPage()}
              className="border-0"
              style={{
                width: frame.w,
                height: frame.h,
                transform: `scale(${frame.scale})`,
                // iframe عمداً پهن‌تر از قاب است و `scale` کوچکش می‌کند. در
                // چیدمان راست‌به‌چپ آن قوطی سرریز به **چپ** می‌رود، پس نقطهٔ
                // مقیاس باید گوشهٔ راست باشد — وگرنه محتوا نصف از کادر بیرون
                // می‌زند و بومِ پنل بریده دیده می‌شود.
                transformOrigin: "top right",
              }}
            />
          </div>

          {/* نوار «هنوز ساخته نشده» — روی بوم، نه به‌جای آن */}
          {!pageExists && current?.editable && (
            <div className="absolute inset-x-0 top-4 z-10 flex justify-center px-4">
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-app-line bg-app-surface px-4 py-2.5 shadow-app-shadow-2">
                <p className="text-[12px] font-bold text-app-ink">
                  {current.path} هنوز در صفحه‌ساز ساخته نشده — پایین‌تر محتوای فعلی سایت را می‌بینی
                </p>
                <button
                  onClick={() =>
                    // «site» یعنی صفحه از همان متنی ساخته می‌شود که سایت امروز
                    // نشان می‌دهد — پس تبدیل وفادارانه است و متن حقوقیِ
                    // دست‌نویس با یک «ساخت صفحه» پاک نمی‌شود.
                    void createPage(current.slug ?? slug, current.title, "site")
                  }
                  className="rounded-xl bg-app-primary px-4 py-2 text-[12px] font-bold text-app-on-accent"
                >
                  ساخت صفحه از محتوای فعلی
                </button>
              </div>
            </div>
          )}

          {/* نوار «مدل قدیمی» — صفحهٔ محتواییِ ساخته‌شده با هیرو + متن‌های پراکنده.
              چنین صفحه‌ای با چیدمان واقعی سایت نمی‌خواند؛ بازسازی، همان متن را
              در قالب «صفحهٔ محتوایی» می‌نشاند (نسخهٔ قبل در تاریخچه می‌ماند). */}
          {pageExists && current?.cms?.legacyModel && (
            <div className="absolute inset-x-0 top-4 z-10 flex justify-center px-4">
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-app-warning/40 bg-app-surface px-4 py-2.5 shadow-app-shadow-2">
                <p className="text-[12px] font-bold text-app-ink">
                  این صفحه با مدل قدیمی (هیرو + متن) ساخته شده و با چیدمان واقعی سایت نمی‌خواند
                </p>
                <button
                  onClick={() => {
                    if (!window.confirm("پیش‌نویس فعلی با محتوای مشترک سایت جایگزین می‌شود (نسخهٔ قبل در «نسخه‌های قبلی» می‌ماند). ادامه می‌دهی؟"))
                      return;
                    void rebuildFromSite();
                  }}
                  className="rounded-xl bg-app-primary px-4 py-2 text-[12px] font-bold text-app-on-accent"
                >
                  بازسازی از محتوای فعلی
                </button>
              </div>
            </div>
          )}

          {/* بوم در حال بالا آمدن است */}
          {frameStatus === "waiting" && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
              <span className="rounded-full bg-app-surface px-4 py-2 text-[12px] font-bold text-app-muted shadow-app-shadow-2">
                در حال باز شدن بوم…
              </span>
            </div>
          )}

          {/* فروشگاه بالا نیامد — علت را بگو، راه‌حل را هم */}
          {frameStatus === "stalled" && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-app-bg/90 p-6">
              <div className="max-w-md rounded-2xl border border-dashed border-app-line bg-app-surface p-8 text-center">
                <p className="text-[14px] font-black text-app-ink">
                  فروشگاه بالا نیست؛ بوم خالی است
                </p>
                <p className="mt-2 text-[12px] leading-6 text-app-muted">
                  فروشگاه را بالا بیاور؛ بوم خودش زنده می‌شود:
                </p>
                <code
                  dir="ltr"
                  className="mt-3 block rounded-lg bg-app-bg px-3 py-2 text-[12px] font-bold text-app-ink"
                >
                  bash infrastructure/run-local.sh start
                </code>
              </div>
            </div>
          )}
        </main>

        {/* ───────── ستون تنظیمات ───────── */}
        <aside
          className={`w-80 shrink-0 overflow-y-auto border-s border-app-line bg-app-surface max-lg:w-full max-lg:border-s-0 ${
            mobilePane === "settings" ? "" : "max-lg:hidden"
          }`}
        >
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
                  onClick={() => {
                    setSelectedId(null);
                    setHighlightField(null);
                  }}
                  className="shrink-0 rounded-lg border border-app-line px-2 py-1 text-[11px] text-app-muted"
                >
                  بستن
                </button>
              </div>

              <FieldEditor
                fields={selectedDef.fields}
                props={selected.props}
                blockType={selected.type}
                highlightKey={highlightField}
                onChange={(k, v) => patchBlock(selected.id, { [k]: v })}
              />

              <div className="mt-5 border-t border-app-line pt-4">
                <button
                  onClick={() => {
                    setMobilePane("canvas");
                    scrollToBlock(selected.id);
                  }}
                  className="w-full rounded-xl border border-app-line py-2 text-[11px] font-bold text-app-primary-strong hover:bg-app-primary-tint"
                >
                  نشان‌کردن در بوم
                </button>
              </div>
            </div>
          ) : (
            <div className="p-4">
              <p className="text-[13px] font-black text-app-ink">تنظیمات صفحه</p>
              <p className="mt-1 text-[11px] leading-6 text-app-muted">
                روی هر متن یا بخشی در بوم بزن تا همان‌جا ویرایشش کنی. برای تنظیمات کلی صفحه، اینجا بمان.
              </p>

              <div className="mt-4 space-y-4 border-t border-app-line pt-4">
                <div>
                  <label className="block text-[11px] font-bold text-app-muted">عنوان صفحه</label>
                  <input
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      setDirty(true);
                      schedulePush();
                    }}
                    placeholder="عنوان صفحه"
                    className="mt-1 w-full rounded-xl border border-app-line bg-app-bg px-3 py-2 text-[13px] text-app-ink outline-none focus:border-app-primary-soft"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-app-muted">عنوان سئو</label>
                  <input
                    value={seoTitle}
                    onChange={(e) => {
                      setSeoTitle(e.target.value);
                      setDirty(true);
                      schedulePush();
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
                      schedulePush();
                    }}
                    placeholder="خلاصه‌ای که در نتایج جست‌وجو نمایش داده می‌شود"
                    className="mt-1 w-full rounded-xl border border-app-line bg-app-bg px-3 py-2 text-[13px] text-app-ink outline-none focus:border-app-primary-soft"
                  />
                </div>

                <div className="rounded-xl border border-app-line bg-app-bg p-3" data-nav-editor="">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-bold text-app-ink">ناوبری صفحه‌های محتوایی</p>
                    <span className="text-[10px] text-app-muted" data-nav-count="">
                      {navItems.filter((n) => n.visible).length} نمایان از {navItems.length}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] leading-5 text-app-muted">
                    نوار زیرِ تیترِ هر صفحهٔ محتوایی — در سایت و بوم یکی است. نام و ترتیب همین‌جاست؛ مسیرِ پیوند ثابت می‌ماند تا پیوندِ سایت نشکند.
                  </p>

                  <div className="mt-2 space-y-1.5">
                    {navItems.map((item, i) => (
                      <div
                        key={item.slug}
                        data-nav-row={item.slug}
                        className={`flex items-center gap-1.5 rounded-lg border border-app-line bg-app-surface px-1.5 py-1.5 ${
                          item.visible ? "" : "opacity-60"
                        }`}
                      >
                        <input
                          value={item.title}
                          aria-label={`عنوان ناوبری ${item.slug}`}
                          onChange={(e) => {
                            const value = e.target.value;
                            setNavItems((prev) => prev.map((row, j) => (j === i ? { ...row, title: value } : row)));
                            setNavDirty(true);
                          }}
                          className="min-w-0 flex-1 rounded-md border border-app-line bg-app-bg px-2 py-1 text-[11px] text-app-ink outline-none focus:border-app-primary-soft"
                        />
                        <IconBtn title="بردن به بالا" disabled={i === 0} onClick={() => moveNav(i, i - 1)}>
                          ↑
                        </IconBtn>
                        <IconBtn title="بردن به پایین" disabled={i === navItems.length - 1} onClick={() => moveNav(i, i + 1)}>
                          ↓
                        </IconBtn>
                        <IconBtn
                          title={item.visible ? "پنهان کردن از نوار" : "نمایش در نوار"}
                          onClick={() => toggleNav(i)}
                        >
                          {item.visible ? "👁" : "🚫"}
                        </IconBtn>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => void saveNav()}
                    disabled={!navDirty || navSaving}
                    data-nav-save=""
                    className="mt-2 w-full rounded-xl bg-app-primary py-2 text-[11px] font-bold text-app-on-accent disabled:opacity-40"
                  >
                    {navSaving ? "در حال ذخیره…" : navDirty ? "ذخیرهٔ ناوبری" : "ناوبری ذخیره شده"}
                  </button>
                </div>

                <div className="rounded-xl border border-app-line bg-app-bg p-3">
                  <button
                    onClick={() => {
                      const open = !revisionsOpen;
                      setRevisionsOpen(open);
                      if (open) void loadRevisions();
                    }}
                    className="flex w-full items-center justify-between text-[11px] font-bold text-app-ink"
                  >
                    <span>نسخه‌های قبلی</span>
                    <span className="text-app-muted">{revisionsOpen ? "▲" : "▼"}</span>
                  </button>
                  {revisionsOpen && (
                    <div className="mt-2 space-y-1">
                      {revisions.length === 0 && (
                        <p className="text-[11px] text-app-muted">هنوز نسخه‌ای ثبت نشده.</p>
                      )}
                      {revisions.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => void restore(r.id)}
                          className="flex w-full items-center justify-between gap-2 rounded-lg border border-app-line px-2 py-1.5 text-[10px] text-app-muted hover:border-app-primary-soft hover:text-app-primary-strong"
                          title="برگرداندن این نسخه به‌عنوان پیش‌نویس"
                        >
                          <span dir="ltr">{new Date(r.createdAt).toLocaleString("fa-IR")}</span>
                          <span>بازگردانی</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

/** دکمهٔ کوچک آیکونی */
function IconBtn({
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
      className={`flex size-6 items-center justify-center rounded-md border border-app-line bg-app-surface text-[11px] text-app-ink disabled:opacity-30 ${
        danger ? "text-app-error" : ""
      }`}
    >
      {children}
    </button>
  );
}
