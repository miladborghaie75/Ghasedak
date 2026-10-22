"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CmsRenderer } from "@ghasedak/blocks";
import type { CmsData } from "@ghasedak/blocks";
import type { CmsPageData } from "@ghasedak/contracts";

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
  | { type: "cms:scroll-to"; id: string };

type Outgoing =
  | { type: "cms:ready" }
  | { type: "cms:block-select"; id: string; field?: string }
  | { type: "cms:block-hover"; id: string | null }
  | { type: "cms:field-input"; blockId: string; key: string; value: string };

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
  const rootRef = useRef<HTMLDivElement>(null);
  /** مکان نشانگر داخل فیلدِ در حال تایپ — بعد از رندر دوباره برمی‌گردد */
  const caret = useRef<{ blockId: string; key: string; offset: number } | null>(null);
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
        setLive(msg.page);
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
    const el = rootRef.current?.querySelector<HTMLElement>(
      `[data-cms-field="${CSS.escape(c.key)}"][data-cms-block="${CSS.escape(c.blockId)}"]`,
    );
    const node = el?.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    const max = node.textContent?.length ?? 0;
    const range = document.createRange();
    range.setStart(node, Math.min(c.offset, max));
    range.collapse(true);
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
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
      const el = e.target as HTMLElement;
      const key = el.dataset?.cmsField;
      const blockId = el.dataset?.cmsBlock;
      if (!key || !blockId) return;
      const text = el.textContent ?? "";

      // مکان نشانگر را نگه می‌داریم تا بعد از رندر برگردد
      const sel = window.getSelection();
      const offset =
        sel && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).startContainer)
          ? sel.getRangeAt(0).startOffset
          : text.length;
      caret.current = { blockId, key, offset };

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

  return (
    <div
      ref={rootRef}
      data-cms-preview=""
      onClick={onClick}
      onMouseOver={onMouseOver}
      onInput={onInput}
      className="flex flex-col"
    >
      {live.blocks.length === 0 && fallback ? (
        fallback
      ) : (
        <CmsRenderer page={live} data={data} />
      )}
    </div>
  );
}

/** برجسته‌کردن بلوک انتخاب‌شده در خود صفحه */
function markSelected(root: HTMLElement | null, id: string | null) {
  if (!root) return;
  for (const el of root.querySelectorAll<HTMLElement>("[data-block-id]")) {
    el.classList.toggle("cms-selected", !!id && el.dataset.blockId === id);
  }
}
