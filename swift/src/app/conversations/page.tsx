import Link from "next/link";
import { prisma } from "@/lib/db";
import { timeAgo } from "@/lib/ui";
import { STAGE_META, Stage } from "@/lib/constants";

export const dynamic = "force-dynamic";

// One screen for every bot conversation: latest message per candidate, newest
// first, with the ones waiting on a human reply pulled to the top. Click through
// to the full thread on the candidate page.
export default async function ConversationsPage() {
  const recent = await prisma.message.findMany({
    orderBy: { createdAt: "desc" },
    take: 500,
    include: { candidate: { include: { currentRole: true } } },
  });

  // Dedupe to the latest message per candidate (query is already newest-first).
  const seen = new Map<string, (typeof recent)[number]>();
  for (const m of recent) {
    if (m.candidateId && !seen.has(m.candidateId)) seen.set(m.candidateId, m);
  }
  const threads = [...seen.values()];
  // Waiting on us = the candidate spoke last.
  const waiting = threads.filter((m) => m.direction === "inbound");
  const ordered = [...waiting, ...threads.filter((m) => m.direction !== "inbound")];

  return (
    <div>
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Conversations</h1>
          <p className="text-sm text-muted">
            Every candidate&rsquo;s latest message. {waiting.length > 0 && (
              <span className="text-brand">{waiting.length} waiting on a reply.</span>
            )}
          </p>
        </div>
        <span className="pill bg-panel2 text-muted">{threads.length} threads</span>
      </div>

      {ordered.length === 0 && <p className="text-sm text-muted">No conversations yet.</p>}

      <div className="flex flex-col gap-2">
        {ordered.map((m) => {
          const c = m.candidate;
          const inbound = m.direction === "inbound";
          const meta = STAGE_META[c.currentStage as Stage];
          return (
            <Link
              key={m.candidateId}
              href={`/candidates/${m.candidateId}`}
              className={`card flex items-start justify-between gap-4 p-3 transition hover:border-brand/60 ${
                inbound ? "border-brand/40" : ""
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{c.fullName}</span>
                  {c.currentRole && <span className="badge">{c.currentRole.displayName}</span>}
                  {meta && <span className="pill bg-panel2 text-muted">{meta.label}</span>}
                  {inbound && <span className="pill bg-brand/15 text-brand">Needs reply</span>}
                </div>
                <div className="mt-1 truncate text-sm text-muted">
                  <span className={inbound ? "text-white" : "text-faint"}>
                    {inbound ? "They:" : m.templateKey === "ai_support" ? "AI:" : "Us:"}
                  </span>{" "}
                  {m.body.replace(/\s+/g, " ").slice(0, 140)}
                </div>
              </div>
              <span className="whitespace-nowrap text-[11px] text-faint">{timeAgo(m.createdAt)}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
