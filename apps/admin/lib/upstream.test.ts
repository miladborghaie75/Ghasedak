/**
 * تستِ تفکیکِ خطاهای ورود — «رمز غلط» از «سرور نیست» جدا می‌ماند.
 *
 * چرا مهم است: اگر API خاموش باشد و پنل بگوید «ایمیل یا رمز نادرست است»،
 * مدیر به‌جای روشن‌کردن سرور، رمزش را عوض می‌کند. این تست همان ترجمه را قفل می‌کند.
 *
 * اجرا:  pnpm --filter @ghasedak/admin test
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { entryNotice, loginFailureCode, postUpstream } from "./upstream.ts";

const realFetch = globalThis.fetch;

async function withFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("۴۰۱ «رمز غلط» است، نه «سرور خراب»", async () => {
  const res = await withFetch(
    (async () => new Response(JSON.stringify({ code: "BAD_CREDENTIALS" }), { status: 401 })) as typeof fetch,
    () => postUpstream("/api/v1/auth/login", { email: "a", password: "b" }),
  );
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.reason, "unauthorized");
  assert.equal(loginFailureCode("unauthorized"), "credentials");
});

test("API خاموش → unreachable (نه استثنا، نه رمز غلط)", async () => {
  const res = await withFetch(
    (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch,
    () => postUpstream("/api/v1/auth/login", { email: "a", password: "b" }),
  );
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.reason, "unreachable");
  assert.equal(res.ok === false && res.status, 0);
  assert.equal(loginFailureCode("unreachable"), "down");
});

test("۵۰۰ سرور → «خطای سرور»، جدا از هر دو", async () => {
  const res = await withFetch(
    (async () => new Response("boom", { status: 500 })) as typeof fetch,
    () => postUpstream("/api/v1/auth/login", { email: "a", password: "b" }),
  );
  assert.equal(res.ok === false && res.reason, "failed");
  assert.equal(loginFailureCode("failed"), "server");
});

test("ورود موفق: بدنه و کوکی نشست هر دو برمی‌گردند", async () => {
  const res = await withFetch(
    (async () =>
      new Response(JSON.stringify({ user: { role: "SUPER_ADMIN" } }), {
        status: 200,
        headers: { "set-cookie": "ghasedak_admin_session=abc123; Path=/; HttpOnly" },
      })) as typeof fetch,
    () => postUpstream<{ user: { role: string } }>("/api/v1/auth/login", { email: "a", password: "b" }),
  );
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.data?.user.role, "SUPER_ADMIN");
  assert.equal(/ghasedak_admin_session=([^;]+)/.exec(res.setCookie ?? "")?.[1], "abc123");
});

test("پیامِ هر کد درست است و کدِ ناشناخته پیامی نمی‌سازد", () => {
  assert.match(entryNotice("down")?.text ?? "", /سرور پنل پاسخ نمی‌دهد/);
  assert.match(entryNotice("credentials")?.text ?? "", /رمز نادرست/);
  assert.match(entryNotice("server")?.text ?? "", /خطا داد/);
  assert.equal(entryNotice(undefined), null);
  assert.equal(entryNotice("whatever"), null);
  // پیامِ «سرور نیست» نباید حرفی از رمز بزند
  assert.doesNotMatch(entryNotice("down")?.text ?? "", /رمز نادرست/);
});
