import { NextResponse } from "next/server";
import {
  AUTH_COOKIE,
  authEnabled,
  cookieAttributes,
  expireCookieAttributes,
  mintSession,
  verifyPassword,
} from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!authEnabled()) {
    return NextResponse.json(
      { error: "Auth is not enabled on this server. Set ADMIN_PASSWORD." },
      { status: 503 },
    );
  }
  const { password } = (await req.json().catch(() => ({}))) as {
    password?: string;
  };
  if (!password || !verifyPassword(password)) {
    return NextResponse.json(
      { error: "Wrong password." },
      { status: 401 },
    );
  }
  const token = await mintSession();
  const res = NextResponse.json({ ok: true });
  res.headers.set(
    "Set-Cookie",
    `${AUTH_COOKIE}=${token}; ${cookieAttributes()}`,
  );
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.headers.set(
    "Set-Cookie",
    `${AUTH_COOKIE}=; ${expireCookieAttributes()}`,
  );
  return res;
}
