import { prisma } from "@/lib/db";
import ApplyForm from "@/components/ApplyForm";

export const dynamic = "force-dynamic";

export default async function ApplyPage() {
  const roles = await prisma.role.findMany({ where: { active: true }, orderBy: { displayName: "asc" } });
  const roleOptions = roles.map((r) => ({ key: r.key, label: r.displayName }));
  return (
    <div className="mx-auto max-w-lg">
      <h1 className="font-display text-2xl font-bold">Apply to join</h1>
      <p className="mb-5 text-sm text-muted">
        Tell us your strong point and why. We&apos;ll message you on Telegram with the next step.
      </p>
      <ApplyForm roleOptions={roleOptions} />
    </div>
  );
}
