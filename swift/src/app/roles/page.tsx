import { prisma } from "@/lib/db";
import { parseCriteria } from "@/lib/serialize";
import { validateRubricWeights } from "@/lib/scoring";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  const roles = await prisma.role.findMany({
    where: { active: true },
    include: { rubric: true, defaultCreator: true, manager: true },
    orderBy: { displayName: "asc" },
  });

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Roles &amp; Rubrics</h1>
      <p className="mb-5 text-sm text-muted">
        The six VA roles, their trial config, and the scoring rubric (criteria weighted to 100).
      </p>

      <div className="space-y-5">
        {roles.map((role) => {
          const criteria = parseCriteria(role.rubric?.criteria);
          const ok = validateRubricWeights(criteria);
          return (
            <section key={role.id} className="card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-display text-lg font-semibold">{role.displayName}</h2>
                  <div className="text-xs text-muted">
                    <span className="font-mono">{role.key}</span> · {role.trialHours}h trial
                    {role.defaultCreator ? ` · model: ${role.defaultCreator.name}` : ""}
                    {role.manager ? ` · manager: ${role.manager.name}` : ""}
                  </div>
                </div>
                <span className={`pill ${ok ? "bg-good/15 text-good border border-good/40" : "bg-bad/15 text-bad border border-bad/40"}`}>
                  weights {ok ? "= 100 ✓" : "≠ 100"}
                </span>
              </div>

              <div className="overflow-hidden rounded-lg border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-panel2 text-muted">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Criterion</th>
                      <th className="px-3 py-2 text-right font-medium">Weight</th>
                      <th className="px-3 py-2 text-left font-medium">A 5 looks like</th>
                    </tr>
                  </thead>
                  <tbody>
                    {criteria.map((c) => (
                      <tr key={c.key} className="border-t border-line">
                        <td className="px-3 py-2 align-top font-medium">{c.label}</td>
                        <td className="px-3 py-2 text-right align-top font-mono">{c.weight}</td>
                        <td className="px-3 py-2 align-top text-muted">{c.anchor_5}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
