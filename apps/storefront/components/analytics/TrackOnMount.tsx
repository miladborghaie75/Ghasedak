"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics";

/**
 * شلیک رویداد در اولین رندر — برای صفحه‌های سروری (محصول/جستجو) که
 * خودشان client نیستند. گارد رضایت داخل track است: بدون رضایت no-op.
 */
export function TrackOnMount({
  event,
  params,
}: {
  event: string;
  params: Record<string, unknown>;
}) {
  useEffect(() => {
    track(event, params);
    // فقط یک‌بار در mount — params عمداً در وابستگی نیست تا رندر تازه شلیک نکند
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
