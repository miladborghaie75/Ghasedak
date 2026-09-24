import { cn } from "@/lib/cn";
import { faNum } from "@/lib/format";

/**
 * ورودی با لیبل visible و hint — طبق اصول a11y، placeholder-only ممنوع.
 */
interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  id: string;
  className?: string;
  optionalLabel?: string;
}

export function Field({
  label,
  hint,
  error,
  id,
  className,
  optionalLabel,
  ...rest
}: FieldProps) {
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy =
    [hint ? hintId : null, error ? errId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-bold text-ink">
        {label}
        {optionalLabel && (
          <span className="mr-1.5 font-normal text-muted">({optionalLabel})</span>
        )}
      </label>
      <input
        id={id}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className={cn(
          "h-11 rounded-xl border bg-surface px-3.5 text-sm text-ink outline-none transition-colors placeholder:text-muted/70",
          error
            ? "border-[#C6455D] focus:border-[#C6455D]"
            : "border-line focus:border-primary-strong",
        )}
        {...rest}
      />
      {hint && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} role="alert" className="text-xs font-medium text-[#C6455D]">
          {error}
        </p>
      )}
    </div>
  );
}

/** ورودی عددی با ارقام فارسی نمایش‌داده‌شده (تبدیل هنگام تایپ) */
export function FaNumberInput({
  value,
  onValueChange,
  id,
  ...rest
}: {
  value: number | "";
  onValueChange: (v: number | "") => void;
  id: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const display = value === "" ? "" : faNum(value);
  return (
    <input
      id={id}
      inputMode="numeric"
      dir="ltr"
      className="h-11 rounded-xl border border-line bg-surface px-3.5 text-right text-sm text-ink tnum outline-none focus:border-primary-strong"
      value={display}
      onChange={(e) => {
        const fa = e.target.value;
        const en = fa.replace(/[۰-۹]/g, (d) =>
          String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)),
        );
        const cleaned = en.replace(/[^\d]/g, "").slice(0, 9);
        onValueChange(cleaned === "" ? "" : Number(cleaned));
      }}
      {...rest}
    />
  );
}
