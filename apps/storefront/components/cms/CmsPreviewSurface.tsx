"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CmsRenderer } from "@ghasedak/blocks";
import type { CmsData } from "@ghasedak/blocks";
import type { CmsPageData, ContentNavItem } from "@ghasedak/contracts";

/**
 * سطح پیش‌نمایش زنده — همان صفحهٔ واقعی، داخل iframe پنل صفحه‌ساز.
 *
 * چرا این جزء کلاینت است؟ چون باید با پنل «حرف بزند»:
 *  ۱) از پنل صفحهٔ تازه را می‌گیرد و همین‌جا رندر می‌کند → هر تغییری
 *     (افزودن/جابه‌جایی/حذف بلوک) بی‌درنگ روی خود صفحه دیده می‌شود؛
 *  ۲) کلیک و هاور روی بلوک‌ها را به پنل گزارش می‌دهد؛
 *  ۳) متن‌های ساده را **درجا** ویرایش‌پذیر می‌کند.
 *
 * پیام‌ها با `postMessage` ردوبدل می‌شوند. مقصدِ ارسال، origin والد است که
 * از `document.referrer` خوانده می‌شود — نه `*` — تا پیام به دامنهٔ
 * بیگانه نرود. دریافت هم فقط از خودِ `window.parent` پذیرفته می‌شود.
 */

type Incoming =
  | { type: "cms:set-page"; page: CmsPageData }
  | { type: "cms:select-block"; id: string }
  | { type: "cms:scroll-to"; id: string }
  /** ناوبریِ تازهٔ صفحه‌های محتوایی — بعد از ذخیره در پنل، بوم همان لحظه عوض می‌شود */
  | { type: "cms:set-nav"; items: ContentNavItem[] };

type Outgoing =
  | { type: "cms:ready" }
  | { type: "cms:block-select"; id: string; field?: string }
  | { type: "cms:block-hover"; id: string | null }
  | { type: "cms:field-input"; blockId: string; key: string; value: string }
  /** ویرایشِ درجای یک خط از بخش‌های صفحهٔ محتوایی — متنِ خالص، بدون نشانه */
  | { type: "cms:line-input"; blockId: string; sectionIndex: number; lineIndex: number; text: string };

/**
 * جای نشانگرِ متن — یا یک فیلدِ ساده (`key`) یا یک خط از بخش‌ها.
 *
 * برای خط‌ها نمی‌توان از `firstChild` استفاده کرد: خط ممکن است از چند
 * `<span>`/`<a>` ساخته شود؛ پس آفستِ نویسه‌ای در کلِ عنصر نگه داشته می‌شود و
 * بعد از رندر دوباره روی درختِ متن نشانده می‌شود.
 */
type Caret =
  | { blockId: string; key: string; offset: number }
  | { blockId: string; sectionIndex: number; lineIndex: number; offset: number };

/** origin پنل (والد) — از referrer می‌فهمیم */
function parentOrigin(): string {
  if (typeof document === "undefined") return "*";
  try {
    return new URL(document.referrer).origin;
  } catch {
    return "*";
  }
}

