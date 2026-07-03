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

  const dest = assignment?.creator?.ofTrialUrl || assignment?.creator?.xMainUrl || null;
  if (!dest) {
    // No destination set for this model yet — send them to OF rather than erroring.
    return NextResponse.redirect("https://onlyfans.com", 302);
  }
  try {
    const url = new URL(dest);
    if (!url.searchParams.has("c")) url.searchParams.set("c", params.slug); // carry the tag downstream
    return NextResponse.redirect(url.toString(), 302);
  } catch {
    return NextResponse.redirect(dest, 302);
  }
}
