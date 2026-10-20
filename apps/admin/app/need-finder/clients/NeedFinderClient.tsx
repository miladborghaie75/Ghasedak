"use client";

/**
 * مدیریت ویزارد «چی لازم داری؟» (گام ۱۶) — گام‌ها | گزینه‌ها.
 *
 * چرا دو ستون: ساختار ویزارد یک درخت است (گام → گزینه → قاعده). در ستون راست
 * گام‌ها را می‌بینی و در ستون چپ گزینه‌های گام انتخاب‌شده را — بدون رفت‌وبرگشت
 * بین صفحه‌ها.
 *
 * قاعده ساختاریافته (نه JSON خام): دسته‌ها و جنس‌ها از واژگان کاتالوگ انتخاب
 * می‌شوند، پس قاعدهٔ ذخیره‌شده همیشه به دادهٔ واقعی می‌خورد. سرور هم همان را
 * دوباره بررسی می‌کند و ناشناخته را رد می‌کند.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdminApi } from "@/components/useAdminApi";

type Rule = {
  categories?: string[];
  attributeTerms?: string[];
  priceMax?: number;
  why?: string;
};

type OptionRow = {
  id: string;
  stepId: string;
  label: string;
  icon: string | null;
  rule: Rule | null;
  sortOrder: number;
  active: boolean;
};

type StepRow = {
  id: string;
  question: string;
  sortOrder: number;
  active: boolean;
  options: OptionRow[];
};

type VocabTerm = { id: string; slug: string; value: string };
type VocabAttribute = { slug: string; name: string; isFilterable: boolean; terms: VocabTerm[] };
type VocabCategory = { slug: string; name: string; status: string };
type Vocabulary = { categories: VocabCategory[]; attributes: VocabAttribute[] };

type Call = <T,>(
  path: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; status: number; data?: T; error?: { message?: string } }>;

const FALLBACK_MSG = "انجام نشد؛ کمی بعد دوباره تلاش کن.";

export default function NeedFinderClient() {
  const { call, permissions } = useAdminApi();
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [vocab, setVocab] = useState<Vocabulary | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newQuestion, setNewQuestion] = useState("");
  const [newOption, setNewOption] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const canManage = permissions.includes("marketing.manage");

  const load = useCallback(async () => {
    const [s, v] = await Promise.all([
      call<{ items: StepRow[] }>("/admin/need-finder/steps"),
      call<Vocabulary>("/admin/need-finder/vocabulary"),
    ]);
    if (s.ok && s.data) {
      setSteps(s.data.items);
      setSelectedId((prev) => (prev && s.data!.items.some((i) => i.id === prev) ? prev : s.data!.items[0]?.id ?? null));
    }
    if (v.ok && v.data) setVocab(v.data);
  }, [call]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(() => steps.find((s) => s.id === selectedId) ?? null, [steps, selectedId]);

  const say = (text: string, ok = true) => setMsg({ text, ok });

  /** اجرای یک درخواست نوشتن + تازه‌سازی فهرست؛ پیام خطا از خود سرور می‌آید */
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

  const addStep = () =>
    run(async () => {
      const r = await call("/admin/need-finder/steps", {
        method: "POST",
        body: JSON.stringify({ question: newQuestion }),
      });
      if (r.ok) setNewQuestion("");
      return r;
    }, "گام تازه اضافه شد.");

  const saveStep = (step: StepRow, question: string) =>
    run(
      () =>
        call(`/admin/need-finder/steps/${step.id}`, {
          method: "PATCH",
          body: JSON.stringify({ question }),
        }),
      "پرسش گام ذخیره شد.",
    );

  const toggleStep = (step: StepRow) =>
    run(
      () =>
        call(`/admin/need-finder/steps/${step.id}`, {
          method: "PATCH",
          body: JSON.stringify({ active: !step.active }),
        }),
      step.active ? "گام خاموش شد." : "گام روشن شد.",
    );

  const removeStep = (step: StepRow) =>
    run(() => call(`/admin/need-finder/steps/${step.id}`, { method: "DELETE" }), "گام حذف شد.");

  const moveStep = (index: number, dir: -1 | 1) => {
    const ids = steps.map((s) => s.id);
    const to = index + dir;
    if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to], ids[index]];
    void run(
      () => call("/admin/need-finder/reorder", { method: "POST", body: JSON.stringify({ kind: "step", ids }) }),
      "ترتیب گام‌ها عوض شد.",
    );
  };

  const addOption = (stepId: string) =>
    run(async () => {
      const r = await call(`/admin/need-finder/steps/${stepId}/options`, {
        method: "POST",
        body: JSON.stringify({ label: newOption }),
      });
      if (r.ok) setNewOption("");
      return r;
    }, "گزینهٔ تازه اضافه شد.");

  const removeOption = (option: OptionRow) =>
    run(() => call(`/admin/need-finder/options/${option.id}`, { method: "DELETE" }), "گزینه حذف شد.");

  const toggleOption = (option: OptionRow) =>
    run(
      () =>
        call(`/admin/need-finder/options/${option.id}`, {
          method: "PATCH",
          body: JSON.stringify({ active: !option.active }),
        }),
      option.active ? "گزینه خاموش شد." : "گزینه روشن شد.",
    );

  const moveOption = (step: StepRow, index: number, dir: -1 | 1) => {
    const ids = step.options.map((o) => o.id);
    const to = index + dir;
    if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to], ids[index]];
    void run(
      () => call("/admin/need-finder/reorder", { method: "POST", body: JSON.stringify({ kind: "option", ids }) }),
      "ترتیب گزینه‌ها عوض شد.",
    );
  };

  const restoreDefaults = () =>
    run(() => call("/admin/need-finder/restore-defaults", { method: "POST" }), "گام‌های پیش‌فرض برگشتند.");

  return (
    <div className="space-y-4">
      {msg && (
        <div
          className={`rounded-card border px-4 py-2 text-sm ${
            msg.ok ? "border-app-line bg-app-surface text-app-ink" : "border-app-err bg-app-surface text-app-err"
          }`}
        >
          {msg.text}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void restoreDefaults()}
          disabled={!canManage || busy}
          className="rounded-full border border-app-line bg-app-surface px-4 py-2 text-xs font-bold text-app-ink disabled:opacity-50"
        >
          برگرداندن گام‌های پیش‌فرض
        </button>
        <p className="text-[11px] text-app-muted">
          دسته و جنس‌ها از کاتالوگ واقعی می‌آیند؛ اگر چیزی در فهرست نبود، آن را در بخش
          «دسته‌ها» یا «ویژگی‌ها» بساز.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        {/* ستون گام‌ها */}
        <section className="rounded-card border border-app-line bg-app-surface p-4">
          <h2 className="mb-3 text-sm font-bold text-app-ink">گام‌ها</h2>

          <ul className="space-y-2">
            {steps.map((step, i) => (
              <li key={step.id}>
                <div
                  className={`rounded-xl border p-3 ${
                    step.id === selectedId ? "border-app-primary bg-app-primary-tint" : "border-app-line bg-app-bg"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(step.id)}
                    className="w-full text-start text-[13px] font-bold text-app-ink"
                  >
                    {step.question}
                  </button>
                  <p className="mt-1 text-[11px] text-app-muted">
                    {step.options.length} گزینه · {step.active ? "روشن" : "خاموش"}
                  </p>
                  {canManage && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button type="button" onClick={() => moveStep(i, -1)} className="rounded-full border border-app-line px-2.5 py-1 text-[11px] font-bold text-app-muted">
                        بالا
                      </button>
                      <button type="button" onClick={() => moveStep(i, 1)} className="rounded-full border border-app-line px-2.5 py-1 text-[11px] font-bold text-app-muted">
                        پایین
                      </button>
                      <button type="button" onClick={() => void toggleStep(step)} className="rounded-full border border-app-line px-2.5 py-1 text-[11px] font-bold text-app-muted">
                        {step.active ? "خاموش کن" : "روشن کن"}
                      </button>
                      <button type="button" onClick={() => void removeStep(step)} className="rounded-full border border-app-line px-2.5 py-1 text-[11px] font-bold text-app-err">
                        حذف
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {steps.length === 0 && (
            <p className="mt-3 text-[12px] text-app-muted">
              هنوز گامی نیست. با دکمهٔ زیر اولین گام را بساز.
            </p>
          )}

          {canManage && (
            <div className="mt-4 border-t border-app-line pt-3">
              <label className="mb-1 block text-[11px] font-bold text-app-muted" htmlFor="new-step">
                پرسش گام تازه
              </label>
              <div className="flex gap-2">
                <input
                  id="new-step"
                  value={newQuestion}
                  onChange={(e) => setNewQuestion(e.target.value)}
                  placeholder="مثلاً: برای چه موقعیتی می‌خواهی؟"
                  className="w-full rounded-lg border border-app-line bg-app-bg px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => void addStep()}
                  disabled={busy || !newQuestion.trim()}
                  className="shrink-0 rounded-full bg-app-primary px-4 py-2 text-xs font-bold text-app-on-accent disabled:opacity-50"
                >
                  افزودن گام
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ستون گزینه‌ها */}
        <section className="rounded-card border border-app-line bg-app-surface p-4">
          <h2 className="mb-1 text-sm font-bold text-app-ink">گزینه‌ها</h2>
          {selected ? (
            <p className="mb-3 text-[12px] text-app-muted">گزینه‌های «{selected.question}»</p>
          ) : (
            <p className="mb-3 text-[12px] text-app-muted">اول یک گام را از ستون کنار انتخاب کن.</p>
          )}

          {selected && (
            <ul className="space-y-3">
              {selected.options.map((option, i) => (
                <li key={option.id}>
                  <OptionCard
                    option={option}
                    vocab={vocab}
                    canManage={canManage}
                    busy={busy}
                    call={call}
                    onSaved={() => void load()}
                    onDeleted={() => void load()}
                    onError={(text) => say(text, false)}
                    onMove={(dir) => moveOption(selected, i, dir)}
                  />
                </li>
              ))}
            </ul>
          )}

          {selected && selected.options.length === 0 && (
            <p className="text-[12px] text-app-muted">این گام هنوز گزینه‌ای ندارد.</p>
          )}

          {selected && canManage && (
            <div className="mt-4 border-t border-app-line pt-3">
              <label className="mb-1 block text-[11px] font-bold text-app-muted" htmlFor="new-option">
                متن گزینهٔ تازه
              </label>
              <div className="flex gap-2">
                <input
                  id="new-option"
                  value={newOption}
                  onChange={(e) => setNewOption(e.target.value)}
                  placeholder="مثلاً: استفاده روزمره"
                  className="w-full rounded-lg border border-app-line bg-app-bg px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => void addOption(selected.id)}
                  disabled={busy || !newOption.trim()}
                  className="shrink-0 rounded-full bg-app-primary px-4 py-2 text-xs font-bold text-app-on-accent disabled:opacity-50"
                >
                  افزودن گزینه
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/* ── فرم قاعدهٔ یک گزینه ─────────────────────────────────────────────── */

function OptionCard({
  option,
  vocab,
  canManage,
  busy,
  call,
  onSaved,
  onDeleted,
  onError,
  onMove,
}: {
  option: OptionRow;
  vocab: Vocabulary | null;
  canManage: boolean;
  busy: boolean;
  call: Call;
  onSaved: () => void;
  onDeleted: () => void;
  onError: (text: string) => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const [label, setLabel] = useState(option.label);
  const [icon, setIcon] = useState(option.icon ?? "");
  const [categories, setCategories] = useState<string[]>(option.rule?.categories ?? []);
  const [terms, setTerms] = useState<string[]>(option.rule?.attributeTerms ?? []);
  const [priceMax, setPriceMax] = useState(option.rule?.priceMax ? String(option.rule.priceMax) : "");
  const [why, setWhy] = useState(option.rule?.why ?? "");

  // بعد از هر ذخیره، فرم با دادهٔ تازه هم‌تراز می‌شود
  useEffect(() => {
    setLabel(option.label);
    setIcon(option.icon ?? "");
    setCategories(option.rule?.categories ?? []);
    setTerms(option.rule?.attributeTerms ?? []);
    setPriceMax(option.rule?.priceMax ? String(option.rule.priceMax) : "");
    setWhy(option.rule?.why ?? "");
  }, [option]);

  const toggle = (list: string[], value: string, set: (v: string[]) => void) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const save = async () => {
    const rule: Rule = {};
    if (categories.length) rule.categories = categories;
    if (terms.length) rule.attributeTerms = terms;
    const price = Number(priceMax);
    if (priceMax.trim() && Number.isFinite(price) && price > 0) rule.priceMax = Math.round(price);
    if (why.trim()) rule.why = why.trim();
    const r = await call(`/admin/need-finder/options/${option.id}`, {
      method: "PATCH",
      body: JSON.stringify({ label, icon: icon.trim() || null, rule }),
    });
    if (r.ok) {
      onSaved();
    } else {
      onError(r.error?.message ?? FALLBACK_MSG);
    }
  };

  const remove = async () => {
    const r = await call(`/admin/need-finder/options/${option.id}`, { method: "DELETE" });
    if (r.ok) onDeleted();
    else onError(r.error?.message ?? FALLBACK_MSG);
  };

  const toggleActive = async () => {
    const r = await call(`/admin/need-finder/options/${option.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !option.active }),
    });
    if (r.ok) onSaved();
    else onError(r.error?.message ?? FALLBACK_MSG);
  };

  return (
    <div className="rounded-xl border border-app-line bg-app-bg p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          aria-label="متن گزینه"
          className="min-w-40 flex-1 rounded-lg border border-app-line bg-app-surface px-3 py-2 text-sm font-bold"
        />
        <input
          value={icon}
          onChange={(e) => setIcon(e.target.value)}
          aria-label="آیکون گزینه"
          placeholder="آیکون"
          className="w-20 rounded-lg border border-app-line bg-app-surface px-2 py-2 text-sm"
        />
        {canManage && (
          <div className="flex gap-1.5">
            <button type="button" onClick={() => onMove(-1)} className="rounded-full border border-app-line px-2.5 py-1 text-[11px] font-bold text-app-muted">
              بالا
            </button>
            <button type="button" onClick={() => onMove(1)} className="rounded-full border border-app-line px-2.5 py-1 text-[11px] font-bold text-app-muted">
              پایین
            </button>
            <button type="button" onClick={() => void toggleActive()} className="rounded-full border border-app-line px-2.5 py-1 text-[11px] font-bold text-app-muted">
              {option.active ? "خاموش کن" : "روشن کن"}
            </button>
            <button type="button" onClick={() => void remove()} className="rounded-full border border-app-line px-2.5 py-1 text-[11px] font-bold text-app-err">
              حذف
            </button>
          </div>
        )}
      </div>

      {canManage && (
        <div className="mt-3 space-y-3">
          {/* دسته‌ها */}
          <fieldset>
            <legend className="mb-1 text-[11px] font-bold text-app-muted">دسته‌ها</legend>
            <div className="flex flex-wrap gap-1.5">
              {(vocab?.categories ?? []).map((c) => (
                <button
                  key={c.slug}
                  type="button"
                  onClick={() => toggle(categories, c.slug, setCategories)}
                  className={`rounded-full px-3 py-1 text-[11px] font-bold ${
                    categories.includes(c.slug)
                      ? "bg-app-primary text-app-on-accent"
                      : "border border-app-line bg-app-surface text-app-muted"
                  }`}
                >
                  {c.name}
                </button>
              ))}
              {!vocab?.categories.length && (
                <span className="text-[11px] text-app-muted">هنوز دسته‌ای در کاتالوگ نیست.</span>
              )}
            </div>
          </fieldset>

          {/* جنس و بقیهٔ ویژگی‌ها */}
          <fieldset>
            <legend className="mb-1 text-[11px] font-bold text-app-muted">جنس و ویژگی‌ها</legend>
            <div className="space-y-2">
              {(vocab?.attributes ?? [])
                .filter((a) => a.terms.length)
                .map((a) => (
                  <div key={a.slug} className="flex flex-wrap items-center gap-1.5">
                    <span className="w-20 text-[11px] font-bold text-app-muted">{a.name}</span>
                    {a.terms.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => toggle(terms, t.slug, setTerms)}
                        className={`rounded-full px-3 py-1 text-[11px] font-bold ${
                          terms.includes(t.slug)
                            ? "bg-app-primary text-app-on-accent"
                            : "border border-app-line bg-app-surface text-app-muted"
                        }`}
                      >
                        {t.value}
                      </button>
                    ))}
                  </div>
                ))}
            </div>
          </fieldset>

          {/* بودجه و دلیل */}
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-[11px] font-bold text-app-muted">
              سقف بودجه (تومان)
              <input
                type="number"
                min={0}
                step={1000}
                value={priceMax}
                onChange={(e) => setPriceMax(e.target.value)}
                placeholder="بدون سقف"
                className="mt-1 w-full rounded-lg border border-app-line bg-app-surface px-3 py-2 text-sm font-normal"
              />
            </label>
            <label className="text-[11px] font-bold text-app-muted">
              دلیل نمایش به مشتری
              <input
                value={why}
                onChange={(e) => setWhy(e.target.value)}
                placeholder="مثلاً: جنس نرم و نفس‌کش"
                className="mt-1 w-full rounded-lg border border-app-line bg-app-surface px-3 py-2 text-sm font-normal"
              />
            </label>
          </div>

          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="rounded-full bg-app-primary px-4 py-2 text-xs font-bold text-app-on-accent disabled:opacity-50"
          >
            ذخیرهٔ گزینه
          </button>
        </div>
      )}
    </div>
  );
}
