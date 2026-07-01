import { folderOverview } from "@/lib/folders";

export const dynamic = "force-dynamic";

export default async function FoldersPage() {
  const folders = await folderOverview();
  const trial = folders.filter((g) => g.kind === "trial");
  const qualified = folders.filter((g) => g.kind === "qualified");

  const Folder = ({ g }: { g: (typeof folders)[number] }) => (
    <div className="card-2 p-3">
      <div className="flex items-center justify-between">
        <div className="font-medium">{g.label}</div>
        <span className="pill bg-panel2 text-muted">
          {g.memberships.length} VA{g.memberships.length === 1 ? "" : "s"}
        </span>
      </div>
      {g.memberships.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {g.memberships.slice(0, 16).map((m) => (
            <li key={m.id} className="pill bg-panel2 text-gray-300">
              {m.candidate.fullName}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[11px] text-muted">empty</p>
      )}
    </div>
  );

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Folders</h1>
      <p className="mb-5 text-sm text-muted">
        Organizational buckets — who&apos;s where. VAs sit in their role&apos;s <b>Trial</b> folder while trialing,
        then auto-move to their model&apos;s <b>Qualified</b> folder once hired (e.g. “X VA – Lae”). All contact and
        training happens via the bot in DMs.
      </p>

      <section className="mb-6">
        <h2 className="label">Trial folders ({trial.length})</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {trial.map((g) => (
            <Folder key={g.id} g={g} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="label">Qualified folders — per model ({qualified.length})</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {qualified.map((g) => (
            <Folder key={g.id} g={g} />
          ))}
        </div>
      </section>
    </div>
  );
}
