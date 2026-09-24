/**
 * قراردادهای مشترک API (بند ۶۴/۶۵/۶۶/۱۰۹)
 * فرانت، ادمین و API هر سه این تایپ‌ها را مصرف می‌کنند؛
 * تغییر ساختار این فایل باید هم‌زمان در هر سه قابل تشخیص باشد.
 */
import { z } from "zod";

/* ---------- خطا (بند ۶۵) ---------- */

export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
  requestId: z.string().optional(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

/* ---------- صفحه‌بندی (بند ۶۶) ---------- */

export interface PageRequest {
  page?: number;
  limit?: number;
  sort?: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

/* ---------- سلامت سرویس (بند ۸۸) ---------- */

export interface HealthStatus {
  status: "ok" | "degraded";
  requestId: string;
  checks: {
    api: boolean;
    db: boolean;
    redis: boolean;
    storage: boolean;
  };
  uptimeSeconds: number;
}

/* ---------- کدهای خطای استاندارد ---------- */

export const ERROR_CODES = {
  VALIDATION: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  PAYMENT_VERIFY_FAILED: "PAYMENT_VERIFY_FAILED",
  INTERNAL: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
