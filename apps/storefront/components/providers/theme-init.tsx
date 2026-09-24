/**
 * Theme init — بند ۴۹/۵۳: بدون FOUC و بدون hydration mismatch.
 * اسکریپت پیش از رنگ‌آمیزی: قبل از اولین paint روی <html> اثر می‌گذارد و hydrate نمی‌شود.
 * منبع واحد حقیقت: data-theme همیشه «حل‌شده» (light/dark) می‌گذارد —
 * system → بر اساس prefers-color-scheme. CSS فقط به [data-theme="dark"] واکنش نشان می‌دهد.
 */
export function ThemeInit() {
  const code = `(function(){try{
var k="ghasedak-theme";var raw=null;
try{raw=localStorage.getItem(k)}catch(e){}
if(raw!=="light"&&raw!=="dark"){raw=null}
var resolved=(raw==="dark"||(raw===null&&window.matchMedia("(prefers-color-scheme: dark)").matches))?"dark":"light";
document.documentElement.setAttribute("data-theme",resolved);
}catch(e){}})();`;
  return <script id="theme-init" dangerouslySetInnerHTML={{ __html: code }} />;
}

/** خواندن ترجیح کاربر (نه مقدار حل‌شده) در کلاینت — برای ThemeToggle */
export function readThemePref(): "light" | "dark" | "system" {
  if (typeof window === "undefined") return "system";
  try {
    const raw = localStorage.getItem("ghasedak-theme");
    if (raw === "light" || raw === "dark") return raw;
  } catch {}
  return "system";
}
