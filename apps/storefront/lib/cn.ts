import { clsx, type ClassValue } from "clsx";

/** ترکیب کلاس‌ها به‌صورت امن و شرطی */
export function cn(...inputs: ClassValue[]) {
  return clsx(...inputs);
}
