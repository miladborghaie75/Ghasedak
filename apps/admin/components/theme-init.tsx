/**
 * Theme init ادمین — بند ۴۹/۵۵: بدون FOUC و بدون hydration mismatch.
 * کلید جدا از فروشگاه (ghasedak-admin-theme) — بند ۵۵: ترجیح ادمین مستقل از فروشگاه.
 */
export function ThemeInit() {
  const code = `(function(){try{
var k="ghasedak-admin-theme";var raw=null;
try{raw=localStorage.getItem(k)}catch(e){}
if(raw!=="light"&&raw!=="dark"){raw=null}
var resolved=(raw==="dark"||(raw===null&&window.matchMedia("(prefers-color-scheme: dark)").matches))?"dark":"light";
document.documentElement.setAttribute("data-theme",resolved);
}catch(e){}})();`;
  return <script id="admin-theme-init" dangerouslySetInnerHTML={{ __html: code }} />;
}

/** خواندن ترجیح فعلی در کلاینت (برای ThemeToggle) */
export function readAdminThemePref(): "light" | "dark" | "system" {
  if (typeof window === "undefined") return "system";
  try {
    const raw = localStorage.getItem("ghasedak-admin-theme");
    if (raw === "light" || raw === "dark") return raw;
  } catch {}
  return "system";
}
