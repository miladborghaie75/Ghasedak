import { NextResponse } from "next/server";

export async function POST(request: Request): Promise<NextResponse> {
  const cookie = request.headers.get("cookie") ?? "";
  await fetch(`${process.env.API_ORIGIN ?? "http://localhost:4000"}/api/v1/auth/logout`, {
    method: "POST",
    headers: { cookie },
  }).catch(() => null);
  const res = NextResponse.redirect(new URL("/login", request.url));
  res.cookies.set("ghasedak_admin_session", "", { path: "/", maxAge: 0 });
  return res;
}
