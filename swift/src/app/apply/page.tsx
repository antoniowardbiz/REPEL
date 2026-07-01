import { roleAvailability } from "@/lib/capacity";
import ApplyForm from "@/components/ApplyForm";

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
      <h1 className="font-display text-2xl font-bold">Apply to join</h1>
      <p className="mb-5 text-sm text-muted">
        Tell us your strong point and why. We&apos;ll message you on Telegram with the next step.
      </p>
      <ApplyForm roleOptions={roleOptions} topNeed={topNeed ? topNeed.displayName : null} />
    </div>
  );
}
