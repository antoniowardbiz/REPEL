import { prisma } from "@/lib/db";
import TemplateEditor from "@/components/TemplateEditor";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const templates = await prisma.messageTemplate.findMany({
    include: { role: true },
    orderBy: [{ category: "asc" }, { key: "asc" }],
  });

  const data = templates.map((t) => ({
    id: t.id,
    key: t.key,
    category: t.category,
    subject: t.subject ?? "",
    body: t.body,
    roleLabel: t.role?.displayName ?? null,
    active: t.active,
  }));

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Message Templates</h1>
      <p className="mb-5 text-sm text-muted">
        Telegram copy with <code className="text-brand2">{"{{merge_fields}}"}</code>: first_name, model_name,
        model_main_url, content_drive_url, training_group_url, trial_hours, role_name, feedback.
      </p>
      <TemplateEditor templates={data} />
    </div>
  );
}