export default function CmsPreviewSurface({
  page,
  data,
  fallback,
}: {
  page: CmsPageData;
  data: CmsData;
  /**
   * چیدمانِ پیش‌فرضِ همان مسیر — وقتی هنوز صفحه‌ای در CMS نیست.
   *
   * چرا؟ چون بومِ صفحه‌ساز باید همان چیزی را نشان دهد که بازدیدکننده
   * می‌بیند. بدون این، بوم برای مسیرهایی مثل ‎/about یک جعبهٔ سفیدِ بی‌پیام
   * می‌شد و مدیر نمی‌فهمید چه چیزی را می‌خواهد قابل‌ویرایش کند.
   */
  fallback?: ReactNode;
}) {
  const [live, setLive] = useState<CmsPageData>(page);
  /**
   * ناوبریِ صفحه‌های محتوایی — اول از سرور (`data.nav`)، بعد از پیامِ پنل.
   * چرا state و نه فقط prop؟ چون ذخیرهٔ ناوبری در پنل باید همان لحظه روی
   * بوم دیده شود، بی‌آنکه صفحه (و ویرایشِ ذخیره‌نشدهٔ روی آن) از نو بار شود.
   */
  const [nav, setNav] = useState<ContentNavItem[] | undefined>(data.nav);
  /**
   * شمارهٔ رندر — وقتی پنل عیناً همان صفحه‌ای را می‌فرستد که داریم،
   * ری‌اکت متنی را که مرورگر مستقیم داخل `contenteditable` نوشته نمی‌بیند
   * و DOM با مدل ناهم‌خوان می‌ماند (مثلاً واگرد پیش از echo). پس در این
   * حالتِ نادر، درخت را از نو می‌سازیم تا متنِ مدل برگردد.
   */
  const [epoch, setEpoch] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  /** آخرین صفحهٔ رندرشده — برای مقایسهٔ پیامِ تازه، بدون وابستگیِ effect */
  const liveRef = useRef<CmsPageData>(page);
  liveRef.current = live;
  /** مکان نشانگر داخل فیلد/خطِ در حال تایپ — بعد از رندر دوباره برمی‌گردد */
  const caret = useRef<Caret | null>(null);
  /** آخرین بلوک هاورشده — برای اینکه پیام تکراری نفرستیم */
  const hovered = useRef<string | null>(null);
  const selected = useRef<string | null>(null);

  const post = useCallback((msg: Outgoing) => {
    try {
      window.parent.postMessage(msg, parentOrigin());
    } catch {
      // اگر والد در دسترس نبود (باز کردن مستقیم صفحه) بی‌خطر رد می‌شود
    }
  }, []);

  /* ── اعلام آمادگی به پنل ── */
  useEffect(() => {
    post({ type: "cms:ready" });
    // فقط یک‌بار در آغاز
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── دریافت پیام‌های پنل ── */
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent) return;
      const msg = e.data as Incoming | undefined;
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "cms:set-page") {
        // پیامِ یکسان با آنچه نمایش می‌دهیم معمولاً یعنی واگرد به همین
        // وضعیتِ پیش از تایپ؛ چون تایپ مستقیم در DOM انجام شده، باید درخت
        // را از نو بسازیم وگرنه ری‌اکت تغییری نمی‌بیند و متنِ تایپ‌شده
        // روی صفحه می‌ماند.
        if (JSON.stringify(msg.page) === JSON.stringify(liveRef.current)) {
          setEpoch((n) => n + 1);
          return;
        }
        liveRef.current = msg.page;
        setLive(msg.page);
        return;
      }

      if (msg.type === "cms:set-nav") {
        setNav(Array.isArray(msg.items) ? msg.items : undefined);
        return;
      }

      if (msg.type === "cms:select-block" || msg.type === "cms:scroll-to") {
        const el = rootRef.current?.querySelector<HTMLElement>(
          `[data-block-id="${CSS.escape(msg.id)}"]`,
        );
        if (!el) return;
        if (msg.type === "cms:select-block") {
          selected.current = msg.id;
          markSelected(rootRef.current, msg.id);
        }
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  /* ── آماده‌کردن فیلدها برای ویرایش درجا ── */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    for (const el of root.querySelectorAll<HTMLElement>("[data-cms-field]")) {
      const holder = el.closest<HTMLElement>("[data-block-id]");
      const blockId = holder?.dataset.blockId ?? "";
      const key = el.dataset.cmsField ?? "";
      if (!blockId || !key) continue;
      el.dataset.cmsBlock = blockId;
      if (el.getAttribute("contenteditable") !== "true") {
        el.setAttribute("contenteditable", "true");
        el.setAttribute("spellcheck", "false");
      }
    }
  });

  /* ── برگرداندن نشانگر بعد از رندر دوباره ──
     ریاکت با عوض‌کردن متن، نشانگر را می‌پراند. چون خودمان متن را در
     state نگه می‌داریم، رندر دوباره اجتناب‌ناپذیر است؛ پس مکان نشانگر را
     قبل از رندر ذخیره و بعد از آن برمی‌گردانیم. */
  useLayoutEffect(() => {
    const c = caret.current;
    if (!c) return;
    caret.current = null;
    const root = rootRef.current;
    if (!root) return;
    // داخلِ همان بلوک بگرد، نه با `data-cms-block` که افکتِ passive بعداً
    // می‌نشاند؛ در رندرِ اولِ یک خطِ تازه، آن attribute هنوز نیست.
    const wrapper = root.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(c.blockId)}"]`);
    if (!wrapper) return;
    const el =
      "key" in c
        ? wrapper.querySelector<HTMLElement>(`[data-cms-field="${CSS.escape(c.key)}"]`)
        : wrapper.querySelector<HTMLElement>(
            `[data-cms-section="${c.sectionIndex}"][data-cms-line="${c.lineIndex}"]`,
          );
    if (!el) return;
    placeCaret(el, c.offset);
  });

  /* ── رویدادهای تعامل ── */
  const onClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      // در حالت ویرایش، هیچ لینکی نباید ما را از صفحه ببرد
      if (target.closest("a")) e.preventDefault();
      const field = target.closest<HTMLElement>("[data-cms-field]");
      const holder = target.closest<HTMLElement>("[data-block-id]");
      const id = holder?.dataset.blockId ?? "";
      selected.current = id || null;
      markSelected(rootRef.current, id || null);
      post({ type: "cms:block-select", id, field: field?.dataset.cmsField });
    },
    [post],
  );

  const onMouseOver = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      const holder = target.closest<HTMLElement>("[data-block-id]");
      const id = holder?.dataset.blockId ?? null;
      if (id === hovered.current) return;
      hovered.current = id;
      post({ type: "cms:block-hover", id });
    },
    [post],
  );

  const onInput = useCallback(
    (e: React.FormEvent) => {
      const target = e.target as HTMLElement;
      const host = target.closest<HTMLElement>("[data-cms-field]");
      if (!host) return;
      const blockId =
        host.closest<HTMLElement>("[data-block-id]")?.dataset.blockId ?? host.dataset.cmsBlock ?? "";
      if (!blockId) return;

      /* ── خطِ صفحهٔ محتوایی ──
         فقط متنِ خالص می‌رود؛ پیوند/برجسته را پنل از روی همان متن و
         با موقعیتِ نشانه‌ها نگه می‌دارد. اینجا state را عوض نمی‌کنیم تا
         هر کلمه یک رندرِ کامل و پرشِ نشانگر نسازد؛ پنل پس از توقفِ تایپ
         کلِ صفحه را می‌فرستد. */
      const lineEl = target.closest<HTMLElement>("[data-cms-line]");
      if (lineEl) {
        const sectionIndex = Number(lineEl.dataset.cmsSection);
        const lineIndex = Number(lineEl.dataset.cmsLine);
        if (!Number.isInteger(sectionIndex) || !Number.isInteger(lineIndex)) return;
        caret.current = {
          blockId,
          sectionIndex,
          lineIndex,
          offset: caretOffset(lineEl),
        };
        const text = lineEl.textContent ?? "";
        post({ type: "cms:line-input", blockId, sectionIndex, lineIndex, text });
        return;
      }

      const key = host.dataset.cmsField;
      if (!key) return;
      const text = host.textContent ?? "";

      // مکان نشانگر را نگه می‌داریم تا بعد از رندر برگردد
      caret.current = { blockId, key, offset: caretOffset(host) };

      // متن را در state هم نگه می‌داریم تا ریاکت بداند DOM چیست
      setLive((prev) => ({
        ...prev,
        blocks: prev.blocks.map((b) =>
          b.id === blockId ? { ...b, props: { ...b.props, [key]: text } } : b,
        ),
      }));

      post({ type: "cms:field-input", blockId, key, value: text });
    },
    [post],
  );

  /* ── Enter در یک خط، خطِ تازه نمی‌سازد ──
     مدلِ متن هر خط را یک بند می‌داند؛ خطِ تازه باید از پنل اضافه شود. */
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const line = target.closest<HTMLElement>("[data-cms-line]");
    if (!line) return;
    if (e.key === "Enter") {
      e.preventDefault();
      line.blur();
    }
  }, []);

  return (
    <div
      ref={rootRef}
      data-cms-preview=""
      onClick={onClick}
      onMouseOver={onMouseOver}
      onInput={onInput}
      onKeyDown={onKeyDown}
      onBlur={() => {
        // فوکوس از بوم رفت؛ نشانگرِ ذخیره‌شده نباید در رندرِ بعدی فوکوس را بدزدد.
        caret.current = null;
      }}
      className="flex flex-col"
    >
      {live.blocks.length === 0 && fallback ? (
        fallback
      ) : (
        <CmsRenderer key={epoch} page={live} data={{ ...data, nav }} />
      )}
    </div>
  );
}

/** آفستِ نویسه‌ایِ نشانگر در کلِ متنِ یک عنصرِ ویرایش‌پذیر */
function caretOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return (el.textContent ?? "").length;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return (el.textContent ?? "").length;
  const before = document.createRange();
  before.selectNodeContents(el);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString().length;
}

/** نشاندنِ نشانگر روی آفستِ نویسه‌ای — مستقل از اینکه خط چند `<span>` دارد */
function placeCaret(el: HTMLElement, offset: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset);
  let last: Text | null = null;
  let node = walker.nextNode() as Text | null;
  while (node) {
    const len = node.textContent?.length ?? 0;
    if (remaining <= len) {
      range.setStart(node, remaining);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    remaining -= len;
    last = node;
    node = walker.nextNode() as Text | null;
  }
  if (last) {
    range.setStart(last, last.textContent?.length ?? 0);
  } else {
    range.selectNodeContents(el);
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** برجسته‌کردن بلوک انتخاب‌شده در خود صفحه */
function markSelected(root: HTMLElement | null, id: string | null) {
  if (!root) return;
  for (const el of root.querySelectorAll<HTMLElement>("[data-block-id]")) {
    el.classList.toggle("cms-selected", !!id && el.dataset.blockId === id);
  }
}
