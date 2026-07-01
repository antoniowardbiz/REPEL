"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ACCOUNT_PLATFORMS, ACCOUNT_STATUSES, ACCOUNT_STATUS_META } from "@/lib/constants";
import { accountStatusBadgeClass } from "@/lib/ui";
import type { AccountView } from "@/lib/accounts";

type UserLite = { id: string; name: string; role: string };
type CreatorLite = { id: string; name: string };

async function send(url: string, method: string, body: any) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.ok;
}

function AddAccount({ creators }: { creators: CreatorLite[] }) {
  const router = useRouter();
  const [platform, setPlatform] = useState<string>("x");
  const [handle, setHandle] = useState("");
  const [label, setLabel] = useState("");
  const [creatorId, setCreatorId] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!handle.trim()) return;
    setBusy(true);
    const okRes = await send("/api/accounts", "POST", {
      platform,
      handle,
      label: label || null,
      creatorId: creatorId || null,
    });
    setBusy(false);
    if (okRes) {
      setHandle("");
      setLabel("");
      router.refresh();
    }
  }

  return (
    <section className="card mb-6 p-4">
      <h2 className="mb-3 font-display text-base font-semibold">Add account</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label className="label">Platform</label>
          <select className="input" value={platform} onChange={(e) => setPlatform(e.target.value)}>
            {ACCOUNT_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Handle</label>
          <input
            className="input"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="@handle"
          />
        </div>
        <div>
          <label className="label">Label (optional)</label>
          <input
            className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. main / warm #2"
          />
        </div>
        <div>
          <label className="label">Model</label>
          <select className="input" value={creatorId} onChange={(e) => setCreatorId(e.target.value)}>
            <option value="">— unassigned —</option>
            {creators.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button className="btn-primary w-full" disabled={busy || !handle.trim()} onClick={submit}>
            {busy ? "Adding…" : "Add account"}
          </button>
        </div>
      </div>
    </section>
  );
}

function AccountCard({ account, users }: { account: AccountView; users: UserLite[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [grantee, setGrantee] = useState("");

  const grantedIds = new Set(account.grants.map((g) => g.userId));
  const grantable = users.filter((u) => !grantedIds.has(u.id));

  async function changeStatus(status: string) {
    setBusy(true);
    const okRes = await send(`/api/accounts/${account.id}`, "PATCH", { status });
    setBusy(false);
    if (okRes) router.refresh();
  }
  async function grant() {
    if (!grantee) return;
    setBusy(true);
    const okRes = await send(`/api/accounts/${account.id}/grant`, "POST", { userId: grantee });
    setBusy(false);
    if (okRes) {
      setGrantee("");
      router.refresh();
    }
  }
  async function revoke(grantId: string) {
    setBusy(true);
    const okRes = await send("/api/accounts/revoke", "POST", { grantId });
    setBusy(false);
    if (okRes) router.refresh();
  }

  return (
    <div className="card-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">
            <span className="text-muted">{account.platform}</span> · {account.handle}
          </div>
          {account.label && <div className="text-[11px] text-muted">{account.label}</div>}
        </div>
        <span className={`pill border ${accountStatusBadgeClass(account.status)}`}>
          {ACCOUNT_STATUS_META[account.status as keyof typeof ACCOUNT_STATUS_META]?.label ?? account.status}
        </span>
      </div>

      <div className="mt-3">
        <label className="label">Status</label>
        <select
          className="input"
          value={account.status}
          disabled={busy}
          onChange={(e) => changeStatus(e.target.value)}
        >
          {ACCOUNT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ACCOUNT_STATUS_META[s].label}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3">
        <div className="label">Access ({account.grants.length})</div>
        {account.grants.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {account.grants.map((g) => (
              <li key={g.id} className="pill flex items-center gap-1 bg-panel2 text-gray-200">
                {g.userName}
                <button
                  className="text-muted hover:text-bad"
                  disabled={busy}
                  title="Revoke access"
                  onClick={() => revoke(g.id)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-muted">No one has access.</p>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <select
          className="input"
          value={grantee}
          disabled={busy || grantable.length === 0}
          onChange={(e) => setGrantee(e.target.value)}
        >
          <option value="">{grantable.length ? "Grant to VA…" : "everyone has access"}</option>
          {grantable.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <button className="btn-ghost btn-sm" disabled={busy || !grantee} onClick={grant}>
          Grant
        </button>
      </div>
    </div>
  );
}

function OffboardPanel({ accounts }: { accounts: AccountView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const byUser = useMemo(() => {
    const m = new Map<string, { name: string; accounts: string[] }>();
    for (const a of accounts) {
      for (const g of a.grants) {
        const e = m.get(g.userId) ?? { name: g.userName, accounts: [] };
        e.accounts.push(`${a.platform}/${a.handle}`);
        m.set(g.userId, e);
      }
    }
    return Array.from(m.entries()).sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [accounts]);

  async function offboard(userId: string, name: string, count: number) {
    if (!confirm(`Offboard ${name}? This revokes all ${count} account${count === 1 ? "" : "s"} they hold.`))
      return;
    setBusy(userId);
    const okRes = await send("/api/accounts/offboard", "POST", { userId });
    setBusy(null);
    if (okRes) router.refresh();
  }

  return (
    <section className="card p-4">
      <h2 className="mb-1 font-display text-base font-semibold">VAs holding access ({byUser.length})</h2>
      <p className="mb-3 text-xs text-muted">One-click offboard revokes every account a VA can touch.</p>
      {byUser.length === 0 ? (
        <p className="text-sm text-muted">No active grants yet.</p>
      ) : (
        <div className="space-y-2">
          {byUser.map(([userId, e]) => (
            <div
              key={userId}
              className="flex items-center justify-between gap-3 rounded-lg border border-line bg-panel2 p-3"
            >
              <div className="min-w-0">
                <div className="font-medium">{e.name}</div>
                <div className="truncate text-[11px] text-muted">{e.accounts.join(" · ")}</div>
              </div>
              <button
                className="btn-ghost btn-sm shrink-0 hover:border-bad/60 hover:text-bad"
                disabled={busy === userId}
                onClick={() => offboard(userId, e.name, e.accounts.length)}
              >
                {busy === userId ? "Revoking…" : `Offboard (${e.accounts.length})`}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function AccountsBoard({
  accounts,
  users,
  creators,
}: {
  accounts: AccountView[];
  users: UserLite[];
  creators: CreatorLite[];
}) {
  // Group accounts by model for display.
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; items: AccountView[] }>();
    for (const a of accounts) {
      const key = a.creatorId ?? "__none__";
      const name = a.creatorName ?? "Unassigned";
      const e = m.get(key) ?? { name, items: [] };
      e.items.push(a);
      m.set(key, e);
    }
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [accounts]);

  return (
    <div>
      <AddAccount creators={creators} />

      {accounts.length === 0 ? (
        <section className="card mb-6 p-6 text-center text-sm text-muted">
          No accounts yet. Add your first one above — then grant VAs access and track warm-status here.
        </section>
      ) : (
        <div className="mb-6 space-y-6">
          {groups.map((g) => (
            <section key={g.name}>
              <h2 className="label">
                {g.name} ({g.items.length})
              </h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {g.items.map((a) => (
                  <AccountCard key={a.id} account={a} users={users} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <OffboardPanel accounts={accounts} />
    </div>
  );
}
