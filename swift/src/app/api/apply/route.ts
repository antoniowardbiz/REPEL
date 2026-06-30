import { ok, fail, readJSON } from "@/lib/api";
import { intakeCandidate } from "@/lib/services";
import { ROLE_KEYS } from "@/lib/constants";

// POST /api/apply — public apply form intake (drop the form link in your OLJ reply).
export async function POST(req: Request) {
  const body = await readJSON(req);
  if (!body.fullName || typeof body.fullName !== "string") return fail("fullName is required");
  if (body.roleKey && !(ROLE_KEYS as readonly string[]).includes(body.roleKey)) {
    return fail("invalid roleKey");
  }
  try {
    const result = await intakeCandidate({
      fullName: body.fullName.trim(),
      telegramHandle: body.telegramHandle,
      email: body.email,
      country: body.country,
      timezone: body.timezone,
      roleKey: body.roleKey ?? null,
      whyText: body.whyText ?? null,
      source: "onlinejobs_ph",
    });
    const username = process.env.TELEGRAM_BOT_USERNAME;
    const botDeepLink = username
      ? `https://t.me/${username}?start=${result.candidate.startToken}`
      : null;
    return ok({ ok: true, candidateId: result.candidate.id, botDeepLink }, 201);
  } catch (e: any) {
    return fail(e?.message ?? "failed to submit application", 500);
  }
}
