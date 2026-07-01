import { prisma } from "@/lib/db";
import { accountsOverview } from "@/lib/accounts";
import AccountsBoard from "@/components/AccountsBoard";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const [accounts, users, creators] = await Promise.all([
    accountsOverview(),
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

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Accounts &amp; access</h1>
      <p className="mb-5 text-sm text-muted">
        The account inventory per model, each account&apos;s warm-status, and which VAs hold access. When
        someone leaves, one-click offboard revokes everything they can touch.
      </p>
      <AccountsBoard accounts={accounts} users={users} creators={creators} />
    </div>
  );
}
