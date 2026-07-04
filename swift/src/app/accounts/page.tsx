import { prisma } from "@/lib/db";
import { accountsOverview, accountsByVa } from "@/lib/accounts";
import AccountsBoard from "@/components/AccountsBoard";
import BulkAddAccounts from "@/components/BulkAddAccounts";

export const dynamic = "force-dynamic";

const STATUS_CLASS: Record<string, string> = {
  warming: "bg-warn/15 text-warn",
  active: "bg-good/15 text-good",
  limited: "bg-warn/15 text-warn",
  suspended: "bg-bad/15 text-bad",
  banned: "bg-bad/15 text-bad",
  retired: "bg-panel2 text-muted",
};

export default async function AccountsPage() {
  const [accounts, byVa, users, creators] = await Promise.all([
    accountsOverview(),
    accountsByVa(),
    prisma.user.findMany({
      where: { status: "active" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true },
    }),
    prisma.creator.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const multiHolders = byVa.filter((v) => v.accounts.length > 1).length;

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Accounts &amp; access</h1>
      <p className="mb-5 text-sm text-muted">
        The account inventory per model, each account&apos;s warm-status, and which VAs hold access. When
        someone leaves, one-click offboard revokes everything they can touch.
      </p>

      {/* Accounts held by each VA — oversight of who's running what (esp. Reddit stables) */}
      <section className="card mb-6 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-base font-semibold">Accounts held by each VA ({byVa.length})</h2>
          {multiHolders > 0 && (
            <span className="pill bg-panel2 text-muted">{multiHolders} running multiple</span>
          )}
        </div>
        <p className="mb-3 text-sm text-muted">
          Who holds which accounts and their health. Reddit VAs run several at once — this is where you catch
          a banned one before it costs you.
        </p>
        <div className="space-y-2">
          {byVa.map((v) => (
            <div
              key={v.userId}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-panel2 p-2.5"
            >
              <span className="min-w-[130px] text-sm font-semibold">{v.vaName}</span>
              <span className="font-mono text-[11px] text-faint">{v.accounts.length} acct{v.accounts.length === 1 ? "" : "s"}</span>
              <div className="flex flex-1 flex-wrap items-center gap-1.5">
                {v.accounts.map((a) => (
                  <span
                    key={a.id}
                    className={`pill font-mono text-[11px] ${STATUS_CLASS[a.status] ?? "bg-panel2 text-muted"}`}
                    title={`${a.platform}${a.creatorName ? ` · ${a.creatorName}` : ""} · ${a.status}`}
                  >
                    {a.handle} · {a.status}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {byVa.length === 0 && <p className="text-sm text-muted">No accounts are held by any VA yet.</p>}
        </div>
      </section>

      <BulkAddAccounts creators={creators} />
      <AccountsBoard accounts={accounts} users={users} creators={creators} />
    </div>
  );
}
