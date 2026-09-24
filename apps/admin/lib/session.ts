import { cookies } from "next/headers";
import { api } from "./api";

export interface AdminMe {
  userId: string;
  name: string | null;
  email: string | null;
  role: string;
  permissions: string[];
}

export async function getIdentity(): Promise<AdminMe | null> {
  const jar = await cookies();
  const cookie = jar.get("ghasedak_admin_session")?.value;
  if (!cookie) return null;
  const res = await api<AdminMe>("/auth/me", { cookie: `ghasedak_admin_session=${cookie}` });
  return res.ok ? (res.data ?? null) : null;
}

export function can(permissions: string[] | undefined, key: string): boolean {
  return !!permissions?.includes(key);
}
