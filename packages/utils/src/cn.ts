import { clsx, type ClassValue } from "clsx";

/** ترکیب کلاس‌ها به‌صورت امن و شرطی — مشترک فرانت و ادمین */
export function cn(...inputs: ClassValue[]) {
  return clsx(...inputs);
}
