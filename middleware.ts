import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, authEnabled, verifySession } from "@/lib/auth";

/**
 * Auth middleware.
 *
 * If ADMIN_PASSWORD is unset, auth is disabled and we let everything
 * through (dev convenience). When set, every page and API route except
 * /login and /api/login requires a valid session cookie.
 *
 * Note: middleware runs in the Edge runtime, but lib/auth.ts uses Node
 * crypto. The verifySession function only reads the HMAC — that part
 * works fine in Edge thanks to Node's compat layer in middleware on
 * Next 14. If your platform doesn't have it, swap to a Web Crypto HMAC.
 */
export const config = {
  matcher: [
    // Run on everything EXCEPT static assets, favicon, and the login pages.
    "/((?!_next/static|_next/image|favicon|uploads|login|api/login).*)",
  ],
};

export async function middleware(req: NextRequest) {
  if (!authEnabled()) return NextResponse.next();

  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (await verifySession(cookie)) return NextResponse.next();

  // For API routes, return 401 instead of redirecting.
  if (req.nextUrl.pathname.startsWith("/api/")) {
    // Allow the cron endpoint to authenticate via its own bearer token.
    if (req.nextUrl.pathname.startsWith("/api/cron/")) {
      return NextResponse.next();
    }
    return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Page routes redirect to /login with a return URL.
  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}
