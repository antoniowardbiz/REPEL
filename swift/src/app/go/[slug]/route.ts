import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// GET /go/[slug] — a VA's personal promo link. Logs a click attributed to them,
// then redirects to their model's OF free-trial link. Public (subs click it).
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const assignment = await prisma.assignment.findUnique({
    where: { trackSlug: params.slug },
    include: { creator: true },
  });

  if (assignment) {
    // Await the click log so it's never dropped — a serverless/edge instance can
    // freeze the moment the redirect is returned, killing an un-awaited write.
    // It's a single fast insert; wrapped so a DB hiccup still lets the sub through.
    await prisma.activityEvent
      .create({
        data: {
          userId: assignment.userId,
          type: "promo_click",
          payload: JSON.stringify({ slug: params.slug, at: Date.now() }),
        },
      })
      .catch(() => {});
  }

  // Resolve the destination, best → safest:
  //   1. the VA's OWN pool trial link (per-VA sub attribution) — a real /trial/ link.
  //   2. the model's shared OF free-trial link, but ONLY if it actually IS a trial
  //      link. That field has been mis-set to the bare PAID profile before; guarding
  //      on /trial/ means a mis-set value can never dump subs on the paid page again.
  //   3. the model's main page as a last resort.
  const isTrialLink = (u?: string | null) => !!u && /\/(action\/)?trial\//i.test(u);
  const ofTrial = assignment?.creator?.ofTrialUrl ?? null;
  const dest =
    assignment?.trialLinkUrl ||
    (isTrialLink(ofTrial) ? ofTrial : null) ||
    assignment?.creator?.xMainUrl ||
    null;
  if (!dest) {
    // No destination set for this model yet — send them to OF rather than erroring.
    return NextResponse.redirect("https://onlyfans.com", 302);
  }
  // Redirect to the destination EXACTLY as stored — a byte-for-byte passthrough,
  // no query params bolted on. Attribution is already logged server-side above
  // (per-slug), so we don't need to carry a tag downstream. Critically, appending
  // ?c=… to an OnlyFans /trial/<code> link can bump the visitor off the free-trial
  // route and onto the paid profile page — the exact leak we're closing. A VA's
  // /go link must land on the same free-trial page as the raw link they'd share.
  return NextResponse.redirect(dest, 302);
}
