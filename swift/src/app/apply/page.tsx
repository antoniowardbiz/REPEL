import { roleAvailability } from "@/lib/capacity";
import ApplyForm from "@/components/ApplyForm";
import { PAYOUT_WINS, PAYOUT_STATS, WINS_CHANNEL_HANDLE, WINS_CHANNEL_URL } from "@/lib/testimonials-config";

export const dynamic = "force-dynamic";

export default async function ApplyPage() {
  const availability = await roleAvailability();
  const roleOptions = availability
    .slice()
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map((r) => ({ key: r.key, label: r.displayName, open: r.open }));
  // The role we most want people to pick right now (steer here if theirs is full).
  const topNeed = availability.find((r) => r.open) ?? null;

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="font-display text-3xl uppercase tracking-wide">
        Apply <span className="text-brand">to join</span>
      </h1>
      <p className="mb-5 text-sm text-muted">
        Tell us your strong point and why. We&apos;ll message you on Telegram with the next step.
      </p>
      <ApplyForm roleOptions={roleOptions} topNeed={topNeed ? topNeed.displayName : null} />

      {/* Payout proof — real numbers, live channel */}
      <section className="mt-8">
        <div className="label">
          <span className="text-brand">»</span> Team wins — real payouts
        </div>
        <div className="grid grid-cols-3 gap-2">
          {PAYOUT_STATS.map((s) => (
            <div key={s.label} className="card-2 p-3 text-center">
              <div className="font-display text-xl text-brand">{s.value}</div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
                {s.label}
              </div>
            </div>
          ))}
        </div>

        {PAYOUT_WINS.length > 0 && (
          <div className="mt-3 space-y-2">
            {PAYOUT_WINS.map((w, i) => (
              <div key={i} className="card-2 flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-100">
                    {w.handle} <span className="text-faint">· {w.role}</span>
                  </div>
                  {w.note && <div className="mt-0.5 text-xs text-muted">{w.note}</div>}
                </div>
                <div className="text-right">
                  <div className="font-display text-xl text-brand">{w.amount}</div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
                    {w.period}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <a
          href={WINS_CHANNEL_URL}
          target="_blank"
          className="btn-ghost mt-3 w-full font-mono text-[11px] uppercase tracking-[0.12em]"
        >
          See live payouts → {WINS_CHANNEL_HANDLE}
        </a>
      </section>
    </div>
  );
}
