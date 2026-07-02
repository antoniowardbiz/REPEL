import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Optional password gate for the operator dashboard + its mutating APIs.
//
// OFF by default — no lock-out risk: if DASHBOARD_PASSWORD is unset the app
// behaves exactly as before. Set DASHBOARD_PASSWORD in the environment to turn
// on HTTP Basic Auth over everything EXCEPT the public/applicant + machine
// routes below, which must stay reachable without a password:
//   /apply, /api/apply           — public application form
//   /training/*, /api/training/* — candidate training + quiz (token-gated)
//   /api/telegram/*              — Telegram webhook (secret-gated)
//   /api/cron/*                  — scheduled jobs (CRON_SECRET-gated)
// When on, the browser shows a native username/password box — enter anything as
// the username and DASHBOARD_PASSWORD as the password.
const PUBLIC_PREFIXES = ["/apply", "/api/apply", "/training", "/api/training", "/api/telegram", "/api/cron"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function middleware(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next(); // gate disabled → unchanged behaviour

  if (isPublic(req.nextUrl.pathname)) return NextResponse.next();

  const auth = req.headers.get("authorization") || "";
  if (auth.startsWith("Basic ")) {
    try {
      const decoded = atob(auth.slice(6)); // Edge runtime: atob, not Buffer
      const pass = decoded.slice(decoded.indexOf(":") + 1);
      if (pass === password) return NextResponse.next();
    } catch {
      /* fall through to 401 */
    }
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="SWIFT operator", charset="UTF-8"' },
  });
}

export const config = {
  // Run on everything except Next.js static assets + the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
