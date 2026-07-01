import { NextResponse } from "next/server";

export function ok(data: any = { ok: true }, init?: number) {
  return NextResponse.json(data, { status: init ?? 200 });
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function readJSON<T = any>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

/** Authorize a cron request via ?secret= or x-cron-secret header against CRON_SECRET. */
export function cronAuthorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return process.env.NODE_ENV !== "production"; // open in dev, closed in prod until set
  const url = new URL(req.url);
  const got = url.searchParams.get("secret") ?? req.headers.get("x-cron-secret");
  return got === expected;
}
